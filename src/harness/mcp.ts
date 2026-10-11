import { isPlainObject } from "../core/doc.ts";
import type { NativeMcp, ParsedMcp, ResolvedMcpServer } from "./types.ts";

export interface NativeShape {
  readonly typeField: "none" | "always";
  readonly headersKey: string;
  readonly supportsCwd: boolean;
  readonly supportsEnabled: boolean;
  readonly supportsDescription: boolean;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isPlainObject(value) && Object.values(value).every((item) => typeof item === "string");
}

export function toNative(server: ResolvedMcpServer, shape: NativeShape): NativeMcp {
  const value: Record<string, unknown> = {};
  const dropped: string[] = [];
  if (server.transport === "stdio") {
    if (shape.typeField === "always") {
      value.type = "stdio";
    }
    value.command = server.command;
    if (server.args !== undefined && server.args.length > 0) {
      value.args = [...server.args];
    }
    if (server.env !== undefined && Object.keys(server.env).length > 0) {
      value.env = { ...server.env };
    }
    if (server.cwd !== undefined) {
      if (shape.supportsCwd) {
        value.cwd = server.cwd;
      } else {
        dropped.push("cwd");
      }
    }
  } else {
    if (shape.typeField === "always") {
      value.type = "http";
    }
    value.url = server.url;
    if (server.headers !== undefined && Object.keys(server.headers).length > 0) {
      value[shape.headersKey] = { ...server.headers };
    }
  }
  if (server.description !== undefined) {
    if (shape.supportsDescription) {
      value.description = server.description;
    } else {
      dropped.push("description");
    }
  }
  if (server.enabled !== undefined && shape.supportsEnabled) {
    value.enabled = server.enabled;
  }
  return { value, dropped };
}

export function fromNative(native: unknown, shape: NativeShape): ParsedMcp {
  if (!isPlainObject(native)) {
    return { ok: false, reason: "The entry is not an object." };
  }
  const type = typeof native.type === "string" ? native.type : undefined;
  if (type === "sse") {
    return { ok: false, reason: "ade does not manage servers with the SSE transport." };
  }
  if (type === "sdk") {
    return { ok: false, reason: "An SDK server runs inside its host application." };
  }
  if (typeof native.command === "string" && native.command !== "") {
    if (type !== undefined && type !== "stdio" && type !== "local") {
      return { ok: false, reason: `The transport type is not known: ${type}.` };
    }
    return {
      ok: true,
      server: {
        transport: "stdio",
        command: native.command,
        ...(isStringArray(native.args) && native.args.length > 0 ? { args: [...native.args] } : {}),
        ...(isStringRecord(native.env) && Object.keys(native.env).length > 0
          ? { env: { ...native.env } }
          : {}),
        ...(shape.supportsCwd && typeof native.cwd === "string" ? { cwd: native.cwd } : {}),
      },
    };
  }
  if (typeof native.url === "string" && native.url !== "") {
    if (type !== undefined && type !== "http" && type !== "streamable-http") {
      return { ok: false, reason: `The transport type is not known: ${type}.` };
    }
    const headers = native[shape.headersKey];
    return {
      ok: true,
      server: {
        transport: "http",
        url: native.url,
        ...(isStringRecord(headers) && Object.keys(headers).length > 0
          ? { headers: { ...headers } }
          : {}),
      },
    };
  }
  return { ok: false, reason: "The entry has no command and no url." };
}
