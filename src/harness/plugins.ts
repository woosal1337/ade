import fs from "node:fs/promises";
import path from "node:path";
import type { Context } from "../core/context.ts";
import { isPlainObject, loadDoc } from "../core/doc.ts";
import { errnoCode } from "../core/errors.ts";
import type { CommandRunner } from "../secrets/resolve.ts";
import { zedExtensionsDir } from "./paths.ts";
import type { InstalledPlugins, PluginSupport } from "./types.ts";

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (errnoCode(error) === "ENOENT" || error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
}

function marketplaceSource(source: unknown): string | undefined {
  if (!isPlainObject(source)) {
    return undefined;
  }
  if (typeof source.repo === "string") {
    return source.repo;
  }
  if (typeof source.url === "string") {
    return source.url;
  }
  if (typeof source.path === "string") {
    return source.path;
  }
  return undefined;
}

function before(id: string, separator: string): string {
  const index = id.lastIndexOf(separator);
  return index <= 0 ? id : id.slice(0, index);
}

export function claudePlugins(home: (ctx: Context) => string): PluginSupport {
  return {
    program: "claude",
    noun: "plugin",
    marketplaces: true,
    registryFiles: ["plugins/installed_plugins.json", "plugins/known_marketplaces.json"],
    async list(ctx) {
      const root = path.join(home(ctx), "plugins");
      const known = await readJson(path.join(root, "known_marketplaces.json"));
      const marketplaces: Record<string, string> = {};
      if (isPlainObject(known)) {
        for (const [name, entry] of Object.entries(known)) {
          const source = isPlainObject(entry) ? marketplaceSource(entry.source) : undefined;
          if (source !== undefined) {
            marketplaces[name] = source;
          }
        }
      }
      const registry = await readJson(path.join(root, "installed_plugins.json"));
      const installed: Record<string, string> = {};
      const plugins =
        isPlainObject(registry) && isPlainObject(registry.plugins) ? registry.plugins : {};
      for (const [id, installs] of Object.entries(plugins)) {
        if (
          Array.isArray(installs) &&
          installs.some((item) => isPlainObject(item) && item.scope === "user")
        ) {
          installed[id] = id;
        }
      }
      return { marketplaces, installed };
    },
    addMarketplace: (_name, source) => ["claude", "plugin", "marketplace", "add", source],
    removeMarketplace: (name) => ["claude", "plugin", "marketplace", "remove", name],
    install: (id) => ["claude", "plugin", "install", id, "--scope", "user"],
    uninstall: (id) => ["claude", "plugin", "uninstall", id, "--scope", "user"],
  };
}

export function codexPlugins(configPath: (ctx: Context) => string): PluginSupport {
  return {
    program: "codex",
    noun: "plugin",
    marketplaces: true,
    registryFiles: ["config.toml"],
    async list(ctx) {
      const doc = await loadDoc(configPath(ctx), "toml");
      const marketplaces: Record<string, string> = {};
      const table = doc.data.marketplaces;
      if (isPlainObject(table)) {
        for (const [name, entry] of Object.entries(table)) {
          if (isPlainObject(entry) && typeof entry.source === "string") {
            marketplaces[name] = entry.source;
          }
        }
      }
      const installed: Record<string, string> = {};
      if (isPlainObject(doc.data.plugins)) {
        for (const id of Object.keys(doc.data.plugins)) {
          installed[id] = id;
        }
      }
      return { marketplaces, installed };
    },
    addMarketplace: (_name, source) => ["codex", "plugin", "marketplace", "add", source],
    removeMarketplace: (name) => ["codex", "plugin", "marketplace", "remove", name],
    install: (id) => ["codex", "plugin", "add", id],
    uninstall: (id) => ["codex", "plugin", "remove", id],
  };
}

