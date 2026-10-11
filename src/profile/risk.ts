import { formatPointer } from "../core/doc.ts";
import { listLeaves } from "../core/merge.ts";
import { findSecretRefs } from "../secrets/refs.ts";
import { isGitSkill, isLinkSkill, type Profile } from "./schema.ts";

export type RiskLevel = "high" | "normal";
export type RiskArea =
  | "harness"
  | "instructions"
  | "mcp"
  | "setting"
  | "file"
  | "plugin"
  | "patch"
  | "secret"
  | "skill";

export interface RiskItem {
  readonly level: RiskLevel;
  readonly area: RiskArea;
  readonly text: string;
  readonly fingerprint: boolean;
}

const EXECUTION_KEY =
  /^(hooks?|command|commands|notify|statusLine|apiKeyHelper|awsAuthRefresh|awsCredentialExport|shellPath|shellCommandPrefix|npmCommand|packages|plugins|enabledPlugins|extraKnownMarketplaces|marketplaces?|extensions|env|mcp_servers)$/i;
const PERMISSION_KEY =
  /(permission|approval|sandbox|yolo|dangerous|trust|autoMode|defaultMode|^allow$|^deny$|bypass)/i;

function compact(value: unknown, limit = 120): string {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

export function riskSummary(profile: Profile): RiskItem[] {
  const items: RiskItem[] = [];
  const add = (level: RiskLevel, area: RiskArea, text: string, fingerprint = true): void => {
    items.push({ level, area, text, fingerprint });
  };

  add(
    "normal",
    "harness",
    `targets ${(profile.harnesses ?? ["the installed harnesses"]).join(", ")}`,
  );
  if (profile.instructions !== undefined) {
    add("normal", "instructions", "replaces the global instructions of the target harnesses");
  }

  for (const [name, server] of Object.entries(profile.mcp ?? {})) {
    if (server.transport === "stdio") {
      const env = Object.keys(server.env ?? {});
      add(
        "high",
        "mcp",
        `${name} runs: ${[server.command, ...(server.args ?? [])].join(" ")}${env.length === 0 ? "" : ` (env: ${env.join(", ")})`}`,
      );
    } else {
      const secrets = [...findSecretRefs(server.headers ?? {})];
      add(
        secrets.length > 0 ? "high" : "normal",
        "mcp",
        `${name} connects to ${server.url}${secrets.length === 0 ? "" : ` and sends the secrets ${secrets.join(", ")}`}`,
      );
    }
    for (const [harness, override] of Object.entries(server.overrides ?? {})) {
      add(
        "command" in override || "url" in override ? "high" : "normal",
        "mcp",
        `${name} for ${harness} adds ${compact(override)}`,
      );
    }
  }

  for (const [docKey, patch] of Object.entries(profile.settings ?? {})) {
    let other = 0;
    for (const [pointer, value] of listLeaves(patch)) {
      const execution = pointer.some((segment) => EXECUTION_KEY.test(segment));
      const permission = pointer.some((segment) => PERMISSION_KEY.test(segment));
      if (execution || permission) {
        add(
          "high",
          "setting",
          `${docKey} ${formatPointer(pointer)} = ${value === null ? "(deleted)" : compact(value)}`,
        );
      } else {
        other += 1;
      }
    }
    if (other > 0) {
      add("normal", "setting", `${docKey}: ${other} other values`, false);
    }
  }

  for (const entry of profile.files ?? []) {
    const where = entry.root === "home" ? `~/${entry.target}` : `${entry.root}:${entry.target}`;
    const how =
      entry.symlink !== undefined
        ? ` as a link to ${entry.symlink}`
        : entry.template === true
          ? " from a template"
          : "";
    add(
      "high",
      "file",
      `writes ${where}${how}${entry.mode === undefined ? "" : ` with mode ${entry.mode}`}${entry.once === true ? " if it does not exist" : ""}`,
    );
  }

  for (const [harness, set] of Object.entries(profile.plugins ?? {})) {
    for (const [name, source] of Object.entries(set?.marketplaces ?? {})) {
      add("high", "plugin", `${harness} adds the marketplace ${name} from ${source}`);
    }
    for (const id of set?.install ?? []) {
      add("high", "plugin", `${harness} installs ${id}`);
    }
  }

  for (const entry of profile.patches ?? []) {
    add("high", "patch", `changes the code in ${entry.root}:${entry.target} with ${entry.source}`);
  }

  for (const [name, source] of Object.entries(profile.secrets ?? {})) {
    switch (source.from) {
      case "env":
        add("normal", "secret", `${name} reads the environment variable ${source.name}`);
        break;
      case "file":
        add("high", "secret", `${name} reads the file ${source.path}`);
        break;
      case "command":
        add("high", "secret", `${name} runs: ${source.argv.join(" ")}`);
        break;
      case "keychain":
        add(
          "high",
          "secret",
          `${name} reads the Keychain item ${source.service} / ${source.account}`,
        );
        break;
    }
  }

  const plain: string[] = [];
  for (const [name, skill] of Object.entries(profile.skills ?? {})) {
    if (isLinkSkill(skill)) {
      add("high", "skill", `${name} links to ${skill.link}`);
    } else if (isGitSkill(skill)) {
      add(
        "normal",
        "skill",
        `${name} comes from ${skill.git}${skill.subdir === undefined ? "" : `//${skill.subdir}`}`,
      );
    } else {
      plain.push(name);
    }
  }
  if (plain.length > 0) {
    add("normal", "skill", `instructions for agents: ${plain.join(", ")}`);
  }

  return items.sort((left, right) =>
    left.level === right.level ? 0 : left.level === "high" ? -1 : 1,
  );
}

export function riskLines(items: readonly RiskItem[]): string[] {
  return items.filter((item) => item.fingerprint).map((item) => `${item.area}: ${item.text}`);
}
