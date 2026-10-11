import fs from "node:fs/promises";
import path from "node:path";
import { AdeError, errnoCode, errorMessage } from "../core/errors.ts";
import { atomicWrite, ensureDir } from "../core/fsx.ts";
import { compareText } from "../core/hash.ts";
import { emptyLock, type Lock, type Profile, profileJsonSchema } from "./schema.ts";
import { validateLock, validateProfile } from "./validate.ts";

export const PROFILE_FILE = "ade.json";
export const LOCK_FILE = "ade.lock.json";
export const SCHEMA_FILE = "ade.schema.json";

export interface LoadedProfile {
  readonly dir: string;
  readonly profile: Profile;
  readonly lock: Lock;
}

async function readJson(file: string): Promise<unknown | undefined> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    if (errnoCode(error) === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new AdeError("profile-invalid", `The file is not valid JSON: ${file}.`, {
      details: [errorMessage(error)],
      cause: error,
    });
  }
}

export async function loadProfile(dir: string): Promise<LoadedProfile> {
  const root = path.resolve(dir);
  const file = path.join(root, PROFILE_FILE);
  const raw = await readJson(file);
  if (raw === undefined) {
    throw new AdeError("profile-not-found", `The profile file does not exist: ${file}.`, {
      hint: "Run `ade init` or `ade capture`, or give the profile directory with --profile.",
    });
  }
  const profile = validateProfile(raw, file);
  const lock = await loadLock(root);
  return { dir: root, profile, lock };
}

export async function loadLock(dir: string): Promise<Lock> {
  const file = path.join(dir, LOCK_FILE);
  const raw = await readJson(file);
  return raw === undefined ? emptyLock() : validateLock(raw, file);
}

export function profileText(profile: Profile): string {
  return `${JSON.stringify(profile, null, 2)}\n`;
}

export async function saveProfile(dir: string, profile: Profile): Promise<void> {
  const root = path.resolve(dir);
  const valid = validateProfile(profile, path.join(root, PROFILE_FILE));
  await ensureDir(root);
  await atomicWrite(path.join(root, PROFILE_FILE), profileText(valid));
}

export async function saveLock(dir: string, lock: Lock): Promise<void> {
  const root = path.resolve(dir);
  const valid = validateLock(lock, path.join(root, LOCK_FILE));
  const sorted: Lock = {
    version: 1,
    skills: Object.fromEntries(Object.entries(valid.skills).sort(([a], [b]) => compareText(a, b))),
  };
  if (Object.keys(sorted.skills).length === 0) {
    await fs.rm(path.join(root, LOCK_FILE), { force: true });
    return;
  }
  await atomicWrite(path.join(root, LOCK_FILE), `${JSON.stringify(sorted, null, 2)}\n`);
}

export async function writeSchemaFile(dir: string): Promise<void> {
  await atomicWrite(
    path.join(path.resolve(dir), SCHEMA_FILE),
    `${JSON.stringify(profileJsonSchema(), null, 2)}\n`,
  );
}

export interface InitOptions {
  readonly name?: string;
  readonly force?: boolean;
}

export async function initProfile(dir: string, options: InitOptions = {}): Promise<LoadedProfile> {
  const root = path.resolve(dir);
  const file = path.join(root, PROFILE_FILE);
  if (!options.force && (await readJson(file)) !== undefined) {
    throw new AdeError("profile-exists", `A profile already exists: ${file}.`, {
      hint: "Use another directory, or add --force to replace the profile file.",
    });
  }
  const profile: Profile = {
    $schema: `./${SCHEMA_FILE}`,
    version: 1,
    name: options.name ?? path.basename(root),
    install: "auto",
  };
  await saveProfile(root, profile);
  await writeSchemaFile(root);
  return { dir: root, profile, lock: emptyLock() };
}
