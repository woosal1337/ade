# Profile sources

A profile source is a local folder or a Git repository that holds an `ade.json` file. Any command that reads a profile takes a source: `plan`, `apply`, `status`, `doctor`, `list`, `export`, `pack`, `use`, and `ade remote <host> plan|apply|status|doctor`.

## Use a public profile

1. Show the changes for your machine. The plan writes nothing:

   ```bash
   ade plan woosal1337/ade/examples/starter
   ```

2. Apply the profile. ade shows what the source runs and writes, and asks you to trust it:

   ```bash
   ade apply woosal1337/ade/examples/starter
   ```

3. Make the source the default for this home:

   ```bash
   ade use woosal1337/ade/examples/starter
   ```

4. Sync later. Each `ade apply` fetches the newest commit of the source:

   ```bash
   ade apply
   ```

5. Apply the same source to another machine:

   ```bash
   ade remote devbox apply woosal1337/ade/examples/starter
   ```

To edit a setup before you apply it, import it first. `ade import woosal1337/ade/examples/starter` asks for trust, then writes the default profile folder. Then run `ade plan` and `ade apply`.

## Source forms

| Form | Example | Meaning |
|---|---|---|
| Local folder | `./team`, `~/agents`, `/srv/agents` | The `ade.json` in the folder, or its `ADE.md` when it has no `ade.json` |
| Local ADE.md | `./ADE.md`, `~/Downloads/ADE.md` | The file itself |
| GitHub shorthand | `acme/agents` | `https://github.com/acme/agents.git` at its default branch |
| Subfolder | `acme/agents/profiles/work` | The `profiles/work` folder of that repository |
| ADE.md in a repository | `acme/agents/profiles/work/ADE.md` | One ADE.md file in that repository |
| Ref | `acme/agents@v1.2`, `acme/agents@main` | A tag, a branch, or a full commit hash |
| Explicit GitHub | `github:acme/agents` | The shorthand, even when a local folder has the same name |
| Git URL | `https://git.example.com/team/agents.git//work#v1` | Any Git URL, with an optional `//subfolder` and `#ref` |
| ade page | `@ege`, `ade.chele.bi/ege` | The items that the owner of the page shares. Read [the accounts guide](accounts.md) |

If a local folder or file has the same name as a shorthand, ade stops. Use `./<path>` for the local path, or `github:<owner>/<repo>` for the repository. A repository root with only an `ADE.md` works as a source. Read [the ADE.md standard](ade-md.md).

ade fetches a Git source into its cache at one commit. It remembers the commit, so `--offline` uses the last fetched commit. The apply record names the source and the commit, for example `acme/agents @ 1a2b3c4d5e6f`.

## Trust

A profile can run programs and change files on your machine. A Git source or a shared file needs your trust before ade imports or applies it. A shared file is an `ADE.md` or a JSON bundle on disk, for example a download. An imported copy is a local profile, so `ade import` asks for trust first.

1. ade shows a summary of the source. Items marked with `!` run programs, write files, read secrets, or change permissions.
2. You type `yes`, or you add `--trust` to the command.
3. ade records the source, the commit or the file digest, and a hash of each entry in `trust.json` in the state folder.

A new commit stays trusted only when each entry that ade writes or runs is equal. A commit that changes only other files in the repository keeps trust. A change in an MCP server, a setting, a file, a patch, a plugin, a secret source, a skill, or the instructions needs trust again. ade then lists the new, changed, and removed entries. Pin a commit with `@<commit>` to stop all updates.

A shared profile must carry its files. ade refuses a shared profile that links to local paths, links a skill to a local folder, or fetches a skill from a local repository. `ade share` copies local link targets into the file.

Before trust, `plan`, `status`, and `doctor` do not resolve the secrets of the source. They never run a secret command, never read a secret file, and never read the Keychain for that source.

| Command | Use |
|---|---|
| `ade trust` | List the trusted sources |
| `ade trust <source>` | Show the summary and trust the source |
| `ade trust <source> --remove` | Remove the trust |

## Publish a profile

The simplest form is one file:

```bash
ade share --profile ~/agent-profile --repo <owner>/agents
```

Commit the `ADE.md` that it writes. Read [the ADE.md standard](ade-md.md) for the format.

To publish an editable profile folder instead:

1. Write a self-contained copy of your profile:

   ```bash
   ade pack --profile ~/agent-profile --out ~/agents-public --repo <owner>/agents
   ```

2. Read the warnings. Pack refuses a value that looks like a token or a private key.
3. Read the generated `README.md`, and remove anything that you do not want to share.
4. Publish the folder:

   ```bash
   cd ~/agents-public
   git init
   git add .
   git commit -m "Publish my agent profile"
   gh repo create <owner>/agents --public --source . --push
   ```

Pack copies link skills and skills from local Git repositories into the profile. It keeps public Git skills as Git skills with their locked commits. Add `--vendor-git` to copy them too.

A public profile names its secrets, never their values. Use `env` sources, so each user can set the values on their own machine. `ade capture` already replaces token values with `${secret:NAME}` references.

## The starter profile

`examples/starter` in this repository is a small profile that follows these rules:

```bash
ade plan woosal1337/ade/examples/starter
```
