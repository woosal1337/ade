import path from "node:path";
import type { Context } from "../core/context.ts";
import { fromNative, fromOpenCode, type NativeShape, toNative, toOpenCode } from "./mcp.ts";
import { appConfigDir, cursorUserDir, xdgConfig, zedConfigDir } from "./paths.ts";
import {
  claudePlugins,
  codexPlugins,
  cursorExtensions,
  geminiExtensions,
  grokPlugins,
  zedExtensions,
} from "./plugins.ts";
import type { HarnessAdapter } from "./types.ts";

function homeFrom(ctx: Context, variable: string, ...fallback: string[]): string {
  const custom = ctx.env[variable];
  return custom ? path.resolve(custom) : path.join(ctx.home, ...fallback);
}

function shape(label: string, options: Partial<NativeShape>): NativeShape {
  return {
    typeField: "none",
    urlKey: "url",
    headersKey: "headers",
    supportsCwd: false,
    enabledStyle: "none",
    supportsDescription: false,
    label,
    ...options,
  };
}

const BACKUPS = ["*.bak", "*.bak-*", "*.bak.*", "*.backup", "*.orig", "*.tmp", "*.lock", "*~"];
const LOGS = ["*.log", "log", "logs"];

const claudeShape = shape("Claude Code", { typeField: "always" });
const claudeHome = (ctx: Context): string => homeFrom(ctx, "CLAUDE_CONFIG_DIR", ".claude");

export const claude: HarnessAdapter = {
  id: "claude",
  label: "Claude Code",
  readsSharedSkills: false,
  supportsMcpEnabled: false,
  reservedSettingsKeys: ["extraKnownMarketplaces", "enabledPlugins"],
  captureExclude: [],
  assets: [
    { path: "agents", kind: "dir" },
    { path: "commands", kind: "dir" },
    { path: "output-styles", kind: "dir" },
    { path: "hooks", kind: "dir" },
    { path: "keybindings.json", kind: "file" },
  ],
  plugins: claudePlugins(claudeHome),
  home: claudeHome,
  instructionsPath: (ctx) => path.join(claudeHome(ctx), "CLAUDE.md"),
  skillsDir: (ctx) => path.join(claudeHome(ctx), "skills"),
  mcpLocation: (ctx) => ({
    path: ctx.env.CLAUDE_CONFIG_DIR
      ? path.join(claudeHome(ctx), ".claude.json")
      : path.join(ctx.home, ".claude.json"),
    format: "json",
    pointer: ["mcpServers"],
  }),
  settingsLocation: (ctx) => ({
    path: path.join(claudeHome(ctx), "settings.json"),
    format: "json",
  }),
  toNativeMcp: (server) => toNative(server, claudeShape),
  fromNativeMcp: (value) => fromNative(value, claudeShape),
  captureSkillDirs: (ctx) => [path.join(claudeHome(ctx), "skills")],
  inventoryDirs: (ctx) => [
    {
      dir: claudeHome(ctx),
      root: "claude",
      private: [".credentials.json", "daemon-auth-*"],
      runtime: [
        ...BACKUPS,
        ...LOGS,
        ".last-*",
        "backups",
        "bridge-spawn",
        "cache",
        "chrome",
        "daemon",
        "debug",
        "file-history",
        "history.jsonl",
        "ide",
        "jobs",
        "mcp-needs-auth-cache.json",
        "paste-cache",
        "plans",
        "projects",
        "session-env",
        "sessions",
        "settings.json.*",
        "shell-snapshots",
        "statsig",
        "stats-cache.json",
        "telemetry",
        "todos",
        "tmp",
        "plugins/cache",
        "plugins/data",
        "plugins/marketplaces",
        "plugins/repos",
        "plugins/plugin-directory-cache*",
        "plugins/synced",
        "skills/synced",
      ],
    },
  ],
};

const codexShape = shape("Codex", {
  headersKey: "http_headers",
  supportsCwd: true,
  enabledStyle: "enabled",
});
const codexHome = (ctx: Context): string => homeFrom(ctx, "CODEX_HOME", ".codex");

