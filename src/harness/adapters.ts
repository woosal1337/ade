import path from "node:path";
import type { Context } from "../core/context.ts";
import { fromNative, type NativeShape, toNative } from "./mcp.ts";
import type { HarnessAdapter } from "./types.ts";

function homeFrom(ctx: Context, variable: string, ...fallback: string[]): string {
  const custom = ctx.env[variable];
  return custom ? path.resolve(custom) : path.join(ctx.home, ...fallback);
}

const claudeShape: NativeShape = {
  typeField: "always",
  headersKey: "headers",
  supportsCwd: false,
  supportsEnabled: false,
  supportsDescription: false,
};

const claudeHome = (ctx: Context): string => homeFrom(ctx, "CLAUDE_CONFIG_DIR", ".claude");

export const claude: HarnessAdapter = {
  id: "claude",
  label: "Claude Code",
  readsSharedSkills: false,
  supportsMcpEnabled: false,
  reservedSettingsKeys: [],
  captureExclude: [],
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
};

const codexShape: NativeShape = {
  typeField: "none",
  headersKey: "http_headers",
  supportsCwd: true,
  supportsEnabled: true,
  supportsDescription: false,
};

const codexHome = (ctx: Context): string => homeFrom(ctx, "CODEX_HOME", ".codex");

export const codex: HarnessAdapter = {
  id: "codex",
  label: "Codex",
  readsSharedSkills: true,
  supportsMcpEnabled: true,
  reservedSettingsKeys: ["mcp_servers"],
  captureExclude: [["projects"], ["notice"]],
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
};

const cursorShape: NativeShape = {
  typeField: "none",
  headersKey: "headers",
  supportsCwd: false,
  supportsEnabled: false,
  supportsDescription: false,
};

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
};

const grokShape: NativeShape = {
  typeField: "none",
  headersKey: "headers",
  supportsCwd: false,
  supportsEnabled: true,
  supportsDescription: false,
};

const grokHome = (ctx: Context): string => homeFrom(ctx, "GROK_HOME", ".grok");

export const grok: HarnessAdapter = {
  id: "grok",
  label: "Grok",
  readsSharedSkills: true,
  supportsMcpEnabled: true,
  reservedSettingsKeys: ["mcp_servers"],
  captureExclude: [["cli"], ["privacy"], ["marketplace"], ["disabled_mcp_servers"]],
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
};

const piShape: NativeShape = {
  typeField: "none",
  headersKey: "headers",
  supportsCwd: true,
  supportsEnabled: true,
  supportsDescription: true,
};

const piHome = (ctx: Context): string => homeFrom(ctx, "PI_CODING_AGENT_DIR", ".pi", "agent");

export const pi: HarnessAdapter = {
  id: "pi",
  label: "Pi",
  readsSharedSkills: true,
  supportsMcpEnabled: true,
  reservedSettingsKeys: [],
  captureExclude: [["lastChangelogVersion"]],
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
};
