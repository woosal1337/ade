# 0003: A remote agent over SSH standard input

Date: 2026-10-11

Status: Accepted for version 0.1.0.

## Context

A move of a setup needs a plan and an apply on another machine. Most lab machines have SSH and Node.js. They do not all have ade, GitHub access to the private repository, or the skill sources. One target machine runs Windows with the `cmd.exe` shell.

## Decision

1. The build bundles `src/remote/agent.ts` and its dependencies into one file, `dist/remote-agent.mjs`, with esbuild.
2. `ade remote` runs `ssh <host> node --input-type=module -`. It sends one script on standard input: a payload line, then the agent bundle.
3. The payload holds the profile bundle, with the content of Git and link skills. The remote needs no Git and no network.
4. The agent writes one line that starts with `ADE-REMOTE-RESULT `, then the JSON result. The client ignores other output.
5. Apply on the remote sends the plan fingerprint from the remote plan. A change between the two SSH sessions stops the apply.

## Alternatives

- Install ade on each remote with npm. This needs registry or GitHub access and a version match on every machine.
- Copy files with `scp`, then run commands. This needs temporary files and shell-specific quoting on Windows.
- Run a daemon on each machine. This adds a service, a port, and a trust boundary.

## Consequences

- A remote command sends about 0.5 MB of agent code, plus the profile, in each SSH session.
- The local and remote engines always have the same version.
- The remote state and apply records persist. The profile copy does not.
- `--send-secrets` puts secret values in the SSH session. ade keeps it off by default.
