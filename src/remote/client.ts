import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Context } from "../core/context.ts";
import { AdeError, type ErrorCode, errnoCode } from "../core/errors.ts";
import type { ApplyResult } from "../engine/apply.ts";
import type { CaptureInclude } from "../engine/capture.ts";
import type { DoctorReport } from "../engine/doctor.ts";
import type { RecordSummary, RevertResult } from "../engine/history.ts";
import type { Plan } from "../engine/plan.ts";
import type { StatusReport } from "../engine/status.ts";
import type { HarnessRow } from "../harness/registry.ts";
import { type Bundle, type BundleFile, dirToBundleFiles, exportBundle } from "../profile/bundle.ts";
import { LOCK_FILE, type LoadedProfile, PROFILE_FILE, profileText } from "../profile/load.ts";
import { type HarnessId, isGitSkill, isLinkSkill, type Profile } from "../profile/schema.ts";
import { type CommandRunner, createSecretResolver } from "../secrets/resolve.ts";
import { createSkillResolver } from "../skills/source.ts";
import { VERSION } from "../version.ts";
import {
  PAYLOAD_GLOBAL,
  PROTOCOL_VERSION,
  RESULT_MARKER,
  type RemoteEnvelope,
  type RemoteInfo,
  type RemotePayload,
} from "./protocol.ts";

export interface RemoteTarget {
  readonly host: string;
  readonly ssh?: string | undefined;
  readonly sshOptions?: readonly string[] | undefined;
  readonly node?: string | undefined;
}

export interface TransportResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type RemoteTransport = (target: RemoteTarget, script: string) => Promise<TransportResult>;

export interface RemoteOptions {
  readonly target: RemoteTarget;
  readonly home?: string | undefined;
  readonly transport?: RemoteTransport | undefined;
  readonly agentPath?: string | undefined;
}

export interface RemoteResult<T> {
  readonly remote: RemoteInfo;
  readonly result: T;
}

export const sshTransport: RemoteTransport = (target, script) =>
  new Promise((resolve, reject) => {
    const args = [
      "-T",
      "-o",
      "ClearAllForwardings=yes",
      ...(target.sshOptions ?? []),
      target.host,
      target.node ?? "node",
      "--input-type=module",
      "-",
    ];
    const child = spawn(target.ssh ?? "ssh", args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      reject(
        errnoCode(error) === "ENOENT"
          ? new AdeError(
              "remote-failed",
              `The SSH command does not exist: ${target.ssh ?? "ssh"}.`,
              {
                hint: "Install OpenSSH, or give the SSH program with --ssh.",
              },
            )
          : error,
      );
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(script);
  });

const AGENT_CANDIDATES = ["../remote-agent.mjs", "../../dist/remote-agent.mjs"];

export async function readAgent(agentPath?: string): Promise<string> {
  const candidates =
    agentPath !== undefined
      ? [agentPath]
      : process.env.ADE_REMOTE_AGENT !== undefined
        ? [process.env.ADE_REMOTE_AGENT]
        : AGENT_CANDIDATES.map((item) => fileURLToPath(new URL(item, import.meta.url)));
  for (const candidate of candidates) {
    try {
      return await fs.readFile(candidate, "utf8");
    } catch (error) {
      if (errnoCode(error) !== "ENOENT") {
        throw error;
      }
    }
  }
  throw new AdeError("not-found", "The remote agent file does not exist.", {
    details: candidates,
    hint: "Run `npm run build` in the ade repository.",
  });
}

export function agentScript(agent: string, payload: RemotePayload): string {
  return `globalThis.${PAYLOAD_GLOBAL} = ${JSON.stringify(payload)};\n${agent}`;
}

function lastLines(text: string, count: number): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line !== "")
    .slice(-count);
}

function transportFailure(target: RemoteTarget, result: TransportResult): AdeError {
  const stderr = result.stderr;
  const nodeMissing =
    /node: (command )?not found|'node' is not recognized|No such file or directory/i.test(stderr);
  return new AdeError(
    "remote-failed",
    nodeMissing
      ? `${target.host} has no Node.js on the PATH of an SSH session.`
      : `The SSH session to ${target.host} failed with exit code ${result.code}.`,
    {
      details: lastLines(stderr, 6),
      hint: nodeMissing
        ? "Install Node.js 22 or later on the remote, or give its path with --node."
        : "Run `ssh <host> node --version` to check the route and the remote Node.js.",
    },
  );
}

