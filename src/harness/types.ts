import type { Context } from "../core/context.ts";
import type { DocFormat } from "../core/doc.ts";
import type { HarnessId, McpHttpServer, McpStdioServer, RootId } from "../profile/schema.ts";
import type { CommandRunner } from "../secrets/resolve.ts";

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
  readonly value: Record<string, unknown> | undefined;
  readonly dropped: readonly string[];
  readonly unsupported?: string;
}

export type ParsedMcp =
  | { readonly ok: true; readonly server: ResolvedMcpServer }
  | { readonly ok: false; readonly reason: string };

export interface AssetRule {
  readonly root?: RootId;
  readonly path: string;
  readonly kind: "dir" | "file" | "doc";
  readonly once?: boolean;
}

export interface InventoryDir {
  readonly dir: string;
  readonly root: RootId | undefined;
  readonly private: readonly string[];
  readonly runtime: readonly string[];
  readonly other?: Readonly<Record<string, string>>;
}

export interface InstalledPlugins {
  readonly marketplaces: Readonly<Record<string, string>>;
  readonly installed: Readonly<Record<string, string>>;
}

export interface PluginSupport {
  readonly program: string;
  readonly noun: "plugin" | "extension";
  readonly marketplaces: boolean;
  readonly registryFiles: readonly string[];
  readonly settingsKey?: string;
  list(ctx: Context, runner: CommandRunner): Promise<InstalledPlugins>;
  addMarketplace(name: string, source: string): string[];
  removeMarketplace(name: string): string[];
  install(id: string): string[];
  uninstall(id: string, handle: string): string[];
  replaces?(id: string, installed: string): boolean;
}

export interface HarnessAdapter {
  readonly id: HarnessId;
  readonly label: string;
  readonly readsSharedSkills: boolean;
  readonly supportsMcpEnabled: boolean;
  readonly reservedSettingsKeys: readonly string[];
  readonly captureExclude: readonly (readonly string[])[];
  readonly assets: readonly AssetRule[];
  readonly plugins?: PluginSupport;
  home(ctx: Context): string;
  instructionsPath(ctx: Context): string | undefined;
  skillsDir(ctx: Context): string | undefined;
  mcpLocation(ctx: Context): McpLocation;
  settingsLocation(ctx: Context): DocLocation;
  toNativeMcp(server: ResolvedMcpServer): NativeMcp;
  fromNativeMcp(value: unknown): ParsedMcp;
  captureSkillDirs(ctx: Context): readonly string[];
  inventoryDirs(ctx: Context): readonly InventoryDir[];
}
