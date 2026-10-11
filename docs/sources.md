# Profile sources

A profile source is a local folder or a Git repository that holds an `ade.json` file. Any command that reads a profile takes a source: `plan`, `apply`, `status`, `doctor`, `list`, `export`, `pack`, `use`, and `ade remote <host> plan|apply|status|doctor`.

## Use a public profile

1. Show the changes for your machine. The plan writes nothing:

   ```bash
   ade plan cobanov/agents
   ```

2. Apply the profile. ade shows what the source runs and writes, and asks you to trust it:

   ```bash
   ade apply cobanov/agents
   ```

3. Make the source the default for this home:

   ```bash
   ade use cobanov/agents
   ```

4. Sync later. Each `ade apply` fetches the newest commit of the source:

   ```bash
   ade apply
   ```

5. Apply the same source to another machine:

   ```bash
   ade remote igris apply cobanov/agents
   ```

## Source forms

| Form | Example | Meaning |
|---|---|---|
| Local folder | `./team`, `~/agents`, `/srv/agents` | The folder itself |
| GitHub shorthand | `cobanov/agents` | `https://github.com/cobanov/agents.git` at its default branch |
| Subfolder | `cobanov/agents/profiles/work` | The `profiles/work` folder of that repository |
| Ref | `cobanov/agents@v1.2`, `cobanov/agents@main` | A tag, a branch, or a full commit hash |
| Explicit GitHub | `github:cobanov/agents` | The shorthand, even when a local folder has the same name |
| Git URL | `https://git.example.com/team/agents.git//work#v1` | Any Git URL, with an optional `//subfolder` and `#ref` |

A local folder with the same name as a shorthand wins. Use `github:` to choose the repository.

ade fetches a Git source into its cache at one commit. It remembers the commit, so `--offline` uses the last fetched commit. The apply record names the source and the commit, for example `cobanov/agents @ 1a2b3c4d5e6f`.

## Trust

A profile can run programs and change files on your machine. A Git source needs your trust before its first apply.

1. ade shows a summary of the source. Items marked with `!` run programs, write files, read secrets, or change permissions.
2. You type `yes`, or you add `--trust` to the command.
3. ade records the source, the commit, and the summary in `trust.json` in the state folder.

A new commit with the same summary needs no new trust. A new commit that adds a program, a file, a secret, a permission, a package, or a skill needs trust again. ade then shows the new and removed items. A change in the text of a skill or of the instructions does not change the summary. Pin a commit with `@<commit>` to stop all updates.

Before trust, `plan`, `status`, and `doctor` do not resolve the secrets of the source. They never run a secret command, never read a secret file, and never read the Keychain for that source.

| Command | Use |
|---|---|
| `ade trust` | List the trusted sources |
| `ade trust <source>` | Show the summary and trust the source |
| `ade trust <source> --remove` | Remove the trust |

## Publish a profile

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
