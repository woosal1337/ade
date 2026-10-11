import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AdeError, errnoCode, errorMessage } from "../core/errors.ts";
import { atomicWrite, ensureDir } from "../core/fsx.ts";
import { compareText } from "../core/hash.ts";
import type { ItemKind, Scope } from "./items.ts";

export interface StateItem {
  readonly kind: ItemKind;
  readonly scope: Scope;
  readonly path: string;
  readonly pointer?: readonly string[];
  readonly hash: string;
  readonly appliedAt: string;
  readonly meta?: Readonly<Record<string, string>>;
}

export interface State {
  readonly version: 1;
  readonly items: Record<string, StateItem>;
  readonly lastApply?: string;
  readonly profile?: string;
}

export const STATE_FILE = "state.json";
const LOCK_FILE = "lock";

export function emptyState(): State {
  return { version: 1, items: {} };
}

export async function ensureStateDir(stateDir: string): Promise<void> {
  await ensureDir(stateDir, 0o700);
  if (process.platform !== "win32") {
    await fs.chmod(stateDir, 0o700);
  }
}

export async function readState(stateDir: string): Promise<State> {
  const file = path.join(stateDir, STATE_FILE);
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    if (errnoCode(error) === "ENOENT") {
      return emptyState();
    }
    throw error;
  }
  try {
    const parsed = JSON.parse(text) as State;
    if (parsed.version !== 1 || typeof parsed.items !== "object" || parsed.items === null) {
      throw new Error("unknown state version");
    }
    return parsed;
  } catch (error) {
    throw new AdeError("parse-failed", `The state file is not valid: ${file}.`, {
      details: [errorMessage(error)],
      hint: "Move the state file away to start with an empty state.",
      cause: error,
    });
  }
}

export async function writeState(stateDir: string, state: State): Promise<void> {
  await ensureStateDir(stateDir);
  const items = Object.fromEntries(
    Object.entries(state.items).sort(([left], [right]) => compareText(left, right)),
  );
  await atomicWrite(
    path.join(stateDir, STATE_FILE),
    `${JSON.stringify({ ...state, items }, null, 2)}\n`,
    0o600,
  );
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errnoCode(error) === "EPERM";
  }
}

export async function acquireLock(stateDir: string): Promise<() => Promise<void>> {
  await ensureStateDir(stateDir);
  const file = path.join(stateDir, LOCK_FILE);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fs.open(file, "wx", 0o600);
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, host: os.hostname(), at: new Date().toISOString() }),
      );
      await handle.close();
      return async () => {
        await fs.rm(file, { force: true });
      };
    } catch (error) {
      if (errnoCode(error) !== "EEXIST") {
        throw error;
      }
      let holder: { pid?: number; host?: string } = {};
      try {
        holder = JSON.parse(await fs.readFile(file, "utf8")) as { pid?: number; host?: string };
      } catch {
        holder = {};
      }
      const sameHost = holder.host === undefined || holder.host === os.hostname();
      if (sameHost && typeof holder.pid === "number" && processAlive(holder.pid)) {
        throw new AdeError("locked", `Another ade process holds the state lock: ${file}.`, {
          hint: `Wait for process ${holder.pid} to finish, then run the command again.`,
        });
      }
      if (!sameHost) {
        throw new AdeError("locked", `A process on ${holder.host} holds the state lock: ${file}.`, {
          hint: "Remove the lock file after you make sure that no apply runs.",
        });
      }
      await fs.rm(file, { force: true });
    }
  }
  throw new AdeError("locked", `ade could not get the state lock: ${file}.`);
}
