import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type Context, createContext } from "../core/context.ts";
import { AdeError, errorMessage, isAdeError } from "../core/errors.ts";
import { apply } from "../engine/apply.ts";
import { capture, writeCapture } from "../engine/capture.ts";
import { doctor } from "../engine/doctor.ts";
import { listApplies, revert } from "../engine/history.ts";
import { computePlan } from "../engine/plan.ts";
import { status } from "../engine/status.ts";
import { describeHarnesses } from "../harness/registry.ts";
import { exportBundle, importBundle } from "../profile/bundle.ts";
import type { LoadedProfile } from "../profile/load.ts";
import { createPreviewResolver, createSecretResolver } from "../secrets/resolve.ts";
import { VERSION } from "../version.ts";
import {
  MIN_NODE_MAJOR,
  PAYLOAD_GLOBAL,
  PROTOCOL_VERSION,
  RESULT_MARKER,
  type RemoteEnvelope,
  type RemoteInfo,
  type RemotePayload,
} from "./protocol.ts";

function info(ctx: Context): RemoteInfo {
  return {
    hostname: os.hostname(),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    home: ctx.home,
    stateDir: ctx.stateDir,
    adeVersion: VERSION,
  };
}

async function withProfile<T>(
  payload: RemotePayload,
  run: (loaded: LoadedProfile) => Promise<T>,
): Promise<T> {
  if (payload.bundle === undefined) {
    throw new AdeError("usage", `The operation ${payload.op} needs a profile.`);
  }
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "ade-remote-"));
  try {
    const loaded = await importBundle(payload.bundle, path.join(temp, "profile"));
    return await run(loaded);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

async function execute(payload: RemotePayload, ctx: Context): Promise<unknown> {
  const harnesses = payload.harnesses === undefined ? undefined : [...payload.harnesses];
  const shared = (loaded: LoadedProfile) => ({
    harnesses,
    force: payload.force === true,
    offline: true,
    copyFiles: true,
    resolver:
      payload.previewSecrets === true
        ? createPreviewResolver(loaded.profile, ctx)
        : createSecretResolver(loaded.profile, ctx, undefined, payload.secrets ?? {}),
  });
  switch (payload.op) {
    case "info":
      return { harnesses: await describeHarnesses(ctx) };
    case "harnesses":
      return describeHarnesses(ctx);
    case "plan":
      return withProfile(
        payload,
        async (loaded) => (await computePlan(loaded, ctx, shared(loaded))).plan,
      );
    case "apply":
      if (payload.previewSecrets === true) {
        throw new AdeError("usage", "An apply needs real secret values.");
      }
      return withProfile(payload, (loaded) =>
        apply(loaded, ctx, {
          ...shared(loaded),
          expectedFingerprint: payload.expectedFingerprint,
          profileLabel: payload.profileLabel,
        }),
      );
    case "status":
      return withProfile(payload, (loaded) => status(loaded, ctx, shared(loaded)));
    case "doctor":
      return withProfile(payload, (loaded) =>
        doctor(loaded, ctx, {
          resolver: shared(loaded).resolver,
          copyFiles: true,
          skipSecrets: payload.previewSecrets === true,
        }),
      );
    case "revert":
      return revert(ctx, { id: payload.id, force: payload.force === true });
    case "history":
      return listApplies(ctx);
    case "capture": {
      const result = await capture(ctx, {
        harnesses,
        include: payload.capture?.include ?? [],
        name: payload.capture?.name,
      });
      const temp = await fs.mkdtemp(path.join(os.tmpdir(), "ade-remote-"));
      try {
        const loaded = await writeCapture(path.join(temp, "profile"), result);
        return {
          bundle: await exportBundle(loaded, ctx.now()),
          warnings: result.warnings,
          secrets: result.secrets,
        };
      } finally {
        await fs.rm(temp, { recursive: true, force: true });
      }
    }
  }
}

function errorBody(error: unknown): Extract<RemoteEnvelope, { ok: false }>["error"] {
  if (isAdeError(error)) {
    return {
      code: error.code,
      message: error.message,
      ...(error.hint === undefined ? {} : { hint: error.hint }),
      ...(error.details.length === 0 ? {} : { details: error.details }),
    };
  }
  return { code: "unexpected", message: errorMessage(error) };
}

export async function runAgent(payload: RemotePayload): Promise<RemoteEnvelope> {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (major < MIN_NODE_MAJOR) {
    return {
      protocol: PROTOCOL_VERSION,
      ok: false,
      error: {
        code: "unsupported",
        message: `The remote runs Node.js ${process.version}. ade needs Node.js ${MIN_NODE_MAJOR} or later.`,
        hint: "Install a newer Node.js on the remote, or give its path with --node.",
      },
    };
  }
  if (payload.protocol !== PROTOCOL_VERSION) {
    return {
      protocol: PROTOCOL_VERSION,
      ok: false,
      error: {
        code: "unsupported",
        message: `The remote agent uses protocol ${PROTOCOL_VERSION}, and the payload uses ${payload.protocol}.`,
      },
    };
  }
  let ctx: Context | undefined;
  try {
    ctx = createContext(payload.home === undefined ? {} : { home: payload.home });
    const result = await execute(payload, ctx);
    return { protocol: PROTOCOL_VERSION, ok: true, remote: info(ctx), result };
  } catch (error) {
    return {
      protocol: PROTOCOL_VERSION,
      ok: false,
      ...(ctx === undefined ? {} : { remote: info(ctx) }),
      error: errorBody(error),
    };
  }
}

const payload = (globalThis as Record<string, unknown>)[PAYLOAD_GLOBAL] as
  | RemotePayload
  | undefined;
if (payload !== undefined) {
  const envelope = await runAgent(payload);
  process.stdout.write(`\n${RESULT_MARKER}${JSON.stringify(envelope)}\n`);
  process.exitCode = envelope.ok ? 0 : 1;
}