export const codex: HarnessAdapter = {
  id: "codex",
  label: "Codex",
  readsSharedSkills: true,
  supportsMcpEnabled: true,
  reservedSettingsKeys: ["mcp_servers", "marketplaces", "plugins"],
  captureExclude: [["projects"], ["notice"]],
  assets: [
    { path: "prompts", kind: "dir" },
    { path: "rules", kind: "dir" },
    { path: "agents", kind: "dir" },
    { path: "hooks.json", kind: "doc" },
  ],
  plugins: codexPlugins((ctx) => path.join(codexHome(ctx), "config.toml")),
  home: codexHome,
  instructionsPath: (ctx) => path.join(codexHome(ctx), "AGENTS.md"),
  skillsDir: () => undefined,
  mcpLocation: (ctx) => ({
    path: path.join(codexHome(ctx), "config.toml"),
    format: "toml",
    pointer: ["mcp_servers"],
  }),
  settingsLocation: (ctx) => ({ path: path.join(codexHome(ctx), "config.toml"), format: "toml" }),
  toNativeMcp: (server) => toNative(server, codexShape),
  fromNativeMcp: (value) => fromNative(value, codexShape),
  captureSkillDirs: (ctx) => [path.join(codexHome(ctx), "skills")],
  inventoryDirs: (ctx) => [
    {
      dir: codexHome(ctx),
      root: "codex",
      private: ["auth.json", "installation_id"],
      runtime: [
        ...BACKUPS,
        ...LOGS,
        "*.sqlite",
        "*.sqlite-shm",
        "*.sqlite-wal",
        ".sandbox_migration",
        ".tmp",
        "history.jsonl",
        "models_cache.json",
        "plugins",
        "sessions",
        "shell_snapshots",
        "thread-writer-locks",
        "tmp",
        "version.json",
      ],
    },
  ],
};

const cursorShape = shape("Cursor", {});
const cursorHome = (ctx: Context): string => path.join(ctx.home, ".cursor");

export const cursor: HarnessAdapter = {
  id: "cursor",
  label: "Cursor",
  readsSharedSkills: true,
  supportsMcpEnabled: false,
  reservedSettingsKeys: [],
  captureExclude: [
    ["version"],
    ["authInfo"],
    ["privacyCache"],
    ["autoReviewAvailabilityCache"],
    ["serverConfigCache"],
    ["modelSelectionHistory"],
    ["hasChangedDefaultModel"],
    ["runEverythingSettingsPromptStreak"],
  ],
  assets: [
    { path: "hooks.json", kind: "doc" },
    { path: "hooks", kind: "dir" },
    { path: "agents", kind: "dir" },
    { path: "commands", kind: "dir" },
    { path: "rules", kind: "dir" },
    { path: "plugins/local", kind: "dir" },
    { root: "cursor-user", path: "settings.json", kind: "doc" },
    { root: "cursor-user", path: "keybindings.json", kind: "file" },
    { root: "cursor-user", path: "snippets", kind: "dir" },
  ],
  plugins: cursorExtensions((ctx) => path.join(cursorHome(ctx), "extensions")),
  home: cursorHome,
  instructionsPath: () => undefined,
  skillsDir: () => undefined,
  mcpLocation: (ctx) => ({
    path: path.join(cursorHome(ctx), "mcp.json"),
    format: "json",
    pointer: ["mcpServers"],
  }),
  settingsLocation: (ctx) => ({
    path: path.join(cursorHome(ctx), "cli-config.json"),
    format: "json",
  }),
  toNativeMcp: (server) => toNative(server, cursorShape),
  fromNativeMcp: (value) => fromNative(value, cursorShape),
  captureSkillDirs: (ctx) => [path.join(cursorHome(ctx), "skills")],
  inventoryDirs: (ctx) => [
    {
      dir: cursorHome(ctx),
      root: "cursor",
      private: ["sdk"],
      runtime: [
        ...BACKUPS,
        ...LOGS,
        ".gitignore",
        "acp-sessions",
        "agent-cli-state.json",
        "ai-tracking",
        "argv.json",
        "chats",
        "extensions/*",
        "plugins/cache",
        "projects",
        "sandbox-policies",
        "skills-cursor",
        "statsig-cache.json",
      ],
    },
    {
      dir: cursorUserDir(ctx),
      root: "cursor-user",
      private: [],
      runtime: ["History", "globalStorage", "workspaceStorage", "sync", ...LOGS],
    },
  ],
};

const grokShape = shape("Grok", { enabledStyle: "enabled" });
const grokHome = (ctx: Context): string => homeFrom(ctx, "GROK_HOME", ".grok");

