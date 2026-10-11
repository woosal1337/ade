import type { DocFormat } from "../core/doc.ts";
import type { Absent } from "../core/hash.ts";
import type { HarnessId } from "../profile/schema.ts";

export type ItemKind = "instructions" | "mcp" | "skill" | "setting" | "file";
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
}

export type DesiredItem = DocItem | PathItem;
