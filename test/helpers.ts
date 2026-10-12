import { mkdtempSync, rmSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CliIO } from "../src/cli/output.ts";
import { type Context, createContext } from "../src/core/context.ts";
import { type CommandRunner, runCommand } from "../src/secrets/resolve.ts";

export const POSIX = process.platform !== "win32";

export function testGitEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "ade test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "ade test",
    GIT_COMMITTER_EMAIL: "test@example.com",
    ...extra,
  };
  for (const name of Object.keys(env)) {
    if (
      name === "GIT_DIR" ||
      name === "GIT_WORK_TREE" ||
      name === "GIT_INDEX_FILE" ||
      name === "GIT_PREFIX" ||
      name === "GIT_COMMON_DIR" ||
      name === "GIT_OBJECT_DIRECTORY"
    ) {
      delete env[name];
    }
  }
  return env;
}

const createdDirs: string[] = [];

process.once("exit", () => {
  for (const dir of createdDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const isolatedRoot = mkdtempSync(path.join(os.tmpdir(), "ade-test-env-"));
createdDirs.push(isolatedRoot);
process.env.ADE_STATE_DIR = path.join(isolatedRoot, "state");
process.env.ADE_CACHE_DIR = path.join(isolatedRoot, "cache");
process.env.ADE_PROFILE = path.join(isolatedRoot, "profile");

export async function tempDir(prefix = "ade-test-"): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
  createdDirs.push(dir);
  return dir;
}

export function contextFor(home: string, env: Record<string, string> = {}): Context {
  return createContext({
    home,
    env: { PATH: process.env.PATH ?? "", ...env },
    stateDir: path.join(home, ".ade-state"),
    cacheDir: path.join(home, ".ade-cache"),
  });
}

export async function writeText(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await writeText(file, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJson(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
}

export async function exists(file: string): Promise<boolean> {
  try {
    await fs.lstat(file);
    return true;
  } catch {
    return false;
  }
}

async function linkOrCopy(target: string, link: string, dir: boolean): Promise<void> {
  await fs.mkdir(path.dirname(link), { recursive: true });
  if (POSIX) {
    await fs.symlink(target, link, dir ? "dir" : "file");
    return;
  }
  if (dir) {
    await fs.cp(target, link, { recursive: true });
  } else {
    await fs.copyFile(target, link);
  }
}

export const SECRET_TOKEN = "sk-test-1234567890abcdefghij";

export async function seedMachine(home: string): Promise<void> {
  const shared = path.join(home, ".agents");
  await writeText(path.join(shared, "AGENTS.md"), "# Rules\n\nUse short sentences.\n");
  await writeText(
    path.join(shared, "skills", "review", "SKILL.md"),
    "---\nname: review\ndescription: Review a change before a merge.\n---\n\n# Review\n",
  );
  await writeText(path.join(shared, "skills", "review", "notes.md"), "Check the tests.\n");
  await linkOrCopy(
    path.join(shared, "skills", "review"),
    path.join(home, ".claude", "skills", "review"),
    true,
  );
  await linkOrCopy(path.join(shared, "AGENTS.md"), path.join(home, ".claude", "CLAUDE.md"), false);
  await linkOrCopy(path.join(shared, "AGENTS.md"), path.join(home, ".codex", "AGENTS.md"), false);
  await linkOrCopy(path.join(shared, "AGENTS.md"), path.join(home, ".grok", "AGENTS.md"), false);
  await linkOrCopy(
    path.join(shared, "AGENTS.md"),
    path.join(home, ".pi", "agent", "AGENTS.md"),
    false,
  );
  await writeJson(path.join(home, ".claude.json"), {
    numStartups: 3,
    projects: { "/work": { allowedTools: [] } },
    mcpServers: {
      docs: { type: "http", url: "https://docs.example.com/mcp" },
      legacy: { command: "npx", args: ["-y", "legacy-mcp"] },
    },
  });
  await writeJson(path.join(home, ".claude", "settings.json"), {
    model: "opus",
    permissions: { allow: ["Read"], defaultMode: "auto" },
    statusLine: { type: "command", command: path.join(home, ".claude", "statusline.sh") },
  });
  await writeText(
    path.join(home, ".codex", "config.toml"),
    'model = "gpt-5.5"\n\n[mcp_servers.docs]\nurl = "https://docs.example.com/mcp"\nstartup_timeout_sec = 20\n\n[projects."/work"]\ntrust_level = "trusted"\n',
  );
  await writeJson(path.join(home, ".cursor", "mcp.json"), {
    mcpServers: {
      docs: { url: "https://docs.example.com/mcp" },
      private: {
        url: "https://private.example.com/mcp",
        headers: { Authorization: `Bearer ${SECRET_TOKEN}` },
      },
    },
  });
  await writeText(
    path.join(home, ".grok", "config.toml"),
    '[models]\ndefault = "grok-4.7"\n\n[privacy]\nprivacy_banner_acked = "2026-01-01T00:00:00Z"\n',
  );
  await writeJson(path.join(home, ".pi", "agent", "settings.json"), {
    defaultModel: "claude-opus-5-5",
    packages: ["npm:pi-tool"],
    lastChangelogVersion: "1.1.0",
  });
  await writeJson(path.join(home, ".pi", "agent", "mcp.json"), {
    mcpServers: { docs: { url: "https://docs.example.com/mcp", description: "Product docs" } },
  });
}

export interface FakeIO extends CliIO {
  readonly output: () => string;
  readonly errors: () => string;
}

export function fakeIO(cwd: string, answers: string[] = []): FakeIO {
  let stdout = "";
  let stderr = "";
  return {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    stdinIsTTY: answers.length > 0,
    stdoutIsTTY: false,
    env: { NO_COLOR: "1" },
    cwd,
    prompt: async () => answers.shift() ?? "",
    output: () => stdout,
    errors: () => stderr,
  };
}

export const offlineRunner: CommandRunner = async (argv, options) => {
  if (argv[0] === "git") {
    return runCommand(argv, options);
  }
  throw Object.assign(new Error(`spawn ${argv[0]} ENOENT`), { code: "ENOENT" });
};

export interface FakeClaude {
  readonly runner: CommandRunner;
  readonly calls: string[];
  readonly settingsSeen: boolean[];
}

export function fakeClaude(marketplaceNames: Record<string, string>): FakeClaude {
  const calls: string[] = [];
  const settingsSeen: boolean[] = [];
  const runner: CommandRunner = async (argv, options) => {
    if (argv[0] === "git") {
      return runCommand(argv, options);
    }
    if (argv[0] !== "claude") {
      throw Object.assign(new Error(`spawn ${argv[0]} ENOENT`), { code: "ENOENT" });
    }
    const home = options.env.HOME ?? "";
    const plugins = path.join(home, ".claude", "plugins");
    const read = async (file: string): Promise<Record<string, unknown>> => {
      try {
        return JSON.parse(await fs.readFile(path.join(plugins, file), "utf8")) as Record<
          string,
          unknown
        >;
      } catch {
        return {};
      }
    };
    const write = async (file: string, value: unknown): Promise<void> => {
      await writeJson(path.join(plugins, file), value);
    };
    if (argv[1] === "--version") {
      return { code: 0, stdout: "2.0.0 (Claude Code)\n", stderr: "" };
    }
    calls.push(argv.slice(1).join(" "));
    settingsSeen.push(await exists(path.join(home, ".claude", "settings.json")));
    const [, , action, subject] = argv;
    if (argv[2] === "marketplace") {
      const known = await read("known_marketplaces.json");
      const target = argv[4] ?? "";
      if (argv[3] === "add") {
        const name = marketplaceNames[target] ?? target;
        known[name] = { source: { source: "github", repo: target } };
      } else {
        delete known[target];
      }
      await write("known_marketplaces.json", known);
      return { code: 0, stdout: "", stderr: "" };
    }
    const registry = await read("installed_plugins.json");
    const installed = (registry.plugins ?? {}) as Record<string, unknown>;
    if (action === "install" && subject !== undefined) {
      installed[subject] = [{ scope: "user" }];
    } else if (action === "uninstall" && subject !== undefined) {
      delete installed[subject];
    }
    await write("installed_plugins.json", { version: 2, plugins: installed });
    return { code: 0, stdout: "", stderr: "" };
  };
  return { runner, calls, settingsSeen };
}
