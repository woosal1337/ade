import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { Context, Environment } from "../core/context.ts";
import { isPlainObject } from "../core/doc.ts";
import { AdeError, errnoCode } from "../core/errors.ts";
import type { Profile, SecretSource } from "../profile/schema.ts";
import { REFERENCE_PATTERN } from "./refs.ts";

export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type CommandRunner = (
  argv: readonly string[],
  options: { readonly env: Environment; readonly timeoutMs: number; readonly cwd?: string },
) => Promise<CommandResult>;

export const runCommand: CommandRunner = (argv, options) =>
  new Promise((resolve, reject) => {
    const [command, ...args] = argv;
    if (command === undefined) {
      reject(new AdeError("usage", "The command is empty."));
      return;
    }
    execFile(
      command,
      args,
      {
        env: options.env as NodeJS.ProcessEnv,
        timeout: options.timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") {
          reject(error);
          return;
        }
        resolve({
          code: error && typeof error.code === "number" ? error.code : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });

export interface Expanded<T> {
  readonly value: T;
  readonly secrets: ReadonlySet<string>;
}

export interface SecretResolver {
  resolve(name: string): Promise<string>;
  mask(text: string): string;
  expandString(text: string): Promise<Expanded<string>>;
  expandDeep<T>(value: T): Promise<Expanded<T>>;
}

export function createSecretResolver(
  profile: Profile,
  ctx: Context,
  runner: CommandRunner = runCommand,
  presets: Readonly<Record<string, string>> = {},
): SecretResolver {
  const cache = new Map<string, string>();
  for (const [name, value] of Object.entries(presets)) {
    if (profile.secrets !== undefined && Object.hasOwn(profile.secrets, name)) {
      cache.set(name, value);
    }
  }

  const resolve = async (name: string): Promise<string> => {
    const cached = cache.get(name);
    if (cached !== undefined) {
      return cached;
    }
    const source = profile.secrets?.[name];
    if (source === undefined) {
      throw new AdeError("secret-undeclared", `The secret is not declared: ${name}.`, {
        hint: `Add it with: ade add secret ${name} --from env --name <VARIABLE>`,
      });
    }
    const value = await readSecret(name, source, ctx, runner);
    if (value === "") {
      throw new AdeError("secret-unresolved", `The secret ${name} has an empty value.`, {
        hint: describeSource(source),
      });
    }
    cache.set(name, value);
    return value;
  };

  const expandString = async (text: string): Promise<Expanded<string>> => {
    const secrets = new Set<string>();
    if (!text.includes("$")) {
      return { value: text, secrets };
    }
    let result = "";
    let last = 0;
    for (const match of text.matchAll(REFERENCE_PATTERN)) {
      result += text.slice(last, match.index);
      if (match[0] === "$${") {
        result += "${";
      } else if (match[1] === "home") {
        result += ctx.home;
      } else if (match[2] !== undefined) {
        result += await resolve(match[2]);
        secrets.add(match[2]);
      }
      last = match.index + match[0].length;
    }
    return { value: result + text.slice(last), secrets };
  };

  const expandValue = async (value: unknown, secrets: Set<string>): Promise<unknown> => {
    if (typeof value === "string") {
      const expanded = await expandString(value);
      for (const name of expanded.secrets) {
        secrets.add(name);
      }
      return expanded.value;
    }
    if (Array.isArray(value)) {
      const items: unknown[] = [];
      for (const item of value) {
        items.push(await expandValue(item, secrets));
      }
      return items;
    }
    if (isPlainObject(value)) {
      const result: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        Object.defineProperty(result, key, {
          value: await expandValue(item, secrets),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return result;
    }
    return value;
  };

  return {
    resolve,
    expandString,
    async expandDeep<T>(value: T): Promise<Expanded<T>> {
      const secrets = new Set<string>();
      const expanded = (await expandValue(value, secrets)) as T;
      return { value: expanded, secrets };
    },
    mask(text: string): string {
      let result = text;
      const entries = [...cache.entries()]
        .filter(([, value]) => value.length >= 4)
        .sort((left, right) => right[1].length - left[1].length);
      for (const [name, value] of entries) {
        result = result.replaceAll(value, `\${secret:${name}}`);
      }
      return result;
    },
  };
}

function describeSource(source: SecretSource): string {
  switch (source.from) {
    case "env":
      return `Set the environment variable ${source.name}.`;
    case "file":
      return `Put the value in the file ${source.path}.`;
    case "command":
      return `Make sure that the command ${source.argv[0]} prints the value.`;
    case "keychain":
      return `Add the Keychain item with service ${source.service} and account ${source.account}.`;
  }
}

async function readSecret(
  name: string,
  source: SecretSource,
  ctx: Context,
  runner: CommandRunner,
): Promise<string> {
  switch (source.from) {
    case "env": {
      const value = ctx.env[source.name];
      if (value === undefined) {
        throw new AdeError(
          "secret-unresolved",
          `The environment variable ${source.name} for the secret ${name} is not set.`,
          { hint: describeSource(source) },
        );
      }
      return value;
    }
    case "file": {
      const file = expandUserPath(source.path, ctx);
      try {
        return (await fs.readFile(file, "utf8")).replace(/\r?\n$/, "");
      } catch (error) {
        if (errnoCode(error) === "ENOENT") {
          throw new AdeError(
            "secret-unresolved",
            `The file for the secret ${name} does not exist: ${file}.`,
            { hint: describeSource(source) },
          );
        }
        throw error;
      }
    }
    case "command": {
      const result = await runner(source.argv, { env: ctx.env, timeoutMs: 15_000 });
      if (result.code !== 0) {
        throw new AdeError(
          "secret-unresolved",
          `The command for the secret ${name} failed with exit code ${result.code}.`,
          { hint: describeSource(source) },
        );
      }
      return result.stdout.replace(/\r?\n$/, "");
    }
    case "keychain": {
      if (ctx.platform !== "darwin") {
        throw new AdeError(
          "unsupported",
          `The Keychain source for the secret ${name} needs macOS.`,
          {
            hint: "Use an env, file, or command source on this platform.",
          },
        );
      }
      const result = await runner(
        ["security", "find-generic-password", "-s", source.service, "-a", source.account, "-w"],
        { env: ctx.env, timeoutMs: 15_000 },
      );
      if (result.code !== 0) {
        throw new AdeError(
          "secret-unresolved",
          `The Keychain has no item for the secret ${name}.`,
          { hint: describeSource(source) },
        );
      }
      return result.stdout.replace(/\r?\n$/, "");
    }
  }
}

export function expandUserPath(text: string, ctx: Context): string {
  const withHome = text.replaceAll("${home}", ctx.home);
  if (withHome === "~") {
    return ctx.home;
  }
  if (withHome.startsWith("~/") || withHome.startsWith("~\\")) {
    return path.join(ctx.home, withHome.slice(2));
  }
  return path.resolve(withHome);
}
