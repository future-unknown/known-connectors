// Builds every platform's listing of Known from listing/known.json, the
// assets and the skills, into platforms/<platform>/, and checks each one
// against its schema and the platform's own rules before anything ships.
// The OpenAI package is also zipped into dist/.
//
//   npm run build           build and check everything
//   npm run check           build into a temporary copy and fail if
//                           platforms/ is out of date with the listing
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, mkdtempSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'

const root = path.resolve(import.meta.dirname, '..')
const listing = JSON.parse(readFileSync(path.join(root, 'listing', 'known.json'), 'utf8'))
const checking = process.argv.includes('--check')
const out = checking ? mkdtempSync(path.join(tmpdir(), 'known-connectors-')) : path.join(root, 'platforms')
const problems = []

// Agent Plugins schemas are draft 2020-12; the MCP registry's is draft-07.
const ajv2020 = new Ajv2020({ strict: false, allErrors: true })
const ajv07 = new Ajv({ strict: false, allErrors: true })
addFormats(ajv2020)
addFormats(ajv07)
const schema = (file) => {
  const value = JSON.parse(readFileSync(path.join(root, 'schemas', file), 'utf8'))
  return (String(value.$schema).includes('draft-07') ? ajv07 : ajv2020).compile(value)
}
const validate = (name, check, value, extra = []) => {
  if (!check(value)) for (const error of check.errors) if (!extra.includes(error.params?.additionalProperty)) problems.push(`${name}: ${error.instancePath || '/'} ${error.message}${error.params?.additionalProperty ? ` (${error.params.additionalProperty})` : ''}`)
}
const rule = (ok, message) => { if (!ok) problems.push(message) }
const write = (file, value) => {
  const target = path.join(out, file)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n')
}
const copy = (from, to) => cpSync(path.join(root, from), path.join(out, to), { recursive: true })
const longDescription = listing.description.join('\n\n')