export async function callRemote<T>(
  payload: Omit<RemotePayload, "protocol" | "adeVersion" | "home">,
  options: RemoteOptions,
): Promise<RemoteResult<T>> {
  const full: RemotePayload = {
    protocol: PROTOCOL_VERSION,
    adeVersion: VERSION,
    ...payload,
    ...(options.home === undefined ? {} : { home: options.home }),
  };
  const agent = await readAgent(options.agentPath);
  const transport = options.transport ?? sshTransport;
  const result = await transport(options.target, agentScript(agent, full));
  const line = result.stdout
    .split(/\r?\n/)
    .reverse()
    .find((item) => item.startsWith(RESULT_MARKER));
  if (line === undefined) {
    throw transportFailure(options.target, result);
  }
  let envelope: RemoteEnvelope;
  try {
    envelope = JSON.parse(line.slice(RESULT_MARKER.length)) as RemoteEnvelope;
  } catch (error) {
    throw new AdeError(
      "remote-failed",
      `The result from ${options.target.host} is not valid JSON.`,
      {
        cause: error,
      },
    );
  }
  if (!envelope.ok) {
    throw new AdeError(
      envelope.error.code === "unexpected" ? "remote-failed" : (envelope.error.code as ErrorCode),
      `${options.target.host}: ${envelope.error.message}`,
      {
        ...(envelope.error.hint === undefined ? {} : { hint: envelope.error.hint }),
        ...(envelope.error.details === undefined ? {} : { details: envelope.error.details }),
      },
    );
  }
  return { remote: envelope.remote, result: envelope.result as T };
}

export interface ShipOptions {
  readonly keepLinks?: boolean | undefined;
  readonly sendSecrets?: boolean | undefined;
  readonly runner?: CommandRunner | undefined;
}

export interface ShippedProfile {
  readonly bundle: Bundle;
  readonly secrets?: Record<string, string>;
  readonly notes: readonly string[];
}

export async function shipProfile(
  loaded: LoadedProfile,
  ctx: Context,
  options: ShipOptions = {},
): Promise<ShippedProfile> {
  const base = await exportBundle(loaded, ctx.now());
  const skills = createSkillResolver(loaded, ctx, {
    allowFetch: true,
    ...(options.runner === undefined ? {} : { runner: options.runner }),
  });
  const notes: string[] = [];
  const extra: BundleFile[] = [];
  const profile: Profile = structuredClone(loaded.profile);
  for (const [name, skill] of Object.entries(loaded.profile.skills ?? {})) {
    if (!isGitSkill(skill) && !(isLinkSkill(skill) && options.keepLinks !== true)) {
      continue;
    }
    const source = await skills.resolve(name, skill);
    if (source.missing) {
      notes.push(
        `The skill ${name} links to a path that does not exist here. The remote keeps the link.`,
      );
      continue;
    }
    const prefix = `vendor/skills/${name}`;
    extra.push(...(await dirToBundleFiles(source.dir, prefix)));
    const harnesses = skill.harnesses === undefined ? {} : { harnesses: skill.harnesses };
    const skillsField = profile.skills ?? {};
    skillsField[name] = isGitSkill(skill)
      ? {
          path: prefix,
          origin: {
            git: skill.git,
            ...(skill.subdir === undefined ? {} : { subdir: skill.subdir }),
            ...(skill.ref === undefined ? {} : { ref: skill.ref }),
          },
          ...harnesses,
        }
      : { path: prefix, ...harnesses };
    profile.skills = skillsField;
  }
  const files = base.files
    .filter((file) => file.path !== PROFILE_FILE && file.path !== LOCK_FILE)
    .concat(extra, [{ path: PROFILE_FILE, encoding: "utf8", content: profileText(profile) }]);
  let secrets: Record<string, string> | undefined;
  if (options.sendSecrets === true) {
    const resolver = createSecretResolver(loaded.profile, ctx, options.runner);
    secrets = {};
    for (const name of Object.keys(loaded.profile.secrets ?? {})) {
      secrets[name] = await resolver.resolve(name);
    }
  }
  return {
    bundle: { ...base, files },
    ...(secrets === undefined ? {} : { secrets }),
    notes,
  };
}