export const grok: HarnessAdapter = {
  id: "grok",
  label: "Grok",
  readsSharedSkills: true,
  supportsMcpEnabled: true,
  reservedSettingsKeys: ["mcp_servers"],
  captureExclude: [
    ["cli"],
    ["privacy"],
    ["marketplace"],
    ["disabled_mcp_servers"],
    ["plugins", "enabled"],
  ],
  assets: [
    { path: "hooks", kind: "dir" },
    { path: "agents", kind: "dir" },
    { path: "commands", kind: "dir" },
    { path: "plugins", kind: "dir" },
  ],
  plugins: grokPlugins(),
  home: grokHome,
  instructionsPath: (ctx) => path.join(grokHome(ctx), "AGENTS.md"),
  skillsDir: () => undefined,
  mcpLocation: (ctx) => ({
    path: path.join(grokHome(ctx), "config.toml"),
    format: "toml",
    pointer: ["mcp_servers"],
  }),
  settingsLocation: (ctx) => ({ path: path.join(grokHome(ctx), "config.toml"), format: "toml" }),
  toNativeMcp: (server) => toNative(server, grokShape),
  fromNativeMcp: (value) => fromNative(value, grokShape),
  captureSkillDirs: (ctx) => [path.join(grokHome(ctx), "skills")],
  inventoryDirs: (ctx) => [
    {
      dir: grokHome(ctx),
      root: "grok",
      private: ["auth.json", "agent_id", "trusted_folders.toml", "hooks-paths"],
      runtime: [
        ...BACKUPS,
        ...LOGS,
        ".config-init.lock",
        ".metadata_version",
        "README.md",
        "active_sessions.json",
        "bin",
        "bundled",
        "campaigns_state.json",
        "completions",
        "config.toml.*",
        "docs",
        "downloads",
        "grove",
        "installed-plugins",
        "last-copy.txt",
        "marketplace-cache",
        "memory",
        "memory-v2",
        "memtrace",
        "models_cache.json",
        "relocations",
        "sessions",
        "settings_cache.json",
        "slash-mru.json",
        "tip_cursor.json",
        "vendor",
        "version.json",
        "worktrees.db",
      ],
    },
  ],
};

const piShape = shape("Pi", {
  supportsCwd: true,
  enabledStyle: "enabled",
  supportsDescription: true,
});
const piHome = (ctx: Context): string => homeFrom(ctx, "PI_CODING_AGENT_DIR", ".pi", "agent");

export const PI_KNOWN_ENTRIES = new Set([
  "AGENTS.md",
  "auth.json",
  "bin",
  "extensions",
  "git",
  "install",
  "keybindings.json",
  "mcp-auth.json",
  "mcp.json",
  "models-store.json",
  "npm",
  "prompts",
  "sessions",
  "settings.json",
  "skills",
  "themes",
  "tmp",
  "zeron-sessions",
]);

export const pi: HarnessAdapter = {
  id: "pi",
  label: "Pi",
  readsSharedSkills: true,
  supportsMcpEnabled: true,
  reservedSettingsKeys: [],
  captureExclude: [["lastChangelogVersion"]],
  assets: [
    { path: "extensions", kind: "dir" },
    { path: "prompts", kind: "dir" },
    { path: "themes", kind: "dir" },
    { path: "keybindings.json", kind: "file" },
    { path: "models-store.json", kind: "file", once: true },
  ],
  home: piHome,
  instructionsPath: (ctx) => path.join(piHome(ctx), "AGENTS.md"),
  skillsDir: () => undefined,
  mcpLocation: (ctx) => ({
    path: path.join(piHome(ctx), "mcp.json"),
    format: "json",
    pointer: ["mcpServers"],
  }),
  settingsLocation: (ctx) => ({ path: path.join(piHome(ctx), "settings.json"), format: "json" }),
  toNativeMcp: (server) => toNative(server, piShape),
  fromNativeMcp: (value) => fromNative(value, piShape),
  captureSkillDirs: (ctx) => [path.join(piHome(ctx), "skills")],
  inventoryDirs: (ctx) => [
    {
      dir: piHome(ctx),
      root: "pi",
      private: ["auth.json", "mcp-auth.json"],
      runtime: [
        ...BACKUPS,
        ...LOGS,
        "*.json.bak",
        "bin",
        "git",
        "install",
        "mcp.log*",
        "npm",
        "sessions",
        "tmp",
        "zeron-sessions",
      ],
    },
  ],
};

const geminiShape = shape("Gemini CLI", {
  urlKey: "httpUrl",
  supportsCwd: true,
  supportsDescription: true,
});
const geminiHome = (ctx: Context): string => path.join(ctx.home, ".gemini");

