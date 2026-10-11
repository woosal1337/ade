import path from "node:path";
import type { Context } from "../core/context.ts";
import { AdeError, errnoCode } from "../core/errors.ts";
import { atomicWrite, readFileIfExists, statOrUndefined } from "../core/fsx.ts";
import { pluginEnv } from "../harness/plugins.ts";
import { getAdapter } from "../harness/registry.ts";
import type { InstalledPlugins } from "../harness/types.ts";
import type { HarnessId } from "../profile/schema.ts";
import { type CommandRunner, runCommand } from "../secrets/resolve.ts";
import { isolatedGitEnv } from "../skills/git.ts";

export type PluginOpKind = "install" | "uninstall" | "addMarketplace" | "removeMarketplace";

export interface PluginOp {
  readonly harness: HarnessId;
  readonly op: PluginOpKind;
  readonly id: string;
  readonly source?: string;
}

export interface PluginProbe {
  readonly available: boolean;
  readonly list: InstalledPlugins;
}

export type PatchState = "missing" | "applied" | "clean" | "conflict";

export class ExternalProbe {
  readonly #ctx: Context;
  readonly #runner: CommandRunner;
  readonly #plugins = new Map<HarnessId, Promise<PluginProbe>>();

  constructor(ctx: Context, runner: CommandRunner = runCommand) {
    this.#ctx = ctx;
    this.#runner = runner;
  }

  plugins(harness: HarnessId): Promise<PluginProbe> {
    let probe = this.#plugins.get(harness);
    if (probe === undefined) {
      probe = this.#probePlugins(harness);
      this.#plugins.set(harness, probe);
    }
    return probe;
  }

  async #probePlugins(harness: HarnessId): Promise<PluginProbe> {
    const support = getAdapter(harness).plugins;
    const empty: InstalledPlugins = { marketplaces: {}, installed: {} };
    if (support === undefined) {
      return { available: false, list: empty };
    }
    try {
      await this.#runner([support.program, "--version"], {
        env: pluginEnv(this.#ctx),
        timeoutMs: 30_000,
      });
    } catch (error) {
      if (errnoCode(error) === "ENOENT") {
        return { available: false, list: empty };
      }
      throw error;
    }
    return { available: true, list: await support.list(this.#ctx, this.#runner) };
  }

  patchFile(hash: string): string {
    return path.join(this.#ctx.cacheDir, "patches", `${hash}.patch`);
  }

  async storePatch(hash: string, patch: Buffer): Promise<string> {
    const file = this.patchFile(hash);
    if ((await readFileIfExists(file)) === undefined) {
      await atomicWrite(file, patch);
    }
    return file;
  }

  async patchState(dir: string, file: string): Promise<PatchState> {
    if (!(await statOrUndefined(path.join(dir, ".git")))) {
      return "missing";
    }
    const env = isolatedGitEnv(this.#ctx.env);
    const reverse = await this.#runner(["git", "-C", dir, "apply", "--check", "-R", file], {
      env,
      timeoutMs: 60_000,
    });
    if (reverse.code === 0) {
      return "applied";
    }
    const forward = await this.#runner(["git", "-C", dir, "apply", "--check", file], {
      env,
      timeoutMs: 60_000,
    });
    return forward.code === 0 ? "clean" : "conflict";
  }
}

export function pluginOpArgv(op: PluginOp, list: InstalledPlugins): string[] {
  const support = getAdapter(op.harness).plugins;
  if (support === undefined) {
    throw new AdeError(
      "unsupported",
      `${getAdapter(op.harness).label} has no plugin support in ade.`,
    );
  }
  switch (op.op) {
    case "install":
      return support.install(op.id);
    case "uninstall":
      return support.uninstall(op.id, list.installed[op.id] ?? op.id);
    case "addMarketplace":
      return support.addMarketplace(op.id, op.source ?? "");
    case "removeMarketplace":
      return support.removeMarketplace(op.id);
  }
}

export async function runPluginOp(
  ctx: Context,
  runner: CommandRunner,
  op: PluginOp,
): Promise<void> {
  const support = getAdapter(op.harness).plugins;
  if (support === undefined) {
    return;
  }
  const list = await support.list(ctx, runner);
  const argv = pluginOpArgv(op, list);
  if (argv.length === 0) {
    return;
  }
  const result = await runner(argv, { env: pluginEnv(ctx), timeoutMs: 300_000, cwd: ctx.home });
  if (result.code !== 0) {
    const detail = (result.stderr.trim() || result.stdout.trim()).split("\n").slice(-3);
    throw new AdeError(
      "conflict",
      `The command failed with exit code ${result.code}: ${argv.join(" ")}.`,
      {
        details: detail,
        hint: `Run the command by hand to read the full error from ${getAdapter(op.harness).label}.`,
      },
    );
  }
}

export async function gitApply(
  ctx: Context,
  runner: CommandRunner,
  dir: string,
  file: string,
  reverse: boolean,
): Promise<void> {
  const result = await runner(
    ["git", "-C", dir, "apply", ...(reverse ? ["-R"] : []), "--whitespace=nowarn", file],
    { env: isolatedGitEnv(ctx.env), timeoutMs: 60_000 },
  );
  if (result.code !== 0) {
    throw new AdeError("conflict", `Git could not apply the patch in ${dir}.`, {
      details: result.stderr.trim() === "" ? [] : result.stderr.trim().split("\n").slice(0, 3),
    });
  }
}

export function undoOf(op: PluginOp, previousSource?: string): PluginOp[] {
  switch (op.op) {
    case "install":
      return [{ harness: op.harness, op: "uninstall", id: op.id }];
    case "uninstall":
      return [{ harness: op.harness, op: "install", id: op.id }];
    case "addMarketplace":
      return previousSource === undefined
        ? [{ harness: op.harness, op: "removeMarketplace", id: op.id }]
        : [
            { harness: op.harness, op: "removeMarketplace", id: op.id },
            { harness: op.harness, op: "addMarketplace", id: op.id, source: previousSource },
          ];
    case "removeMarketplace":
      return previousSource === undefined
        ? []
        : [{ harness: op.harness, op: "addMarketplace", id: op.id, source: previousSource }];
  }
}
