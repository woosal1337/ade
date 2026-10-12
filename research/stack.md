# ade stack research

Research date: 2026-10-11

## Requirements and selected versions

| Component | Selection | Reason |
|---|---|---|
| Runtime | Node.js 22 or later, 24 LTS in development | Pi needs Node.js 22.19 or later. Node.js 24 is the active LTS line |
| Language | TypeScript 7.0.2, strict, erasable syntax only | Node.js runs the source in tests without a build |
| Package manager | npm 11 with `package-lock.json` | Ships with Node.js |
| Schema | zod 4.6.5 | Types, validation, and JSON Schema from one source |
| TOML | smol-toml 1.9.1 | Codex and Grok use `config.toml` |
| Format and lint | Biome 2.5.15 | One tool for both |
| Tests | `node:test` | No test dependency |
| Comment parser | TypeScript 6.0.3 API, yaml 2.9.1 | TypeScript 7 has no stable parser API |
| Hooks | pre-commit 4.6.2 | The shared foundation |
| Remote agent bundle | esbuild 0.28.2 | One ESM file that `node -` runs from standard input on the remote |
| Landing page | Next.js 16.4.0 static export, React 19.3.0, Tailwind CSS 4.3.3, motion 14.1.0 | The stack of the index project, with the current Next.js line. Read [the site decision](../docs/decisions/0007-landing-page.md) |
| CI actions | checkout v7.0.1 `3d3c42e5aac5ba805825da76410c181273ba90b1`, setup-node v7.1.0 `949feb2413d6458794dcd2491c4babbbce0c15c1` | Pinned to full commit hashes |

Choose compatible stable versions. Do not choose each component's newest version independently.
Record a version constraint when the framework controls a runtime or peer dependency.

## Framework conventions

Harness facts, checked on 2026-10-11:

| Harness | Instructions | MCP servers | Skills | Settings |
|---|---|---|---|---|
| Claude Code | `~/.claude/CLAUDE.md` | `mcpServers` in `~/.claude.json` | `~/.claude/skills` | `~/.claude/settings.json` |
| Codex | `~/.codex/AGENTS.md` | `[mcp_servers.<name>]` in `~/.codex/config.toml` | reads `~/.agents/skills` | `~/.codex/config.toml` |
| Cursor | Account rules, no file | `mcpServers` in `~/.cursor/mcp.json` | reads `~/.agents/skills` | `~/.cursor/cli-config.json` |
| Grok | `~/.grok/AGENTS.md` | `[mcp_servers.<name>]` in `~/.grok/config.toml` | reads `~/.agents/skills` | `~/.grok/config.toml` |
| Pi | `~/.pi/agent/AGENTS.md` | `mcpServers` in `~/.pi/agent/mcp.json` | reads `~/.agents/skills` | `~/.pi/agent/settings.json` |

Home overrides: `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GROK_HOME`, and `PI_CODING_AGENT_DIR`.
Node.js 24 runs `.ts` files with type stripping. The TypeScript option `rewriteRelativeImportExtensions` lets the source import `.ts` paths and emit `.js` paths.

## Quality and delivery

Biome checks format and lint. TypeScript 7 checks types and builds `dist/`. The Node.js test runner runs the tests from source. The source comment check parses each authored language. CI uses the same commands.

## Sources and open questions

- [Node.js releases](https://nodejs.org/en/about/previous-releases)
- [Node.js TypeScript support](https://nodejs.org/api/typescript.html)
- [TypeScript package](https://www.npmjs.com/package/typescript)
- [zod JSON Schema](https://zod.dev/json-schema)
- [smol-toml](https://github.com/squirrelchat/smol-toml)
- [Biome configuration](https://biomejs.dev/reference/configuration/)
- [Claude Code MCP](https://code.claude.com/docs/en/mcp) and [Claude Code skills](https://code.claude.com/docs/en/skills)
- [Codex skills](https://developers.openai.com/codex/skills) and [Codex MCP](https://developers.openai.com/codex/mcp)
- [Cursor skills](https://cursor.com/docs/skills)
- The Grok user guide in `~/.grok/docs/user-guide/`, sections 05, 07, and 08
- The Pi documentation in its installed package: `docs/mcp.md`, `docs/settings.md`, and `docs/skills.md`
- A survey of agent setup sync tools on 2026-10-10, in the notes of the maintainer

Open question: Cursor IDE settings use JSON with comments. ade does not write them yet.
