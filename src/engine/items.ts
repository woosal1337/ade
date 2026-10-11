import type { DocFormat } from "../core/doc.ts";
import type { Absent } from "../core/hash.ts";
import type { HarnessId } from "../profile/schema.ts";

export type ItemKind = "instructions" | "mcp" | "skill" | "setting" | "file" | "plugin" | "patch";
export type Scope = HarnessId | "shared" | "home";

interface ItemBase {
  readonly key: string;
  readonly kind: ItemKind;
  readonly scope: Scope;
  readonly label: string;
  readonly notes: readonly string[];
  readonly secrets: readonly string[];
}

export interface DocItem extends ItemBase {
  readonly type: "doc";
  readonly doc: { readonly path: string; readonly format: DocFormat };
  readonly pointer: readonly string[];
  readonly value: unknown | Absent;
}

export type PathWant =
  | { readonly type: "symlink"; readonly target: string; readonly dir: boolean }
  | {
      readonly type: "file";
      readonly content: Buffer;
      readonly mode: number | undefined;
      readonly hash: string;
    }
  | { readonly type: "dir"; readonly source: string; readonly hash: string };

export interface PathItem extends ItemBase {
  readonly type: "path";
  readonly path: string;
  readonly want: PathWant;
  readonly phase: 0 | 1;
  readonly once?: boolean;
}

export interface PluginItem extends ItemBase {
  readonly type: "plugin";
  readonly harness: HarnessId;
  readonly target: "marketplace" | "plugin";
  readonly id: string;
  readonly source?: string;
  readonly path: string;
}

export interface PatchItem extends ItemBase {
  readonly type: "patch";
  readonly path: string;
  readonly patch: Buffer;
  readonly hash: string;
  readonly files: readonly string[];
}

export type DesiredItem = DocItem | PathItem | PluginItem | PatchItem;

export function patchFiles(patch: string): string[] {
  const files = new Set<string>();
  for (const line of patch.split(/\r?\n/)) {
    const match = /^(?:\+\+\+|---) (?:a|b)\/(.+?)\t?$/.exec(line);
    if (match?.[1] !== undefined && match[1] !== "/dev/null") {
      files.add(match[1]);
    }
  }
  return [...files];
}
