# 0005: Full coverage of harness files

Date: 2026-10-12

Status: Accepted for version 0.1.0.

## Context

Version 0.1.0 synced instructions, MCP servers, skills, and the main settings file of 5 harnesses. A check of one Mac found hook scripts, output styles, Pi extensions, plugin installs, a model catalog, a local package fix, and 5 more harnesses that ade did not sync. A user could not see these gaps.

## Decision

1. Each adapter declares asset rules: the folders and files of its harness that hold user configuration.
2. Each adapter declares inventory rules: private names that ade never reads, and runtime names that the harness writes. `ade inventory` classifies each entry of each harness home with these rules.
3. Capture takes each small text file that no rule covers as an extra file. A folder that no rule covers stays unknown, and inventory reports it.
4. Capture takes the files that settings name, such as hook and status line scripts.
5. A file that is a link keeps its link target and its content. Apply makes the link when the target exists.
6. Plugins install through the harness commands, because each harness keeps its own registry and cache. Zed has no command, so ade writes `auto_install_extensions`.
7. Apply runs the plugin commands before it writes files. A harness can migrate its own settings when it starts. This order keeps the ade values after the migration.
8. A local change to a Pi Git package becomes a patch. Apply runs `git apply` when the checkout exists.
9. ade reads JSON with comments. A write removes the comments, and the plan warns first.

## Alternatives

- Copy whole harness homes. This copies tokens, sessions, and caches, and it breaks the harness state on the target.
- Copy plugin caches. Each harness checks its own registry, so a copied cache can disagree with the registry.
- Capture unknown folders. A hook state folder with hundreds of files would enter the profile.
- Write a JSON writer that keeps comments. This needs a second parser and a format-preserving editor for each format.

## Consequences

- A harness that adds a new configuration folder needs a new asset rule. Until then, inventory shows it as unknown.
- Plugin sync needs the harness program on the PATH of the target.
- A plugin revert can leave harness state files, such as a marketplace clone.
- A patch waits until the harness installs the package. The plan warns until then.