// ---- OpenAI: an Agent Plugins package for ChatGPT's plugin directory -------
// https://developers.openai.com/plugins/deploy/submission
{
  const dir = 'openai'
  const interfaceFields = {
    displayName: listing.displayName,
    shortDescription: listing.tagline,
    longDescription,
    developerName: listing.publisher.name,
    category: listing.category,
    capabilities: ['Read', 'Write'],
    websiteURL: listing.links.website,
    supportURL: listing.links.support,
    privacyPolicyURL: listing.links.privacy,
    termsOfServiceURL: listing.links.terms,
    defaultPrompt: listing.prompts,
    brandColor: listing.brand.color,
    brandColorDark: listing.brand.colorDark,
    composerIcon: './assets/icon.png',
    logo: './assets/logo.png',
  }
  const review = {
    test_cases: {
      // The portal takes the tools as one string.
      positive: listing.testCases.positive.map((c) => ({ description: c.description, prompt: c.prompt, tools_triggered: c.tools.join(', '), expected_behavior: c.expected })),
      negative: listing.testCases.negative.map((c) => ({ description: c.description, prompt: c.prompt })),
    },
    ...(listing.demoVideo ? { demo_recording_url: listing.demoVideo } : {}),
  }
  const plugin = {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    name: listing.name,
    version: listing.version,
    description: `${listing.tagline}. ${listing.summary}`,
    author: listing.publisher,
    homepage: listing.links.website,
    license: listing.license,
    keywords: listing.keywords,
    extensions: { 'com.openai': { onboardingSkill: './skills/get-started/SKILL.md', interface: interfaceFields, review } },
  }
  const mcp = {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
    mcpServers: {
      [listing.name]: {
        type: 'streamable-http',
        url: listing.mcp.url,
        // OpenAI's documented form; not in the generic Agent Plugins schema.
        extensions: { 'com.openai': { auth: { type: 'oauth', client: { mode: 'cimd' } } } },
      },
    },
  }
  write(`${dir}/plugin.json`, plugin)
  write(`${dir}/mcp.json`, mcp)
  copy('skills', `${dir}/skills`)
  copy('assets', `${dir}/assets`)

  validate('openai/plugin.json', schema('agent-plugins-1.0.0-plugin.schema.json'), plugin)
  const { extensions, ...server } = mcp.mcpServers[listing.name]
  validate('openai/mcp.json', schema('agent-plugins-1.0.0-mcp.schema.json'), { ...mcp, mcpServers: { [listing.name]: server } })
  rule(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(plugin.name) && plugin.name.length <= 64, 'openai: name must be lowercase words joined by single hyphens, at most 64')
  rule(interfaceFields.displayName.length <= 30, 'openai: displayName over 30 characters')
  rule(interfaceFields.shortDescription.length <= 30, `openai: shortDescription over 30 characters (${interfaceFields.shortDescription.length})`)
  rule(interfaceFields.longDescription.length <= 4000, 'openai: longDescription over 4000 characters')
  rule(plugin.description.length <= 4000, 'openai: description over 4000 characters')
  rule(interfaceFields.developerName.length <= 80, 'openai: developerName over 80 characters')
  rule(interfaceFields.defaultPrompt.length <= 3 && new Set(interfaceFields.defaultPrompt).size === interfaceFields.defaultPrompt.length, 'openai: up to 3 distinct prompts')
  for (const prompt of interfaceFields.defaultPrompt) rule(prompt.length <= 128 && !prompt.includes('@'), `openai: prompt over 128 characters or with an @mention: ${prompt}`)
  for (const key of ['websiteURL', 'supportURL', 'privacyPolicyURL', 'termsOfServiceURL']) rule(/^https:\/\//.test(interfaceFields[key]) && interfaceFields[key].length <= 1024, `openai: ${key} must be https, at most 1024`)
  rule(contrast(interfaceFields.brandColor, '#FFFFFF') >= 2, 'openai: brandColor needs 2:1 against white')
  rule(contrast(interfaceFields.brandColorDark, '#212121') >= 2, 'openai: brandColorDark needs 2:1 against #212121')
  rule(review.test_cases.positive.length === 5 && review.test_cases.negative.length === 3, 'openai: exactly 5 positive and 3 negative test cases')
  if (!listing.demoVideo) console.warn('openai: no demo video yet; set listing.demoVideo before submitting for review')
}

// ---- The Official MCP Registry: server.json -------------------------------
// Published with mcp-publisher, proved by the DNS record on known.info.
{
  const server = {
    $schema: 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
    name: listing.mcp.registryName,
    title: listing.displayName,
    description: `${listing.tagline}: every AI agent works from your company's knowledge, decisions and history.`,
    version: listing.version,
    websiteUrl: listing.links.website,
    remotes: [{ type: 'streamable-http', url: listing.mcp.url }],
  }
  write('mcp-registry/server.json', server)
  validate('mcp-registry/server.json', schema('mcp-registry-2025-12-11-server.schema.json'), server)
  rule(server.description.length <= 100, 'mcp-registry: description over 100 characters')
}

// ---- Cursor: the install link ----------------------------------------------
{
  const config = Buffer.from(JSON.stringify({ url: listing.mcp.url })).toString('base64')
  const web = `https://cursor.com/en/install-mcp?name=${listing.name}&config=${encodeURIComponent(config)}`
  const deeplink = `cursor://anysphere.cursor-deeplink/mcp/install?name=${listing.name}&config=${encodeURIComponent(config)}`
  write('cursor/README.md', `# ${listing.displayName} in Cursor

${listing.tagline}. ${listing.summary}

[Add ${listing.displayName} to Cursor](${web})

Or open \`${deeplink}\`, or add it by hand to \`~/.cursor/mcp.json\`:

\`\`\`json
${JSON.stringify({ mcpServers: { [listing.name]: { url: listing.mcp.url } } }, null, 2)}
\`\`\`

Cursor opens Known in your browser to sign in; there is no key. More: ${listing.links.setup}
`)
}

// ---- Claude: a Claude Code plugin, its marketplace, and the directory text --
// https://code.claude.com/docs/en/plugins/manifest-reference
{
  const dir = 'claude/known'
  write(`${dir}/.claude-plugin/plugin.json`, {
    name: listing.name,
    version: listing.version,
    description: `${listing.tagline}. ${listing.summary}`,
    author: listing.publisher,
    homepage: listing.links.website,
    repository: 'https://github.com/future-unknown/known-connectors',
    license: listing.license,
    keywords: listing.keywords,
    icon: './.claude-plugin/icon.png',
    privacyPolicyUrl: listing.links.privacy,
  })
  cpSync(path.join(root, listing.brand.icon), path.join(out, dir, '.claude-plugin', 'icon.png'))
  write(`${dir}/README.md`, `# ${listing.displayName}

${listing.tagline}. ${listing.summary}

${listing.description.slice(1).join('\n\n')}

## Install

\`\`\`
/plugin marketplace add future-unknown/known-connectors
/plugin install ${listing.name}@${listing.name}
\`\`\`

Then run \`/mcp\`, choose **${listing.name}**, and sign in to Known in your browser. There is no key. Ask Claude to get started (\`/${listing.name}:get-started\`) to see what's in your organization and take a first step.

## Links

- Website: ${listing.links.website}
- Docs: ${listing.links.docs}
- Support: ${listing.links.support}
- Privacy: ${listing.links.privacy}
- Terms: ${listing.links.terms}
`)
  // Sign-in needs no settings: Claude Code sees Known's 401 and opens the browser.
  write(`${dir}/.mcp.json`, { mcpServers: { [listing.name]: { type: 'http', url: listing.mcp.url } } })
  copy('skills', `${dir}/skills`)
  // The marketplace lives at the repository's root, beside platforms/.
  const marketplace = {
    name: listing.name,
    owner: { name: listing.publisher.name, url: listing.publisher.url },
    description: `${listing.displayName} for Claude Code: ${listing.tagline.toLowerCase()}.`,
    plugins: [{ name: listing.name, source: './platforms/claude/known', description: `${listing.tagline}. ${listing.summary}`, category: listing.category.toLowerCase(), tags: listing.keywords }],
  }
  write('claude/marketplace.json', marketplace)
  rule(/^[a-z0-9][a-z0-9-]*$/.test(listing.name) && !/^(claude|anthropic)/.test(listing.name), 'claude: plugin name must be kebab-case and not reserved')

  // The Claude directory takes a form, not a package: its fields, from the listing.
  write('claude/directory.md', `# ${listing.displayName}: Claude directory submission

Submit at https://claude.ai/directory/manage → MCP connector. Every field, from listing/known.json.

- **Name:** ${listing.displayName}
- **Server URL:** \`${listing.mcp.url}\` (streamable HTTP)
- **Authentication:** OAuth 2.0, authorization code with PKCE (S256); clients identify by client ID metadata document (no dynamic client registration)
- **Tagline:** ${listing.tagline}
- **Description:** ${listing.description.slice(0, 2).join(' ')}
- **Category:** ${listing.category}
- **Website:** ${listing.links.website}
- **Documentation:** ${listing.links.docs}
- **Privacy policy:** ${listing.links.privacy}
- **Terms:** ${listing.links.terms}
- **Support:** ${listing.links.support} (${listing.publisher.email})
- **Icon:** assets/logo.png (${listing.links.website}/brand/icon.png)

**Example prompts**

${listing.prompts.map((prompt, i) => `${i + 1}. "${prompt}"`).join('\n')}

**Reviewer account:** a production account in a demo organization with sample wikis, signing in with a password and no codes. Its credentials go only into the form.
`)
}

// ---- Package the OpenAI plugin --------------------------------------------
if (!checking) {
  const dist = path.join(root, 'dist')
  mkdirSync(dist, { recursive: true })
  const zip = path.join(dist, `${listing.name}-openai-${listing.version}.zip`)
  rmSync(zip, { force: true })
  execFileSync('zip', ['-qr', zip, 'plugin.json', 'mcp.json', 'skills', 'assets', '-x', '.*'], { cwd: path.join(out, 'openai') })
  console.log(`wrote ${path.relative(root, zip)}`)
}

// The Claude marketplace file is read from .claude-plugin/ at the root.
const marketplaceBuilt = path.join(out, 'claude', 'marketplace.json')
const marketplaceRoot = path.join(root, '.claude-plugin', 'marketplace.json')
if (!checking) {
  mkdirSync(path.dirname(marketplaceRoot), { recursive: true })
  cpSync(marketplaceBuilt, marketplaceRoot)
} else if (!existsSync(marketplaceRoot) || !readFileSync(marketplaceBuilt).equals(readFileSync(marketplaceRoot))) {
  problems.push('.claude-plugin/marketplace.json is out of date (run npm run build)')
}

if (checking) {
  const stale = compare(out, path.join(root, 'platforms'))
  if (stale.length) problems.push(...stale.map((file) => `platforms/ is out of date: ${file} (run npm run build)`))
  rmSync(out, { recursive: true, force: true })
}

if (problems.length) {
  console.error(problems.map((problem) => `✗ ${problem}`).join('\n'))
  process.exit(1)
}
console.log(checking ? 'platforms/ matches the listing; every check passed' : 'built platforms/; every check passed')

function contrast(a, b) {
  const lum = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

function compare(built, committed) {
  const files = (dir, base = dir) => (existsSync(dir) ? readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    return statSync(full).isDirectory() ? files(full, base) : [path.relative(base, full)]
  }) : [])
  const a = new Set(files(built))
  const b = new Set(files(committed))
  const differ = [...a].filter((file) => !b.has(file) || !readFileSync(path.join(built, file)).equals(readFileSync(path.join(committed, file))))
  return [...differ, ...[...b].filter((file) => !a.has(file))]
}
