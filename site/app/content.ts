export const REPO_URL = "https://github.com/woosal1337/ade";
export const DOCS_URL = `${REPO_URL}/blob/main/docs`;
export const PACKAGE = "github:woosal1337/ade";
export const INSTALL_SH =
  "https://raw.githubusercontent.com/woosal1337/ade/main/scripts/install.sh";
export const INSTALL_PS1 =
  "https://raw.githubusercontent.com/woosal1337/ade/main/scripts/install.ps1";

export const NAV = [
  { label: "Capture", n: "01", href: "#capture" },
  { label: "Plan", n: "02", href: "#plan" },
  { label: "Apply", n: "03", href: "#apply" },
  { label: "Share", n: "04", href: "#share" },
] as const;

export const HARNESS_NAMES = [
  "Claude Code",
  "Codex",
  "Cursor",
  "Grok",
  "Pi",
  "Gemini CLI",
  "OpenCode",
  "Zed",
  "Claude Desktop",
  "Antigravity",
] as const;

export type Support = "yes" | "no" | "partial";

export interface HarnessRow {
  readonly name: string;
  readonly instructions: Support;
  readonly mcp: Support;
  readonly skills: Support;
  readonly settings: Support;
  readonly plugins: Support;
  readonly extras: string;
}

export const HARNESSES: readonly HarnessRow[] = [
  {
    name: "Claude Code",
    instructions: "yes",
    mcp: "yes",
    skills: "yes",
    settings: "yes",
    plugins: "yes",
    extras: "agents, commands, hooks, output styles, local MCP servers",
  },
  {
    name: "Codex",
    instructions: "yes",
    mcp: "yes",
    skills: "yes",
    settings: "yes",
    plugins: "yes",
    extras: "prompts, rules, agents, hooks",
  },
  {
    name: "Cursor",
    instructions: "no",
    mcp: "yes",
    skills: "yes",
    settings: "yes",
    plugins: "yes",
    extras: "CLI and IDE settings, hooks, agents, commands, rules",
  },
  {
    name: "Grok",
    instructions: "yes",
    mcp: "yes",
    skills: "yes",
    settings: "yes",
    plugins: "yes",
    extras: "hooks, agents, commands, local plugins",
  },
  {
    name: "Pi",
    instructions: "yes",
    mcp: "yes",
    skills: "yes",
    settings: "yes",
    plugins: "yes",
    extras: "packages, extensions, prompts, themes, package patches",
  },
  {
    name: "Gemini CLI",
    instructions: "yes",
    mcp: "yes",
    skills: "yes",
    settings: "yes",
    plugins: "yes",
    extras: "agents, commands, policies",
  },
  {
    name: "OpenCode",
    instructions: "yes",
    mcp: "yes",
    skills: "yes",
    settings: "yes",
    plugins: "partial",
    extras: "agents, commands, modes, tools, themes",
  },
  {
    name: "Zed",
    instructions: "no",
    mcp: "yes",
    skills: "no",
    settings: "yes",
    plugins: "yes",
    extras: "key map, tasks, snippets, themes",
  },
  {
    name: "Claude Desktop",
    instructions: "no",
    mcp: "partial",
    skills: "no",
    settings: "yes",
    plugins: "partial",
    extras: "desktop extensions",
  },
  {
    name: "Antigravity",
    instructions: "yes",
    mcp: "yes",
    skills: "yes",
    settings: "yes",
    plugins: "no",
    extras: "hooks, global workflows",
  },
];

export interface Feature {
  readonly id: string;
  readonly n: string;
  readonly title: string;
  readonly body: string;
  readonly points: readonly string[];
  readonly command: string;
}

export const FEATURES: readonly Feature[] = [
  {
    id: "capture",
    n: "01",
    title: "Capture",
    body: "Read the agent setup of this machine into one profile folder.",
    points: [
      "Ten harnesses in one pass",
      "Tokens become ${secret:NAME} references",
      "ade inventory shows each file and its status",
    ],
    command: "ade capture --out ~/agent-profile",
  },
  {
    id: "plan",
    n: "02",
    title: "Plan",
    body: "See every change before ade writes a file. A plan never writes.",
    points: [
      "One entry at a time: a server, a key, a file",
      "Drift shows edits made outside ade",
      "JSON output for scripts and CI",
    ],
    command: "ade plan",
  },
  {
    id: "apply",
    n: "03",
    title: "Apply",
    body: "Make the machine match the profile. Each apply keeps a backup.",
    points: [
      "ade revert undoes one apply",
      "A failed apply rolls back its writes",
      "ade remote applies over SSH",
    ],
    command: "ade apply",
  },
  {
    id: "share",
    n: "04",
    title: "Share",
    body: "Put the whole setup in one ADE.md, in any repository.",
    points: [
      "A SHA-256 hash for each file",
      "A trust summary before the first apply",
      "ade verify checks the file in CI",
    ],
    command: "ade share --repo you/agents",
  },
];

