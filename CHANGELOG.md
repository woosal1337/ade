# Changelog

## 0.1.0 (not released yet)

The first public version.

### Added

- `capture`, `plan`, `apply`, `revert`, `status`, `doctor`, and `inventory` for Claude Code, Codex, Cursor, Grok, Pi, Gemini CLI, OpenCode, Zed, Claude Desktop, and Antigravity.
- Git profile sources with a trust prompt, and `use`, `trust`, and `update`.
- `ADE.md`: one Markdown file that holds a whole setup, with `share`, `verify`, and `import`.
- `ade remote` to plan, apply, and capture over SSH.
- A TypeScript SDK with the same operations.
- Install scripts for macOS, Linux, and Windows.

### Security

- Trust now compares a hash of each entry that ade writes or runs. A change in any entry needs trust again.
- A local `ADE.md` file or a JSON bundle needs trust before an import or an apply. A plan of it uses placeholder secrets.
- A shared profile cannot link to local paths or fetch skills from local repositories.
- Git gets `--` before each URL and ref. Refs match exact names. Git writes symbolic links in a fetched tree as plain files.
- Output escapes control characters, and remote results get a schema check.
- Plan output masks long secrets and secrets with escaped characters. A file that gets a secret has mode 600.
- Capture skips credential files and replaces credential arguments and URL values with references.
- The token scan reads base64 files and knows more token formats.
- The backup set of a patch comes from `git apply --numstat`.
