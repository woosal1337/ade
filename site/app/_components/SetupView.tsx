"use client";

import type { ReactNode } from "react";
import type { ItemFile, ItemKind, SetupItem } from "../account";
import { HARNESSES } from "../content";
import { Tag } from "./primitives";
import { Switch } from "./Switch";

interface SectionSpec {
  readonly id: string;
  readonly title: string;
  readonly kinds: readonly ItemKind[];
}

const SECTIONS: readonly SectionSpec[] = [
  { id: "harnesses", title: "Harnesses", kinds: ["harnesses"] },
  { id: "instructions", title: "Instructions", kinds: ["instructions"] },
  { id: "skills", title: "Skills", kinds: ["skill"] },
  { id: "mcp", title: "MCP servers", kinds: ["mcp"] },
  { id: "settings", title: "Settings", kinds: ["setting"] },
  { id: "plugins", title: "Plugins", kinds: ["marketplace", "plugin"] },
  { id: "files", title: "Files", kinds: ["file"] },
  { id: "patches", title: "Patches", kinds: ["patch"] },
  { id: "secrets", title: "Secret names", kinds: ["secret"] },
];

const HARNESS_NAMES = new Map(HARNESSES.map((harness) => [harness.id, harness.name]));
const VALUE_LIMIT = 280;

