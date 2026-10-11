import { isPlainObject } from "../core/doc.ts";
import type { NativeMcp, ParsedMcp, ResolvedMcpServer } from "./types.ts";

export interface NativeShape {
  readonly typeField: "none" | "always";
  readonly urlKey: "url" | "httpUrl" | "serverUrl";
  readonly headersKey: string;
  readonly supportsCwd: boolean;
  readonly enabledStyle: "none" | "enabled" | "disabled";
  readonly supportsDescription: boolean;
  readonly stdioOnly?: boolean;
  readonly label: string;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isPlainObject(value) && Object.values(value).every((item) => typeof item === "string");
}

function withCommon(
  value: Record<string, unknown>,
  server: ResolvedMcpServer,
  shape: NativeShape,
  dropped: string[],
): void {
  if (server.description !== undefined) {
    if (shape.supportsDescription) {
      value.description = server.description;
    } else {
      dropped.push("description");
    }
  }
  if (server.enabled !== undefined) {
    if (shape.enabledStyle === "enabled") {
      value.enabled = server.enabled;
    } else if (shape.enabledStyle === "disabled") {
      value.disabled = !server.enabled;
    }
  }
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
    if (shape.stdioOnly === true) {
      return {
        value: undefined,
        dropped,
        unsupported: `${shape.label} accepts only stdio servers in its config file.`,
      };
    }
    if (shape.typeField === "always") {
      value.type = "http";
    }
    value[shape.urlKey] = server.url;
    if (server.headers !== undefined && Object.keys(server.headers).length > 0) {
      value[shape.headersKey] = { ...server.headers };
    }
  }
  withCommon(value, server, shape, dropped);
  return { value, dropped };
}

export function fromNative(native: unknown, shape: NativeShape): ParsedMcp {
  if (!isPlainObject(native)) {
    return { ok: false, reason: "The entry is not an object." };
  }
  const type = typeof native.type === "string" ? native.type : undefined;
  if (
    type === "sse" ||
    (shape.urlKey === "httpUrl" && typeof native.url === "string" && native.httpUrl === undefined)
  ) {
    return { ok: false, reason: "ade does not manage servers with the SSE transport." };
  }
  if (type === "sdk") {
    return { ok: false, reason: "An SDK server runs inside its host application." };
  }
  const common = {
    ...(shape.supportsDescription && typeof native.description === "string"
      ? { description: native.description }
      : {}),
    ...(shape.enabledStyle === "enabled" && typeof native.enabled === "boolean"
      ? { enabled: native.enabled }
      : {}),
    ...(shape.enabledStyle === "disabled" && typeof native.disabled === "boolean"
      ? { enabled: !native.disabled }
      : {}),
  };
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
        ...common,
      },
    };
  }
  const url = native[shape.urlKey];
  if (typeof url === "string" && url !== "") {
    if (type !== undefined && type !== "http" && type !== "streamable-http") {
      return { ok: false, reason: `The transport type is not known: ${type}.` };
    }
    const headers = native[shape.headersKey];
    return {
      ok: true,
      server: {
        transport: "http",
        url,
        ...(isStringRecord(headers) && Object.keys(headers).length > 0
          ? { headers: { ...headers } }
          : {}),
        ...common,
      },
    };
  }
  return { ok: false, reason: "The entry has no command and no URL." };
}

export function toOpenCode(server: ResolvedMcpServer): NativeMcp {
  const value: Record<string, unknown> = {};
  if (server.transport === "stdio") {
    value.type = "local";
    value.command = [server.command, ...(server.args ?? [])];
    if (server.env !== undefined && Object.keys(server.env).length > 0) {
      value.environment = { ...server.env };
    }
    if (server.cwd !== undefined) {
      value.cwd = server.cwd;
    }
  } else {
    value.type = "remote";
    value.url = server.url;
    if (server.headers !== undefined && Object.keys(server.headers).length > 0) {
      value.headers = { ...server.headers };
    }
  }
  if (server.enabled !== undefined) {
    value.enabled = server.enabled;
  }
  return { value, dropped: server.description === undefined ? [] : ["description"] };
}

export function fromOpenCode(native: unknown): ParsedMcp {
  if (!isPlainObject(native)) {
    return { ok: false, reason: "The entry is not an object." };
  }
  const enabled = typeof native.enabled === "boolean" ? { enabled: native.enabled } : {};
  if (native.type === "local" && isStringArray(native.command) && native.command.length > 0) {
    const [command, ...args] = native.command;
    return {
      ok: true,
      server: {
        transport: "stdio",
        command: command as string,
        ...(args.length > 0 ? { args } : {}),
        ...(isStringRecord(native.environment) && Object.keys(native.environment).length > 0
          ? { env: { ...native.environment } }
          : {}),
        ...(typeof native.cwd === "string" ? { cwd: native.cwd } : {}),
        ...enabled,
      },
    };
  }
  if (native.type === "remote" && typeof native.url === "string") {
    return {
      ok: true,
      server: {
        transport: "http",
        url: native.url,
        ...(isStringRecord(native.headers) && Object.keys(native.headers).length > 0
          ? { headers: { ...native.headers } }
          : {}),
        ...enabled,
      },
    };
  }
  return { ok: false, reason: "The entry has no local command and no remote URL." };
}
