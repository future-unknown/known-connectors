# Known connectors

Known's listings on every platform that connects agents to it — ChatGPT, Claude, the Official MCP Registry and Cursor — built from one source.

Known is shared memory for teams: every AI agent works from your company's knowledge, decisions and history. Its MCP server is at `https://api.known.info/mcp`; signing in happens in the browser, with no key. To connect an agent by hand, see https://known.info/setup.md.

## Install in Claude Code

```
/plugin marketplace add future-unknown/known-connectors
/plugin install known@known
```

Then run `/mcp`, choose **known**, and sign in.

## What's here

| Path | What it is |
|---|---|
| `listing/known.json` | The one source: name, tagline, descriptions, links, brand, prompts, review test cases |
| `assets/` | Logo and icon |
| `skills/get-started/` | The onboarding skill every platform that takes skills ships |
| `platforms/openai/` | ChatGPT plugin (Agent Plugins format); `npm run build` zips it into `dist/` |
| `platforms/claude/known/` | Claude Code plugin; `.claude-plugin/marketplace.json` makes this repo its marketplace |
| `platforms/claude/directory.md` | The Claude directory's form fields |
| `platforms/mcp-registry/server.json` | The Official MCP Registry entry (`info.known/known`) |
| `platforms/cursor/` | Cursor's install link |
| `schemas/` | The schemas each platform is checked against |

`platforms/` and `.claude-plugin/marketplace.json` are generated: edit `listing/`, `assets/` or `skills/`, then run `npm run build`. `npm run check` (also run in CI) fails when they are out of date or any platform's rules aren't met. Before a Claude plugin release, also run `claude plugin validate ./platforms/claude/known --strict --profile directory`.

## Releasing

- **ChatGPT:** upload `dist/known-openai-<version>.zip` at platform.openai.com → Plugins. The domain token the portal gives goes into kwn.one's `loom:production` as `openai.appsChallenge`.
- **Claude Code:** bump `version` in the listing and push; users update with `/plugin marketplace update known`.
- **Official MCP Registry:** bump `version`, then `mcp-publisher login dns --domain known.info` and `mcp-publisher publish` from `platforms/mcp-registry/`. Published versions can't be changed.
