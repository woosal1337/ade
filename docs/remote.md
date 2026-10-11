# Remote machines

`ade remote <host> <command>` runs a command on another machine over SSH. The remote machine needs Node.js 22 or later and an SSH server. It does not need ade, Git, or network access to the skill sources.

## Use it

1. Check the route and the remote harnesses:

   ```bash
   ade remote igris harnesses
   ```

2. Show the plan for the remote home. The plan writes nothing on the remote:

   ```bash
   ade remote igris plan --profile ~/agent-profile
   ```

3. Apply the profile. ade shows the plan and asks before it writes:

   ```bash
   ade remote igris apply --profile ~/agent-profile
   ```

4. Undo the last remote apply:

   ```bash
   ade remote igris revert
   ```

## Commands

| Command | Use |
|---|---|
| `plan`, `apply`, `status`, `doctor` | Send the profile and run the command on the remote home |
| `revert [id]`, `history` | Use the apply records on the remote |
| `harnesses` | List the remote harnesses and their paths |
| `capture` | Capture the remote setup into a local profile |

## Options

| Option | Use |
|---|---|
| `--remote-home <dir>` | Use another home on the remote, for example a scratch directory |
| `--send-secrets` | Resolve the secrets on this machine and send their values with the request |
| `--keep-links` | Keep link skills as links. Without it, ade sends their content |
| `--node <path>` | The Node.js program on the remote. The default is `node` |
| `--ssh <program>` | The SSH program. The default is `ssh` |
| `--ssh-option <option>` | An extra SSH argument, for example `-p2222`. Repeat it for more |

## How it works

1. ade packs the profile into a bundle. It adds the content of Git skills at their locked commits, and of link skills.
2. ade starts `ssh <host> node --input-type=module -` and sends one script on standard input. The script holds the bundle and the ade engine as one file.
3. The remote writes the bundle to a temporary folder, runs the command, prints one result line, and deletes the folder.
4. ade reads the result line and shows it like a local command.

Remote apply copies the `files` entries. It does not link them, because the profile folder on the remote is temporary. The apply records and the state stay in the remote state folder, so `ade remote <host> revert` works later.

## Secrets

Without `--send-secrets`, the remote resolves each secret from its own environment, files, commands, or Keychain. With `--send-secrets`, the values travel inside the SSH session and stay in memory on the remote. ade does not write them to disk on the remote, except in the harness files that need them.

## Move a setup between machines

```bash
ade remote old-box capture --out ~/agent-profile
ade remote new-box plan --profile ~/agent-profile
ade remote new-box apply --profile ~/agent-profile
```

## Windows

A Windows host runs the same commands through OpenSSH. Its default shell must find `node`. On Windows, the default install mode copies files and skills, because links need extra rights.
