import { formatPointer } from "../core/doc.ts";
import { listLeaves } from "../core/merge.ts";
import { printable } from "../core/text.ts";
import { findSecretRefs } from "../secrets/refs.ts";
import { isGitSkill, isLinkSkill, type Lock, type Profile } from "./schema.ts";

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
}

const EXECUTION_KEY =
  /^(hooks?|command|commands|notify|statusLine|apiKeyHelper|otelHeadersHelper|awsAuthRefresh|awsCredentialExport|shellPath|shellCommandPrefix|npmCommand|packages|plugins?|enabledPlugins|extraKnownMarketplaces|marketplaces?|extensions|auto_install_extensions|auto_update_extensions|env|mcp_servers|mcpServers|context_servers|enableAllProjectMcpServers|enabledMcpjsonServers|discoveryCommand|callCommand|model_providers|base_url|baseUrl|apiBase)$/i;
const OUTSIDE_ROOTS = new Set(["home", "cursor-user"]);
const PERMISSION_KEY =
  /(permission|approval|sandbox|yolo|dangerous|trust|autoMode|defaultMode|^allow$|^deny$|bypass)/i;

function compact(value: unknown): string {
  return JSON.stringify(value) ?? String(value);
}

function commandLine(argv: readonly string[]): string {
  return argv
    .map((part) => (/^[A-Za-z0-9_@%+=:,./~-]+$/.test(part) ? part : JSON.stringify(part)))
    .join(" ");
}

function sends(value: unknown): string {
  const secrets = [...findSecretRefs(value)].sort();
  return secrets.length === 0 ? "" : ` and sends the secrets ${secrets.join(", ")}`;
}

export function riskSummary(profile: Profile, lock?: Lock): RiskItem[] {
  const items: RiskItem[] = [];
  const add = (level: RiskLevel, area: RiskArea, text: string): void => {
    items.push({ level, area, text: printable(text) });
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
      const env = Object.entries(server.env ?? {}).map(([key, value]) => `${key}=${value}`);
      const { overrides: _overrides, ...base } = server;
      add(
        "high",
        "mcp",
        `${name} runs: ${commandLine([server.command, ...(server.args ?? [])])}${env.length === 0 ? "" : ` (env: ${env.join(", ")})`}${server.cwd === undefined ? "" : ` in ${server.cwd}`}${sends(base)}`,
      );
    } else {
      const { overrides: _overrides, ...base } = server;
      const secrets = sends(base);
      add(secrets === "" ? "normal" : "high", "mcp", `${name} connects to ${server.url}${secrets}`);
    }
    for (const [harness, override] of Object.entries(server.overrides ?? {})) {
      const secrets = sends(override);
      add(
        secrets !== "" ||
          ["command", "args", "env", "cwd", "url", "headers"].some((key) => key in override)
          ? "high"
          : "normal",
        "mcp",
        `${name} for ${harness} adds ${compact(override)}${secrets}`,
      );
    }
  }

  for (const [docKey, patch] of Object.entries(profile.settings ?? {})) {
    const [root, file] = docKey.split(/:(.*)/s);
    if (root !== undefined && OUTSIDE_ROOTS.has(root) && file !== undefined) {
      add(
        "high",
        "setting",
        `${docKey} edits ${root === "home" ? `~/${file}` : `the Cursor user file ${file}`}`,
      );
    }
    let other = 0;
    for (const [pointer, value] of listLeaves(patch)) {
      const execution = pointer.some((segment) => EXECUTION_KEY.test(segment));
      const permission = pointer.some((segment) => PERMISSION_KEY.test(segment));
      const secrets = sends(value);
      if (execution || permission || secrets !== "") {
        add(
          "high",
          "setting",
          `${docKey} ${formatPointer(pointer)} = ${value === null ? "(deleted)" : compact(value)}${secrets}`,
        );
      } else {
        other += 1;
      }
    }
    if (other > 0) {
      add("normal", "setting", `${docKey}: ${other} other values`);
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
        add("high", "secret", `${name} reads the environment variable ${source.name}`);
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
      const locked = lock?.skills[name];
      add(
        "normal",
        "skill",
        `${name} comes from ${skill.git}${skill.subdir === undefined ? "" : `//${skill.subdir}`} at ${skill.ref ?? "HEAD"}${locked === undefined ? "" : `, commit ${locked.commit.slice(0, 12)}`}`,
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
  return items.map((item) => `${item.area}: ${item.text}`);
}
