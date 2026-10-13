# Changelog

## 0.1.0 (not released yet)

The first public version.

### Added

- `capture`, `plan`, `apply`, `revert`, `status`, `doctor`, and `inventory` for Claude Code, Codex, Cursor, Grok, Pi, Gemini CLI, OpenCode, Zed, Claude Desktop, and Antigravity.
- Git profile sources with a trust prompt, and `use`, `trust`, and `update`.
- `ADE.md`: one Markdown file that holds a whole setup, with `share`, `verify`, and `import`.
- `ade remote` to plan, apply, and capture over SSH.
- A TypeScript SDK with the same operations.
- Accounts with GitHub login through WorkOS: `ade login`, `ade logout`, `ade whoami`, and `ade push`. Each account has a page at `ade.chele.bi/<name>` that shows only the items that its owner approves.
- `@<name>` and `ade.chele.bi/<name>` sources for plan, apply, and import, with the trust prompt.
- The dashboard asks for the WorkOS email code when the first login needs it.
- The People page at `ade.chele.bi/people` lists each person with a public setup: search, harness and content filters, sort, the update date, and votes from logged-in users. Each public page also has the vote buttons.
- The dashboard, the page header, and the owner view of a page show the cached account at once, then check it with the API. One request serves the header and the page.
- The login uses the own WorkOS project `ade`. The GitHub screen and the login emails show "ade". An account moves to its new WorkOS user at the next login.
- Install scripts for macOS, Linux, and Windows. They build a package file with `npm pack`, then install it, because `npm install -g` of a Git source fails in npm (npm/cli#8440).

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
- `ade pack` and `ade remote <host> capture` ask for trust before they write a local profile. Remote capture removes links to paths on the other machine.
- `ade export` refuses token values and credential files, and writes the bundle with mode 600.
- The ADE.md digest and the trust hash hold the file mode. Paths that differ only in case fail. An ADE.md from an earlier build with a mode other than 644 fails its digest check. Run `ade share` again to write it.
- Capture skips credential files in harness folders, skill folders, and referenced files.
- A revert of a revert keeps mode 600 on a file with a secret.
- The risk summary names the ref and the locked commit of each Git skill.
- Trust keys of settings use JSON pointers, and two entries with one key fail.
- Prompts, plan labels, and JSON output escape control characters. Text output also escapes line breaks and color codes that come from profile text.
- A path in a profile cannot hold a `.` part, so a target cannot name a whole harness folder or the home folder.
- The risk summary marks each MCP server, override, and setting that gets a secret, and names the secret. An environment secret is a high-risk line.
- A patch that adds or changes a symbolic link fails, and `git apply` runs with `core.symlinks=false`.
- Output escapes invisible Unicode characters, such as zero-width spaces and line separators. Paths and Git URLs with such characters fail.
- Child processes run in the home folder or the cache folder, not in the current folder. Git does not read the repository config of the current folder.
- A secret command needs a program name on the PATH or an absolute path. A path part such as `.git.` or `GIT~1` fails, because Windows reads it as `.git`.
- Before trust, `plan`, `status`, and `ade remote` do not fetch the Git skills of a source, so ade contacts no host that the author names. `ade share` of a Git source or a shared file needs trust, as `ade pack` does.
- A source that names both a local path and a GitHub shorthand fails. Use `./<path>` or `github:<owner>/<repo>`.
- A settings file name that differs only in case from a main settings file or an MCP file fails.
- A Grok plugin install must come from the marketplace that the profile names. ade removes a plugin from another marketplace.
- A marketplace that Claude Code or Codex adds under another name fails, and ade removes it again.
- A plugin install that replaces another version records the old version, so a revert reinstalls it.