export interface Editor {
  readonly busy: ReadonlySet<string>;
  readonly onChange: (keys: readonly string[], visible: boolean) => void;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function list(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function files(value: unknown): ItemFile[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is ItemFile =>
          typeof item === "object" && item !== null && typeof (item as ItemFile).path === "string",
      )
    : [];
}

function bytes(size: number): string {
  return size < 1024 ? `${size} B` : `${(size / 1024).toFixed(size < 10_240 ? 1 : 0)} KB`;
}

function harnessNames(ids: readonly string[]): string {
  return ids.map((id) => HARNESS_NAMES.get(id) ?? id).join(", ");
}

function Code({ children }: { readonly children: ReactNode }) {
  return <code className="break-all font-mono text-[12px] text-fg">{children}</code>;
}

function Preview({ summary, body }: { readonly summary: string; readonly body: string }) {
  return (
    <details className="group mt-2">
      <summary className="cursor-pointer font-mono text-[11px] text-muted hover:text-fg">
        {summary}
      </summary>
      <pre className="mt-2 max-h-80 overflow-auto border border-line bg-ink p-3 font-mono text-[12px] leading-[1.6] whitespace-pre-wrap text-muted">
        {body}
      </pre>
    </details>
  );
}

function FileList({ items }: { readonly items: readonly ItemFile[] }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <ul className="mt-2 space-y-1">
      {items.map((file) => (
        <li key={file.path} className="font-mono text-[11px] text-faint">
          {file.text === undefined ? (
            <span>
              {file.path} <span className="text-faint">({bytes(file.size)})</span>
            </span>
          ) : (
            <Preview
              summary={`${file.path} (${bytes(file.size)}${file.truncated === true ? ", cut" : ""})`}
              body={file.text}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

function Value({ value }: { readonly value: unknown }) {
  const json = JSON.stringify(value, null, 2) ?? String(value);
  const flat = JSON.stringify(value) ?? String(value);
  if (flat.length <= VALUE_LIMIT) {
    return <Code>{flat}</Code>;
  }
  return <Preview summary={`${flat.slice(0, 80)}...`} body={json} />;
}

function ItemBody({ item }: { readonly item: SetupItem }) {
  const detail = item.detail;
  switch (item.kind) {
    case "harnesses": {
      const ids = list(detail.harnesses);
      return (
        <div className="space-y-1">
          <p className="text-[14px] text-fg">
            {ids.length === 0 ? "Every installed harness" : harnessNames(ids)}
          </p>
          {text(detail.install) === undefined ? null : (
            <p className="font-mono text-[11px] text-faint">Install mode: {text(detail.install)}</p>
          )}
        </div>
      );
    }
    case "instructions":
      return (
        <div>
          <p className="font-mono text-[13px] text-fg">{text(detail.file) ?? "AGENTS.md"}</p>
          <Preview
            summary={detail.truncated === true ? "Show the text (cut)" : "Show the text"}
            body={text(detail.text) ?? ""}
          />
        </div>
      );
    case "skill": {
      const description = text(detail.description);
      const git = text(detail.git);
      const commit = text(detail.commit);
      return (
        <div>
          <p className="font-mono text-[13px] text-fg">{item.label}</p>
          {description === undefined ? null : (
            <p className="mt-1 text-[14px] leading-[1.5] text-muted">{description}</p>
          )}
          {git === undefined ? (
            <FileList items={files(detail.files)} />
          ) : (
            <p className="mt-1 font-mono text-[11px] text-faint">
              {git} @ {text(detail.ref) ?? "HEAD"}
              {commit === undefined ? "" : `, commit ${commit.slice(0, 12)}`}
            </p>
          )}
        </div>
      );
    }
    case "mcp": {
      const transport = text(detail.transport) ?? "stdio";
      const command = [text(detail.command), ...list(detail.args)].filter(Boolean).join(" ");
      const env = Object.keys(record(detail.env));
      const headers = Object.keys(record(detail.headers));
      return (
        <div className="space-y-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[13px] text-fg">{item.label}</span>
            <Tag>{transport}</Tag>
          </p>
          <p>
            <Code>{transport === "stdio" ? command : (text(detail.url) ?? "")}</Code>
          </p>
          {env.length === 0 ? null : (
            <p className="font-mono text-[11px] text-faint">Environment: {env.join(", ")}</p>
          )}
          {headers.length === 0 ? null : (
            <p className="font-mono text-[11px] text-faint">Headers: {headers.join(", ")}</p>
          )}
        </div>
      );
    }
    case "setting":
      return (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-mono text-[12px] text-muted">{item.label || "(whole file)"}</span>
          <span className="font-mono text-[12px] text-faint">=</span>
          <Value value={detail.value} />
        </div>
      );
    case "marketplace":
      return (
        <p className="flex flex-wrap items-center gap-2">
          <Tag>Marketplace</Tag>
          <span className="font-mono text-[13px] text-fg">{item.label}</span>
          <span className="font-mono text-[11px] text-faint">
            {text(detail.source)} for {harnessNames([text(detail.harness) ?? ""])}
          </span>
        </p>
      );
    case "plugin":
      return (
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[13px] text-fg">{item.label}</span>
          <span className="font-mono text-[11px] text-faint">
            for {harnessNames([text(detail.harness) ?? ""])}
          </span>
        </p>
      );
    case "file": {
      const flags = [
        detail.template === true ? "template" : undefined,
        detail.once === true ? "written once" : undefined,
        text(detail.mode) === undefined ? undefined : `mode ${text(detail.mode)}`,
      ].filter(Boolean);
      return (
        <div>
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[13px] text-fg">{item.label}</span>
            {flags.map((flag) => (
              <Tag key={flag}>{flag}</Tag>
            ))}
          </p>
          <FileList items={files(detail.files)} />
        </div>
      );
    }
    case "patch":
      return (
        <div>
          <p className="font-mono text-[13px] text-fg">{item.label}</p>
          <Preview summary="Show the patch" body={text(detail.text) ?? ""} />
        </div>
      );
    case "secret":
      return (
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[13px] text-fg">{item.label}</span>
          {text(detail.from) === undefined ? null : (
            <span className="font-mono text-[11px] text-faint">from {text(detail.from)}</span>
          )}
        </p>
      );
  }
}

function ItemRow({ item, editor }: { readonly item: SetupItem; readonly editor?: Editor }) {
  return (
    <li className="flex items-start gap-4 border-t border-line py-3 first:border-t-0">
      <div className="min-w-0 flex-1">
        <ItemBody item={item} />
      </div>
      {editor === undefined ? null : (
        <div className="flex shrink-0 items-center gap-3 pt-0.5">
          {item.state === "changed" ? (
            <span className="font-mono text-[11px] text-warn">Changed since you approved it</span>
          ) : null}
          <Switch
            checked={item.state === "public"}
            label={`Show ${item.label} on your page`}
            disabled={editor.busy.has(item.key)}
            onChange={(visible) => editor.onChange([item.key], visible)}
          />
        </div>
      )}
    </li>
  );
}

function settingGroups(items: readonly SetupItem[]): [string, SetupItem[]][] {
  const groups = new Map<string, SetupItem[]>();
  for (const item of items) {
    const document = text(item.detail.document) ?? item.group;
    groups.set(document, [...(groups.get(document) ?? []), item]);
  }
  return [...groups.entries()];
}

function SectionActions({
  items,
  editor,
}: {
  readonly items: readonly SetupItem[];
  readonly editor: Editor;
}) {
  const keys = items.map((item) => item.key);
  const busy = keys.some((key) => editor.busy.has(key));
  const button =
    "font-mono text-[11px] text-muted hover:text-fg disabled:opacity-50 disabled:hover:text-muted";
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        className={button}
        disabled={busy || items.every((item) => item.state === "public")}
        onClick={() => editor.onChange(keys, true)}
      >
        Show all
      </button>
      <button
        type="button"
        className={button}
        disabled={busy || items.every((item) => item.state !== "public")}
        onClick={() => editor.onChange(keys, false)}
      >
        Hide all
      </button>
    </div>
  );
}

export function SetupView({
  items,
  editor,
}: {
  readonly items: readonly SetupItem[];
  readonly editor?: Editor;
}) {
  const sections = SECTIONS.map((section) => ({
    ...section,
    items: items.filter((item) => section.kinds.includes(item.kind)),
  })).filter((section) => section.items.length > 0);
  return (
    <div className="space-y-6">
      {sections.map((section) => {
        const shown = section.items.filter((item) => item.state === "public").length;
        return (
          <section
            key={section.id}
            aria-labelledby={`setup-${section.id}`}
            className="border border-line bg-panel"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
              <h2 id={`setup-${section.id}`} className="font-mono text-[13px] text-fg">
                {section.title}
                <span className="ml-2 text-faint">
                  {editor === undefined
                    ? section.items.length
                    : `${shown} of ${section.items.length} shown`}
                </span>
              </h2>
              {editor === undefined ? null : (
                <SectionActions items={section.items} editor={editor} />
              )}
            </div>
            <div className="px-4">
              {section.id === "settings" ? (
                settingGroups(section.items).map(([document, group]) => (
                  <div key={document} className="border-t border-line py-2 first:border-t-0">
                    <p className="pt-2 font-mono text-[11px] text-faint">{document}</p>
                    <ul>
                      {group.map((item) => (
                        <ItemRow key={item.key} item={item} editor={editor} />
                      ))}
                    </ul>
                  </div>
                ))
              ) : (
                <ul>
                  {section.items.map((item) => (
                    <ItemRow key={item.key} item={item} editor={editor} />
                  ))}
                </ul>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
