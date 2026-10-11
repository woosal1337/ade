# ade quality gates

Run `python3 tools/quality.py check` before completing a change.
The runner reads ordered command arrays from `PROJECT.json` and stops on the first failure.
An absent required check fails the runner. A skipped check is not a pass.

## Gates

| Gate | Command |
|---|---|
| Format | `npm run format:check` (Biome) |
| Source comments | `node tools/source-policy.mjs` |
| Lint | `npm run lint` (Biome, warnings fail the gate) |
| Types | `npm run typecheck` (TypeScript 7) |
| Build | `npm run build` |
| Tests | `npm test` (Node.js test runner) |
| Site | `npm --prefix site run check`: the TypeScript check and the static build of the landing page |

Use the same check command in the commit hook and CI.
The push hook runs the project test command. Add broader checks when the project requires them.
Install both hooks after each clone with `python3 tools/quality.py hooks-install`.
Read [pre-commit's hook documentation](https://pre-commit.com/) for hook installation and stages.

## Source comment policy

Do not add prose comments to authored source, tests, or configuration files.
Put explanations in names, types, small functions, and docs.
The `source-comments` gate must parse the selected languages and scan all authored file locations.
It must detect inline and block comments without flagging quoted URLs, regular expressions, or template text.
Record any mandatory directive, generated file, or third-party exclusion below.
Keep the exclusions narrow. Do not exclude a source directory merely because it contains one generated file.

`tools/source-policy.mjs` finds the authored files with `git ls-files --cached --others --exclude-standard`. It parses each file:

| Files | Parser |
|---|---|
| `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs` | TypeScript 6.0.3 compiler API |
| `.css` | A tokenizer that skips strings and finds `/*` |
| `.svg` | A search for `<!--` |
| `.json` | `JSON.parse` |
| `.yml`, `.yaml` | The `yaml` lexer |
| `.gitignore`, `.gitattributes`, `.editorconfig` | A line rule: a line that starts with `#` or `;` |
| `.sh`, `.ps1` | A line rule: a line that starts with `#`, or `<#` in PowerShell. The first `#!` line of a script is a required directive |
| `.py` | The Python tokenizer, through `python3` |

Exceptions:

- `package-lock.json` is a generated file. The check skips it, also in `site/`.
- Fonts and images (`.woff2`, `.png`, `.ico`, `.jpg`, `.webp`) are binary files. The check skips them.
- `site/public/fonts/OFL-*.txt` are third-party license texts. The check skips them.
- Next.js writes `site/next-env.d.ts` with comments. Git ignores the file.
- ade writes `ade.json`, `ade.lock.json`, and `ade.schema.json` in `examples/`. Biome does not format them. The source check parses them as JSON.
- Markdown files are documentation. The check skips them.
- The `#!/usr/bin/env node` line in `src/cli.ts` is a required directive. The TypeScript parser does not report it as a comment.
- Any other file type fails the check until it has a parser rule.

The Biome rule `noTemplateCurlyInString` is off. ade profiles use the literal `${secret:NAME}` and `${home}` syntax in plain strings, so the rule reports correct code.

## Product validation

The tests in `test/` run the engine against scratch home directories with fixture configs for each harness. They cover capture, plan, apply, a second plan with no changes, drift, revert, rollback, locks, secrets, Git and link skills, bundles, and the CLI. Tests that need symbolic links or POSIX file modes skip on Windows.

The manual acceptance check on 2026-10-11:

1. `ade capture` read the real home of this Mac into a scratch profile. It found 5 harnesses, 2 MCP servers, 13 skills, and 6 settings files.
2. `ade plan` against the real home showed 0 changes and 110 matching entries. It created no state directory.
3. `ade apply` to an empty scratch home made 108 changes. A second plan showed 0 changes.
4. `ade revert` emptied the scratch home. A revert of that revert restored the 108 entries.

The remote acceptance check on Igris, Linux with Node.js 24.13.0, on 2026-10-11:

1. `ade remote igris plan` against the real Igris home showed 73 creates, 6 updates, and 33 matching entries. It left no file on Igris.
2. `ade remote igris apply` to a scratch home made 112 changes. A second plan showed 0 changes, and status reported "In sync".
3. `ade remote igris revert` emptied the scratch home.
4. `ade remote igris capture` read the real Igris home: 4 harnesses, 3 MCP servers, 1 skill, and no secret value.

The first Windows CI run on 2026-10-11 failed one test. Git wrote CRLF line endings into a Git skill because the runner sets `core.autocrlf=true`. The checkout now sets `core.autocrlf=false` and `core.eol=lf`. A test sets `core.autocrlf=true` through the Git environment and fails without the fix.

The Git source check against GitHub on 2026-10-12:

1. The SSH URL with `//examples/starter` and the shorthand `woosal1337/ade/examples/starter` fetched commit `dd5a4e7`.
2. Apply without trust stopped with the `untrusted` error. Apply with `--trust` made 7 changes. A second plan showed 0 changes.
3. `ade remote igris apply` with the same source made 4 changes in a scratch home on Igris. A second plan showed 0 changes, and revert restored the home.

A commit on 2026-10-12 failed in the commit hook, but the same tests passed outside it. Git sets `GIT_INDEX_FILE` for a hook. ade passed it to its own Git calls, so a skill checkout wrote into a foreign index. A test with a copy of the repository index lost 90 of 93 entries. ade now removes the variables from `git rev-parse --local-env-vars` before each Git call. The same test now keeps all 93 entries.

The coverage check on this Mac on 2026-10-12:

1. `ade inventory` listed 42 synced entries, 5 extra files, 2 other entries, 11 private entries, 134 runtime entries, and 0 unknown entries.
2. `ade capture` found 8 harnesses, 13 skills, 10 settings files, 11 file entries, and the plugins of Claude Code, Cursor, and Zed.
3. `ade plan` against the real home showed 0 changes and 140 matching entries.
4. `ade apply` to an empty scratch home made 139 changes, with `claude plugin marketplace add` in the scratch home. A second plan showed 0 changes.

The first scratch apply ran the plugin commands after the file writes. Claude Code then changed `model` from `opus` to `opus[1m]` at start, and the second plan showed drift. Apply now runs the plugin commands first.

The ADE.md check on 2026-10-12:

1. A capture of this Mac shared to one ADE.md: 74 files, 694 KB. `ade verify`, `ade import`, and `ade plan` read it.
2. A second `ade share` of the same profile wrote a byte-identical file.
3. An edit of one line in a file block failed `ade verify` with a hash error and a digest error.
4. `scripts/install.sh` installed a packed tarball into a scratch npm prefix and ran the plan for a local ADE.md.

CI runs `scripts/install.sh` on Ubuntu and macOS, and `scripts/install.ps1` on Windows, with a packed tarball.

The source comment probe on 2026-10-11 added `src/probe.ts` with a line comment. The installed commit hook failed with `src/probe.ts:1: Remove the source comment.` The hook passed after the probe file was removed.

Record a real failure case for the source policy and an installed hook before accepting the foundation.
Restore the probe file after the check. Keep checks free of commits or pushes made only to test a hook.
Report device, integration, CI, and live checks separately.

## Continuous integration

The `checks` job runs on Ubuntu with Node.js 24 for each push and pull request. It runs `npm ci` and `python3 tools/quality.py check`. The `platforms` job runs `npm test` on macOS and Windows with Node.js 24, and on Ubuntu with Node.js 22. It runs for pull requests and manual runs only, because macOS and Windows minutes cost more in a private repository.

Give CI only its required permissions.
Pin third-party actions to full commit hashes and record their selected releases in the stack research.
Read [GitHub's action security guide](https://docs.github.com/en/actions/reference/security/secure-use) for action pins.
