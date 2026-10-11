---
name: write-commit
description: Write a focused Git commit message for the staged changes. Use when the user asks for a commit message or a commit.
---

# Write a commit message

1. Run `git diff --cached` to read the staged changes.
2. Write a title in the imperative mood, at most 72 characters.
3. Add a body only when the reason is not clear from the title.
4. Keep one change per commit. Ask before you split staged work.