export interface RemoteProfileOptions extends RemoteOptions, ShipOptions {
  readonly harnesses?: readonly HarnessId[] | undefined;
  readonly force?: boolean | undefined;
}

function profilePayload(
  shipped: ShippedProfile,
  loaded: LoadedProfile,
  options: RemoteProfileOptions,
) {
  return {
    bundle: shipped.bundle,
    profileLabel: `${loaded.dir} (sent by ade remote)`,
    ...(shipped.secrets === undefined ? {} : { secrets: shipped.secrets }),
    ...(options.harnesses === undefined ? {} : { harnesses: options.harnesses }),
    ...(options.force === true ? { force: true } : {}),
  };
}

export async function remotePlan(
  loaded: LoadedProfile,
  ctx: Context,
  options: RemoteProfileOptions,
): Promise<RemoteResult<Plan> & { notes: readonly string[] }> {
  const shipped = await shipProfile(loaded, ctx, options);
  const response = await callRemote<Plan>(
    { op: "plan", ...profilePayload(shipped, loaded, options) },
    options,
  );
  return { ...response, notes: shipped.notes };
}

export async function remoteApply(
  loaded: LoadedProfile,
  ctx: Context,
  options: RemoteProfileOptions & { readonly expectedFingerprint?: string | undefined },
): Promise<RemoteResult<ApplyResult>> {
  const shipped = await shipProfile(loaded, ctx, options);
  return callRemote<ApplyResult>(
    {
      op: "apply",
      ...profilePayload(shipped, loaded, options),
      ...(options.expectedFingerprint === undefined
        ? {}
        : { expectedFingerprint: options.expectedFingerprint }),
    },
    options,
  );
}

export async function remoteStatus(
  loaded: LoadedProfile,
  ctx: Context,
  options: RemoteProfileOptions,
): Promise<RemoteResult<StatusReport>> {
  const shipped = await shipProfile(loaded, ctx, options);
  return callRemote<StatusReport>(
    { op: "status", ...profilePayload(shipped, loaded, options) },
    options,
  );
}

export async function remoteDoctor(
  loaded: LoadedProfile,
  ctx: Context,
  options: RemoteProfileOptions,
): Promise<RemoteResult<DoctorReport>> {
  const shipped = await shipProfile(loaded, ctx, options);
  return callRemote<DoctorReport>(
    { op: "doctor", ...profilePayload(shipped, loaded, options) },
    options,
  );
}

export function remoteRevert(
  options: RemoteOptions & {
    readonly id?: string | undefined;
    readonly force?: boolean | undefined;
  },
): Promise<RemoteResult<RevertResult>> {
  return callRemote<RevertResult>(
    {
      op: "revert",
      ...(options.id === undefined ? {} : { id: options.id }),
      ...(options.force === true ? { force: true } : {}),
    },
    options,
  );
}

export function remoteHistory(options: RemoteOptions): Promise<RemoteResult<RecordSummary[]>> {
  return callRemote<RecordSummary[]>({ op: "history" }, options);
}

export function remoteHarnesses(options: RemoteOptions): Promise<RemoteResult<HarnessRow[]>> {
  return callRemote<HarnessRow[]>({ op: "harnesses" }, options);
}

export interface RemoteCaptureResult {
  readonly bundle: Bundle;
  readonly warnings: readonly string[];
  readonly secrets: readonly { readonly name: string; readonly where: string }[];
}

export function remoteCapture(
  options: RemoteOptions & {
    readonly harnesses?: readonly HarnessId[] | undefined;
    readonly include?: readonly CaptureInclude[] | undefined;
    readonly name?: string | undefined;
  },
): Promise<RemoteResult<RemoteCaptureResult>> {
  return callRemote<RemoteCaptureResult>(
    {
      op: "capture",
      ...(options.harnesses === undefined ? {} : { harnesses: options.harnesses }),
      capture: {
        include: options.include ?? [],
        ...(options.name === undefined ? {} : { name: options.name }),
      },
    },
    options,
  );
}