export interface CommandGroup {
  readonly title: string;
  readonly rows: readonly (readonly [string, string])[];
}

export const COMMANDS: readonly CommandGroup[] = [
  {
    title: "Profile",
    rows: [
      ["ade capture", "Read this machine into a profile"],
      ["ade init", "Make an empty profile"],
      ["ade add, remove, set", "Edit the profile"],
      ["ade list", "Show the profile entries"],
    ],
  },
  {
    title: "Machine",
    rows: [
      ["ade plan", "Show the changes, write nothing"],
      ["ade apply", "Write the changes with a backup"],
      ["ade status", "Show drift"],
      ["ade revert", "Undo an apply"],
      ["ade inventory", "List each harness file"],
      ["ade doctor", "Check secrets, skills, and files"],
    ],
  },
  {
    title: "Share",
    rows: [
      ["ade share", "Write ADE.md"],
      ["ade verify", "Check an ADE.md"],
      ["ade import", "Copy a source into a folder"],
      ["ade trust", "Trust a Git source"],
      ["ade use", "Set the default source"],
      ["ade remote", "Run a command over SSH"],
    ],
  },
];

export const QUICK_START = [
  { title: "Capture this machine", command: "ade capture --out ~/agent-profile" },
  { title: "Show the plan", command: "ade plan --profile ~/agent-profile" },
  { title: "Write ADE.md", command: "ade share --profile ~/agent-profile --repo you/agents" },
  { title: "Apply it on another machine", command: "ade apply you/agents" },
] as const;

export type TermLine =
  | { readonly kind: "cmd"; readonly text: string }
  | {
      readonly kind: "out";
      readonly text: string;
      readonly tone?: "muted" | "add" | "warn" | "ok" | "head";
    };

export const TERMINAL: readonly TermLine[] = [
  { kind: "cmd", text: "ade apply acme/agents" },
  { kind: "out", text: "Source   acme/agents @ 9c54b4369133 (not trusted)", tone: "muted" },
  { kind: "out", text: "" },
  { kind: "out", text: "acme/agents @ 9c54b4369133 does these things on this machine:" },
  {
    kind: "out",
    text: "  ! mcp      github runs: npx -y @modelcontextprotocol/server-github",
    tone: "warn",
  },
  {
    kind: "out",
    text: "    mcp      docs connects to https://docs.example.com/mcp",
    tone: "muted",
  },
  {
    kind: "out",
    text: "    skill    instructions for agents: review, write-commit",
    tone: "muted",
  },
  { kind: "out", text: "Trust acme/agents @ 9c54b4369133? Type yes to continue: yes" },
  { kind: "out", text: "" },
  { kind: "out", text: "shared", tone: "head" },
  { kind: "out", text: "  + instructions  AGENTS.md      file, 317 bytes", tone: "add" },
  {
    kind: "out",
    text: "  + skill         write-commit   copy of ~/.cache/ade/trees/…",
    tone: "add",
  },
  { kind: "out", text: "claude", tone: "head" },
  {
    kind: "out",
    text: '  + mcp           docs           {"type":"http","url":"https://docs…"}',
    tone: "add",
  },
  { kind: "out", text: "pi", tone: "head" },
  {
    kind: "out",
    text: '  + mcp           docs           {"url":"https://docs.example.com/mcp"}',
    tone: "add",
  },
  { kind: "out", text: "" },
  { kind: "out", text: "Plan: 7 to create, 0 to update, 0 to delete. 0 already match." },
  {
    kind: "out",
    text: "Applied 7 changes with 7 writes. Record: 20261012-090000-000-a1b2.",
    tone: "ok",
  },
];

export const ADE_MD_SAMPLE = `---
ade: 1
name: "team"
harnesses: ["claude", "codex", "pi"]
secrets: ["GITHUB_TOKEN"]
files: 5
digest: "sha256:4f1c9e…"
---

# team

## Use this setup
ade apply acme/agents

## What this setup does
|   | Area  | Item |
|---|---|---|
| ! | mcp   | github runs: npx -y @modelcontextprotocol/server-github |
|   | skill | instructions for agents: review |

## Files

\`\`\`markdown ade-file path="skills/review/SKILL.md" sha256="9b1e…"
---
name: review
description: Review a change before a merge.
---
\`\`\``;
