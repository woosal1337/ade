# 0009: Trust by entry hash, and shared files need trust

Date: 2026-10-12

Status: Accepted for version 0.1.0. This decision replaces items 3 and 4 of decision 0004 for the trust comparison.

## Context

The security audit of 2026-10-12 found four gaps in the trust rule of decision 0004:

1. The trust record compared risk summary lines. The summary cut long values at 120 characters, so a change after the cut kept trust.
2. The summary used a list of execution keys. Settings outside the list, nested MCP server maps, and files under the home folder kept trust after a change.
3. The summary named a file target but not its content, and a stdio server without its environment values.
4. A local `ADE.md` file or a JSON bundle counted as the user's own profile. A plan resolved its secrets, and an apply asked for no trust.

## Decision

1. The trust record holds a SHA-256 hash of each entry that ade writes or runs: the harness list, the instructions and their content, each MCP server, each settings leaf, each file and its content, each plugin and marketplace, each patch and its content, each secret source, and each skill with its content or locked commit.
2. A new commit stays trusted only when every entry hash is equal. A commit that changes only other files in the repository keeps trust.
3. When an entry changes, the prompt lists the new, changed, and removed entries, then the full risk summary.
4. The risk summary is for display only. It no longer decides trust.
5. A local `ADE.md` file and a JSON bundle are shared files. ade records trust for them by path and content digest, the same way as for a Git commit.
6. A shared profile, from Git or from a file, cannot link to local paths, link skills to local folders, or fetch skills from local repositories. ade refuses to load such a profile.

## Alternatives

- Keep the risk lines and fix the key list. Each new harness setting then needs a list update, and the audit showed how easily the list falls behind.
- Trust each commit. A change in a repository README then asks again for no reason.

## Consequences

- A change in the instructions text or in a skill now asks for trust again. The audit treats these texts as instructions for agents with tool access.
- Trust records of version 1 have no entry hashes. The first new commit after the upgrade asks again and lists all entries.
- A shared profile must carry its files. `ade share` already copies local link targets into the `ADE.md`.