export const gemini: HarnessAdapter = {
  id: "gemini",
  label: "Gemini CLI",
  readsSharedSkills: true,
  supportsMcpEnabled: false,
  reservedSettingsKeys: ["mcpServers"],
  captureExclude: [],
  assets: [
    { path: "agents", kind: "dir" },
    { path: "commands", kind: "dir" },
    { path: "policies", kind: "dir" },
  ],
  plugins: geminiExtensions(geminiHome),
  home: geminiHome,
  instructionsPath: (ctx) => path.join(geminiHome(ctx), "GEMINI.md"),
  skillsDir: () => undefined,
  mcpLocation: (ctx) => ({
    path: path.join(geminiHome(ctx), "settings.json"),
    format: "json",
    pointer: ["mcpServers"],
  }),
  settingsLocation: (ctx) => ({
    path: path.join(geminiHome(ctx), "settings.json"),
    format: "json",
  }),
  toNativeMcp: (server) => toNative(server, geminiShape),
  fromNativeMcp: (value) => fromNative(value, geminiShape),
  captureSkillDirs: (ctx) => [path.join(geminiHome(ctx), "skills")],
  inventoryDirs: (ctx) => [
    {
      dir: geminiHome(ctx),
      root: "gemini",
      private: [
        "oauth_creds.json",
        "google_accounts.json",
        "mcp-oauth-tokens*",
        "installation_id",
        "user_id",
        "trustedFolders.json",
      ],
      runtime: [
        ...BACKUPS,
        ...LOGS,
        "bin",
        "cli-browser-profile",
        "extensions",
        "history",
        "projects.json",
        "projects.json.*",
        "tmp",
      ],
      other: {
        antigravity: "Antigravity",
        "antigravity-cli": "Antigravity",
        config: "Antigravity",
      },
    },
  ],
};

const opencodeHome = (ctx: Context): string => path.join(xdgConfig(ctx), "opencode");

export const opencode: HarnessAdapter = {
  id: "opencode",
  label: "OpenCode",
  readsSharedSkills: true,
  supportsMcpEnabled: true,
  reservedSettingsKeys: ["mcp"],
  captureExclude: [],
  assets: [
    { path: "tui.json", kind: "doc" },
    { path: "agents", kind: "dir" },
    { path: "commands", kind: "dir" },
    { path: "modes", kind: "dir" },
    { path: "plugins", kind: "dir" },
    { path: "tools", kind: "dir" },
    { path: "themes", kind: "dir" },
  ],
  home: opencodeHome,
  instructionsPath: (ctx) => path.join(opencodeHome(ctx), "AGENTS.md"),
  skillsDir: () => undefined,
  mcpLocation: (ctx) => ({
    path: path.join(opencodeHome(ctx), "opencode.json"),
    format: "json",
    pointer: ["mcp"],
  }),
  settingsLocation: (ctx) => ({
    path: path.join(opencodeHome(ctx), "opencode.json"),
    format: "json",
  }),
  toNativeMcp: toOpenCode,
  fromNativeMcp: fromOpenCode,
  captureSkillDirs: (ctx) => [path.join(opencodeHome(ctx), "skills")],
  inventoryDirs: (ctx) => [
    {
      dir: opencodeHome(ctx),
      root: "opencode",
      private: [],
      runtime: [
        ...BACKUPS,
        ...LOGS,
        "node_modules",
        "package.json",
        "bun.lock",
        "package-lock.json",
      ],
    },
  ],
};

const zedShape = shape("Zed", {});

export const zed: HarnessAdapter = {
  id: "zed",
  label: "Zed",
  readsSharedSkills: false,
  supportsMcpEnabled: false,
  reservedSettingsKeys: ["context_servers", "auto_install_extensions"],
  captureExclude: [],
  plugins: zedExtensions(),
  assets: [
    { path: "keymap.json", kind: "file" },
    { path: "tasks.json", kind: "file" },
    { path: "snippets", kind: "dir" },
    { path: "themes", kind: "dir" },
  ],
  home: zedConfigDir,
  instructionsPath: () => undefined,
  skillsDir: () => undefined,
  mcpLocation: (ctx) => ({
    path: path.join(zedConfigDir(ctx), "settings.json"),
    format: "json",
    pointer: ["context_servers"],
  }),
  settingsLocation: (ctx) => ({
    path: path.join(zedConfigDir(ctx), "settings.json"),
    format: "json",
  }),
  toNativeMcp: (server) => toNative(server, zedShape),
  fromNativeMcp: (value) => fromNative(value, zedShape),
  captureSkillDirs: () => [],
  inventoryDirs: (ctx) => [
    {
      dir: zedConfigDir(ctx),
      root: "zed",
      private: [],
      runtime: [...BACKUPS, ...LOGS, "prompts", "conversations", "embeddings"],
    },
  ],
};

