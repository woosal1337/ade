import type { ErrorCode } from "../core/errors.ts";
import type { CaptureInclude } from "../engine/capture.ts";
import type { Bundle } from "../profile/bundle.ts";
import type { HarnessId } from "../profile/schema.ts";

export const PROTOCOL_VERSION = 1;
export const RESULT_MARKER = "ADE-REMOTE-RESULT ";
export const PAYLOAD_GLOBAL = "__ADE_REMOTE__";
export const MIN_NODE_MAJOR = 22;

export const REMOTE_OPS = [
  "info",
  "plan",
  "apply",
  "status",
  "doctor",
  "revert",
  "history",
  "harnesses",
  "capture",
] as const;

export type RemoteOp = (typeof REMOTE_OPS)[number];

export interface RemotePayload {
  readonly protocol: number;
  readonly adeVersion: string;
  readonly op: RemoteOp;
  readonly home?: string;
  readonly bundle?: Bundle;
  readonly profileLabel?: string;
  readonly harnesses?: readonly HarnessId[];
  readonly force?: boolean;
  readonly expectedFingerprint?: string;
  readonly id?: string;
  readonly secrets?: Readonly<Record<string, string>>;
  readonly previewSecrets?: boolean;
  readonly capture?: {
    readonly include: readonly CaptureInclude[];
    readonly name?: string;
  };
}

export interface RemoteInfo {
  readonly hostname: string;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly node: string;
  readonly home: string;
  readonly stateDir: string;
  readonly adeVersion: string;
}

export interface RemoteErrorBody {
  readonly code: ErrorCode | "unexpected";
  readonly message: string;
  readonly hint?: string;
  readonly details?: readonly string[];
}

export type RemoteEnvelope =
  | {
      readonly protocol: number;
      readonly ok: true;
      readonly remote: RemoteInfo;
      readonly result: unknown;
    }
  | {
      readonly protocol: number;
      readonly ok: false;
      readonly remote?: RemoteInfo;
      readonly error: RemoteErrorBody;
    };
