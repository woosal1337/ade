# Security policy

## Report a vulnerability

Do not report a security problem in a public issue.

1. Open the **Security** tab of the repository.
2. Select **Report a vulnerability**. GitHub sends a private advisory to the maintainer.
3. Give the ade version, the operating system, the steps, and the result that you saw.

The maintainer replies in the advisory. A fix ships in a new release, and the advisory names the version with the fix.

## Supported versions

| Version | Security fixes |
|---|---|
| 0.1.x | Yes |

## Scope

These problems are in scope:

- A shared profile that runs a program, writes a file, or reads a secret before you trust it.
- A change in a trusted source that ade applies with no new trust prompt.
- A path in a profile that reads or writes outside its root.
- A secret value in plan output, in a shared file, in the state folder of another user, or on a remote host without `--send-secrets`.
- Profile text or remote output that controls your terminal.

These problems are not in scope:

- An action of a profile that you trusted. A trusted profile can run programs as you. Read [the security model](docs/security.md).
- The behavior of a harness after ade writes its configuration.
- A problem that needs a changed copy of ade or root access on your machine.

Read [the security model](docs/security.md) for the trust gate, the secret handling, and the known limits.