export function grokPlugins(): PluginSupport {
  return {
    program: "grok",
    noun: "plugin",
    marketplaces: false,
    registryFiles: ["installed-plugins"],
    async list(ctx: Context, runner: CommandRunner): Promise<InstalledPlugins> {
      const result = await runner(["grok", "plugin", "list", "--json"], {
        env: pluginEnv(ctx),
        cwd: ctx.home,
        timeoutMs: 60_000,
      });
      const installed: Record<string, string> = {};
      if (result.code === 0) {
        try {
          const list = JSON.parse(result.stdout) as unknown;
          for (const item of Array.isArray(list) ? list : []) {
            if (
              isPlainObject(item) &&
              typeof item.name === "string" &&
              item.status !== "available"
            ) {
              const marketplace =
                typeof item.marketplace === "string" ? item.marketplace : undefined;
              installed[marketplace === undefined ? item.name : `${item.name}@${marketplace}`] =
                item.name;
            }
          }
        } catch {
          return { marketplaces: {}, installed };
        }
      }
      return { marketplaces: {}, installed };
    },
    addMarketplace: () => [],
    removeMarketplace: () => [],
    install: (id) => ["grok", "plugin", "install", id.split("@")[0] as string, "--trust"],
    uninstall: (_id, handle) => ["grok", "plugin", "uninstall", handle, "--confirm"],
    replaces: (id, installed) => before(id, "@") === before(installed, "@"),
  };
}

export function geminiExtensions(home: (ctx: Context) => string): PluginSupport {
  return {
    program: "gemini",
    noun: "extension",
    marketplaces: false,
    registryFiles: ["extensions"],
    async list(ctx) {
      const dir = path.join(home(ctx), "extensions");
      const installed: Record<string, string> = {};
      let names: string[] = [];
      try {
        names = await fs.readdir(dir);
      } catch {
        return { marketplaces: {}, installed };
      }
      for (const name of names) {
        const meta = await readJson(path.join(dir, name, ".gemini-extension-install.json"));
        if (isPlainObject(meta) && typeof meta.source === "string" && meta.type !== "link") {
          const ref = typeof meta.ref === "string" ? `#${meta.ref}` : "";
          installed[`${meta.source}${ref}`] = name;
        }
      }
      return { marketplaces: {}, installed };
    },
    addMarketplace: () => [],
    removeMarketplace: () => [],
    install: (id) => {
      const hash = id.lastIndexOf("#");
      const source = hash === -1 ? id : id.slice(0, hash);
      const ref = hash === -1 ? [] : ["--ref", id.slice(hash + 1)];
      return ["gemini", "extensions", "install", source, ...ref, "--consent", "--skip-settings"];
    },
    uninstall: (_id, handle) => ["gemini", "extensions", "uninstall", handle],
    replaces: (id, installed) => before(id, "#") === before(installed, "#"),
  };
}

export function cursorExtensions(dir: (ctx: Context) => string): PluginSupport {
  return {
    program: "cursor",
    noun: "extension",
    marketplaces: false,
    registryFiles: ["extensions/extensions.json"],
    async list(ctx) {
      const registry = await readJson(path.join(dir(ctx), "extensions.json"));
      const installed: Record<string, string> = {};
      for (const item of Array.isArray(registry) ? registry : []) {
        if (
          isPlainObject(item) &&
          isPlainObject(item.identifier) &&
          typeof item.identifier.id === "string" &&
          typeof item.version === "string"
        ) {
          installed[`${item.identifier.id}@${item.version}`] = item.identifier.id;
        }
      }
      return { marketplaces: {}, installed };
    },
    addMarketplace: () => [],
    removeMarketplace: () => [],
    install: (id) => ["cursor", "--install-extension", id, "--force"],
    uninstall: (_id, handle) => ["cursor", "--uninstall-extension", handle],
    replaces: (id, installed) =>
      before(id, "@").toLowerCase() === before(installed, "@").toLowerCase(),
  };
}

export function pluginEnv(ctx: Context): Record<string, string | undefined> {
  return { ...ctx.env, HOME: ctx.home, USERPROFILE: ctx.home };
}

export function zedExtensions(): PluginSupport {
  return {
    program: "zed",
    noun: "extension",
    marketplaces: false,
    registryFiles: [],
    settingsKey: "auto_install_extensions",
    async list(ctx) {
      const installed: Record<string, string> = {};
      try {
        for (const name of await fs.readdir(zedExtensionsDir(ctx))) {
          if (!name.startsWith(".")) {
            installed[name] = name;
          }
        }
      } catch {
        return { marketplaces: {}, installed };
      }
      return { marketplaces: {}, installed };
    },
    addMarketplace: () => [],
    removeMarketplace: () => [],
    install: () => [],
    uninstall: () => [],
  };
}
