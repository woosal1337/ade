import os from "node:os";
import path from "node:path";

export type Environment = Readonly<Record<string, string | undefined>>;

export interface Context {
  readonly home: string;
  readonly env: Environment;
  readonly platform: NodeJS.Platform;
  readonly stateDir: string;
  readonly cacheDir: string;
  readonly now: () => Date;
}

export interface ContextOptions {
  home?: string;
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  stateDir?: string;
  cacheDir?: string;
  now?: () => Date;
}

const machineVariables = [
  "CLAUDE_CONFIG_DIR",
  "CODEX_HOME",
  "GROK_HOME",
  "PI_CODING_AGENT_DIR",
  "ADE_STATE_DIR",
  "ADE_CACHE_DIR",
  "XDG_STATE_HOME",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "LOCALAPPDATA",
  "APPDATA",
];

export function createContext(options: ContextOptions = {}): Context {
  const platform = options.platform ?? process.platform;
  const customHome = options.home !== undefined;
  const home = path.resolve(options.home ?? os.homedir());
  const env: Record<string, string | undefined> =
    options.env !== undefined
      ? { ...options.env }
      : customHome
        ? withoutKeys(process.env, machineVariables)
        : { ...process.env };
  const stateDir = path.resolve(options.stateDir ?? defaultStateDir(home, env, platform));
  const cacheDir = path.resolve(options.cacheDir ?? defaultCacheDir(home, env, platform));
  return {
    home,
    env,
    platform,
    stateDir,
    cacheDir,
    now: options.now ?? (() => new Date()),
  };
}

export function defaultProfileDir(): string {
  const env = process.env;
  if (env.ADE_PROFILE) {
    return path.resolve(env.ADE_PROFILE);
  }
  if (process.platform === "win32") {
    return path.join(env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "ade");
  }
  return path.join(env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "ade");
}

function defaultStateDir(home: string, env: Environment, platform: NodeJS.Platform): string {
  if (env.ADE_STATE_DIR) {
    return env.ADE_STATE_DIR;
  }
  if (platform === "win32") {
    return path.join(env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), "ade", "state");
  }
  return path.join(env.XDG_STATE_HOME ?? path.join(home, ".local", "state"), "ade");
}

function defaultCacheDir(home: string, env: Environment, platform: NodeJS.Platform): string {
  if (env.ADE_CACHE_DIR) {
    return env.ADE_CACHE_DIR;
  }
  if (platform === "win32") {
    return path.join(env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), "ade", "cache");
  }
  return path.join(env.XDG_CACHE_HOME ?? path.join(home, ".cache"), "ade");
}

function withoutKeys(
  source: NodeJS.ProcessEnv,
  keys: readonly string[],
): Record<string, string | undefined> {
  const copy: Record<string, string | undefined> = { ...source };
  for (const key of keys) {
    delete copy[key];
  }
  return copy;
}

export function displayPath(ctx: Context, target: string): string {
  const relative = path.relative(ctx.home, target);
  if (relative === "") {
    return "~";
  }
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    return `~${path.sep}${relative}`;
  }
  return target;
}
