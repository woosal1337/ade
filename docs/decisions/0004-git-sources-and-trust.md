# 0004: Git profile sources and trust

Date: 2026-10-12

Status: Accepted for version 0.1.0.

## Context

Users want to sync a machine 1:1 with a published setup, the way `brew tap owner/repo` adds a formula source. A published profile comes from another person. It can declare stdio MCP servers, hooks, permissions, packages, home files, and secret sources. Each of these can run code or send data out of the machine.

## Decision

1. A command that reads a profile takes a source: a local folder, `owner/repo[/subfolder][@ref]` on GitHub, or a Git URL with `//subfolder` and `#ref`.
2. ade resolves the ref to a commit, checks out that commit into the cache, and loads the profile from there. The tree in the cache does not change.
3. ade derives a risk summary from the profile. The summary lists programs, connections that send secrets, home and harness files, secret sources, permission and execution settings, link skills, Git skills, and skill names.
4. A Git source needs trust before an apply. Trust records the source, the commit, and the summary lines. A new commit with the same summary lines stays trusted. A new commit with other lines needs trust again.
5. Before trust, a plan uses placeholder secret values. It never runs a secret command and never reads a secret file or the Keychain.
6. `ade pack` writes a self-contained profile for publication and refuses values that look like tokens or private keys.

## Alternatives

- Trust each commit. This asks again for each change in a skill text, and users learn to type yes without reading.
- Trust a source one time for all later commits. A later commit can add a stdio server or a home file without a prompt.
- Allow only a safe subset in published profiles. This blocks hooks, packages, and files that real setups need.

## Consequences

- A change in skill or instruction text applies without a new prompt. Users who want a fixed state pin a commit.
- The summary depends on a list of keys that mark execution and permission settings. A harness that adds a new such key needs an update of the list.
- Editing commands refuse a Git source. Users edit the repository, or they pack a local copy.