const desktopShape = shape("Claude Desktop", { stdioOnly: true });
const desktopHome = (ctx: Context): string => appConfigDir(ctx, "Claude");

export const claudeDesktop: HarnessAdapter = {
  id: "claude-desktop",
  label: "Claude Desktop",
  readsSharedSkills: false,
  supportsMcpEnabled: false,
  reservedSettingsKeys: ["mcpServers"],
  captureExclude: [],
  assets: [
    { path: "Claude Extensions", kind: "dir" },
    { path: "Claude Extensions Settings", kind: "dir" },
    { path: "extensions-installations.json", kind: "doc" },
  ],
  home: desktopHome,
  instructionsPath: () => undefined,
  skillsDir: () => undefined,
  mcpLocation: (ctx) => ({
    path: path.join(desktopHome(ctx), "claude_desktop_config.json"),
    format: "json",
    pointer: ["mcpServers"],
  }),
  settingsLocation: (ctx) => ({
    path: path.join(desktopHome(ctx), "claude_desktop_config.json"),
    format: "json",
  }),
  toNativeMcp: (server) => toNative(server, desktopShape),
  fromNativeMcp: (value) => fromNative(value, desktopShape),
  captureSkillDirs: () => [],
  inventoryDirs: (ctx) => [
    {
      dir: desktopHome(ctx),
      root: "claude-desktop",
      private: ["config.json", "Cookies*", "Local Storage", "Session Storage", "Trust Tokens*"],
      runtime: [
        ...BACKUPS,
        ...LOGS,
        "blob_storage",
        "Cache",
        "Code Cache",
        "Crashpad",
        "DawnCache",
        "DawnGraphiteCache",
        "DawnWebGPUCache",
        "Dictionaries",
        "GPUCache",
        "IndexedDB",
        "Network*",
        "Partitions",
        "Preferences",
        "sentry",
        "Service Worker",
        "Shared Dictionary",
        "SharedStorage*",
        "shared_proto_db",
        "TransportSecurity",
        "VideoDecodeStats",
        "WebStorage",
        "window-state.json",
        "claude-code*",
        "vm_bundles",
        "git-worktrees.json",
      ],
    },
  ],
};

const antigravityShape = shape("Antigravity", { urlKey: "serverUrl", enabledStyle: "disabled" });
const antigravityHome = (ctx: Context): string => path.join(ctx.home, ".gemini", "config");
const antigravityCli = (ctx: Context): string => path.join(ctx.home, ".gemini", "antigravity-cli");

export const antigravity: HarnessAdapter = {
  id: "antigravity",
  label: "Antigravity",
  readsSharedSkills: false,
  supportsMcpEnabled: true,
  reservedSettingsKeys: [],
  captureExclude: [["trustedWorkspaces"]],
  assets: [
    { path: "hooks.json", kind: "doc" },
    { path: "hooks", kind: "dir" },
    { path: "global_workflows", kind: "dir" },
  ],
  home: antigravityHome,
  instructionsPath: (ctx) => path.join(ctx.home, ".gemini", "GEMINI.md"),
  skillsDir: (ctx) => path.join(antigravityHome(ctx), "skills"),
  mcpLocation: (ctx) => ({
    path: path.join(antigravityHome(ctx), "mcp_config.json"),
    format: "json",
    pointer: ["mcpServers"],
  }),
  settingsLocation: (ctx) => ({
    path: path.join(antigravityCli(ctx), "settings.json"),
    format: "json",
  }),
  toNativeMcp: (server) => toNative(server, antigravityShape),
  fromNativeMcp: (value) => fromNative(value, antigravityShape),
  captureSkillDirs: (ctx) => [path.join(antigravityHome(ctx), "skills")],
  inventoryDirs: (ctx) => [
    {
      dir: antigravityHome(ctx),
      root: "antigravity",
      private: [],
      runtime: [...BACKUPS, ...LOGS, ".migrated", "config.json", "projects", "workflows.json"],
    },
    {
      dir: antigravityCli(ctx),
      root: undefined,
      private: ["installation_id"],
      runtime: [
        ...BACKUPS,
        ...LOGS,
        "annotations",
        "bin",
        "brain",
        "builtin",
        "cache",
        "conversation_summaries.db",
        "conversations",
        "crashes",
        "history.jsonl",
        "implicit",
        "jetski_state.pbtxt",
        "knowledge",
        "last_check.timestamp",
        "presence",
        "scratch",
        "updater",
      ],
    },
  ],
};
