export const REPO_URL = "https://github.com/woosal1337/ade";
export const DOCS_URL = `${REPO_URL}/blob/main/docs`;
export const PACKAGE = "github:woosal1337/ade";
export const INSTALL_SH =
  "https://raw.githubusercontent.com/woosal1337/ade/main/scripts/install.sh";
export const INSTALL_PS1 =
  "https://raw.githubusercontent.com/woosal1337/ade/main/scripts/install.ps1";
export const INSTALL_COMMAND = `curl -fsSL ${INSTALL_SH} | sh`;
export const NPM_INSTALL_COMMAND = `npm install -g "$(npm pack ${PACKAGE} | tail -1)"`;

export const NAV = [
  { label: "Capture", n: "01", href: "#capture" },
  { label: "Share", n: "02", href: "#share" },
  { label: "Import", n: "03", href: "#import" },
  { label: "Plan", n: "04", href: "#plan" },
  { label: "Apply", n: "05", href: "#apply" },
] as const;

export type Support = "yes" | "no" | "partial";

export interface HarnessRow {
  readonly id: string;
  readonly name: string;
  readonly instructions: Support;
  readonly mcp: Support;
  readonly skills: Support;
  readonly settings: Support;
  readonly plugins: Support;
}

export const HARNESSES: readonly HarnessRow[] = [
  {
    id: "claude",
    name: "Claude Code",
    instructions: "yes",
    mcp: "yes",
    skills: "yes",
    settings: "yes",
    plugins: "yes",
  },
  {
    id: "codex",
    name: "Codex",
    instructions: "yes",
    mcp: "yes",
    skills: "yes",
    settings: "yes",
    plugins: "yes",
  },
  {
    id: "cursor",
    name: "Cursor",
    instructions: "no",
    mcp: "yes",
    skills: "yes",
    settings: "yes",
    plugins: "yes",
  },
  {
    id: "grok",
    name: "Grok",
    instructions: "yes",
    mcp: "yes",
    skills: "yes",
    settings: "yes",
    plugins: "yes",
  },
  {
    id: "pi",
    name: "Pi",
    instructions: "yes",
    mcp: "yes",
    skills: "yes",
    settings: "yes",
    plugins: "yes",
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    instructions: "yes",
    mcp: "yes",
    skills: "yes",
    settings: "yes",
    plugins: "yes",
  },
  {
    id: "opencode",
    name: "OpenCode",
    instructions: "yes",
    mcp: "yes",
    skills: "yes",
    settings: "yes",
    plugins: "partial",
  },
  {
    id: "zed",
    name: "Zed",
    instructions: "no",
    mcp: "yes",
    skills: "no",
    settings: "yes",
    plugins: "yes",
  },
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    instructions: "no",
    mcp: "partial",
    skills: "no",
    settings: "yes",
    plugins: "partial",
  },
  {
    id: "antigravity",
    name: "Antigravity",
    instructions: "yes",
    mcp: "yes",
    skills: "yes",
    settings: "yes",
    plugins: "no",
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
    command: "ade capture",
  },
  {
    id: "share",
    n: "02",
    title: "Share",
    body: "Put the whole setup in one ADE.md, in any repository.",
    points: [
      "A SHA-256 hash for each file",
      "A trust summary for each person who imports it",
      "ade verify checks the file in CI",
    ],
    command: "ade share --repo you/agents",
  },
  {
    id: "import",
    n: "03",
    title: "Import",
    body: "Copy any shared setup into the profile folder on this machine.",
    points: [
      "Reads ADE.md from a repository, a folder, or a file",
      "Shows what the setup runs and writes, then asks for trust",
      "Edit the copy before you apply it",
    ],
    command: "ade import acme/agents",
  },
  {
    id: "plan",
    n: "04",
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
    n: "05",
    title: "Apply",
    body: "Make the machine match the profile. Each apply keeps a backup.",
    points: [
      "ade revert undoes one apply",
      "A failed apply rolls back its writes",
      "ade remote applies over SSH",
    ],
    command: "ade apply",
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
      ["ade import", "Copy a shared setup into a profile"],
      ["ade trust", "Trust a Git source"],
      ["ade use", "Set the default source"],
      ["ade remote", "Run a command over SSH"],
    ],
  },
];

export const QUICK_START = [
  { title: "Capture this machine", command: "ade capture" },
  { title: "Write ADE.md, then push it to you/agents", command: "ade share --repo you/agents" },
  { title: "Import it on another machine", command: "ade import you/agents" },
  { title: "Show the plan", command: "ade plan" },
  { title: "Apply it", command: "ade apply" },
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

export interface ModelSetting {
  readonly harness: string;
  readonly file: string;
  readonly key: string;
  readonly value: string;
}

export const MODEL_SETTINGS: readonly ModelSetting[] = [
  { harness: "claude", file: "settings.json", key: "model", value: '"opus"' },
  { harness: "codex", file: "config.toml", key: "model", value: '"gpt-6.1-sol"' },
  { harness: "cursor", file: "cli-config.json", key: "model.modelId", value: '"grok-4.7"' },
  { harness: "grok", file: "config.toml", key: "models.default", value: '"grok-4.5"' },
  { harness: "pi", file: "settings.json", key: "defaultModel", value: '"claude-opus-5-5"' },
  {
    harness: "gemini",
    file: "settings.json",
    key: "model.name",
    value: '"gemini-3.1-pro-preview"',
  },
  {
    harness: "opencode",
    file: "opencode.json",
    key: "model",
    value: '"anthropic/claude-opus-5-5"',
  },
  { harness: "zed", file: "settings.json", key: "agent.default_model", value: '{ "provider": … }' },
  {
    harness: "antigravity",
    file: "settings.json",
    key: "model",
    value: '"Gemini 3.8 Flash (High)"',
  },
];

export interface LoopStep {
  readonly id: string;
  readonly n: string;
  readonly name: string;
  readonly command: string;
  readonly output: string;
}

export const LOOP_STEPS: readonly LoopStep[] = [
  {
    id: "capture",
    n: "01",
    name: "Capture",
    command: "ade capture",
    output: "Captured the setup of ~ into ~/.config/ade.",
  },
  {
    id: "share",
    n: "02",
    name: "Share",
    command: "ade share",
    output: "Wrote ADE.md with 74 files.",
  },
  {
    id: "import",
    n: "03",
    name: "Import",
    command: "ade import",
    output: "Imported the profile into ~/.config/ade.",
  },
  {
    id: "plan",
    n: "04",
    name: "Plan",
    command: "ade plan",
    output: "Plan: 7 to create, 0 to update, 0 to delete.",
  },
  {
    id: "apply",
    n: "05",
    name: "Apply",
    command: "ade apply",
    output: "Applied 7 changes with 7 writes.",
  },
];
