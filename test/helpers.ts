import { rmSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CliIO } from "../src/cli/output.ts";
import { type Context, createContext } from "../src/core/context.ts";

export const POSIX = process.platform !== "win32";

const createdDirs: string[] = [];

process.once("exit", () => {
  for (const dir of createdDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

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
