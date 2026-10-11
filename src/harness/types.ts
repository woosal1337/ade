import type { Context } from "../core/context.ts";
import type { DocFormat } from "../core/doc.ts";
import type { HarnessId, McpHttpServer, McpStdioServer } from "../profile/schema.ts";

export interface DocLocation {
  readonly path: string;
  readonly format: DocFormat;
}

export interface McpLocation extends DocLocation {
  readonly pointer: readonly string[];
}

export type ResolvedStdioServer = Omit<McpStdioServer, "harnesses" | "overrides">;
export type ResolvedHttpServer = Omit<McpHttpServer, "harnesses" | "overrides">;
export type ResolvedMcpServer = ResolvedStdioServer | ResolvedHttpServer;

export interface NativeMcp {
  readonly value: Record<string, unknown>;
  readonly dropped: readonly string[];
}

export type ParsedMcp =
  | { readonly ok: true; readonly server: ResolvedMcpServer }
  | { readonly ok: false; readonly reason: string };

export interface HarnessAdapter {
  readonly id: HarnessId;
  readonly label: string;
  readonly readsSharedSkills: boolean;
  readonly supportsMcpEnabled: boolean;
  readonly reservedSettingsKeys: readonly string[];
  readonly captureExclude: readonly (readonly string[])[];
  home(ctx: Context): string;
  instructionsPath(ctx: Context): string | undefined;
  skillsDir(ctx: Context): string | undefined;
  mcpLocation(ctx: Context): McpLocation;
  settingsLocation(ctx: Context): DocLocation;
  toNativeMcp(server: ResolvedMcpServer): NativeMcp;
  fromNativeMcp(value: unknown): ParsedMcp;
  captureSkillDirs(ctx: Context): readonly string[];
}
