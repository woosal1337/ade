import { z } from "zod";
import { isSafeRelative } from "../core/fsx.ts";
import { isGitRef, isGitUrl } from "../core/git-input.ts";

export const HARNESS_IDS = [
  "claude",
  "codex",
  "cursor",
  "grok",
  "pi",
  "gemini",
  "opencode",
  "zed",
  "claude-desktop",
  "antigravity",
] as const;
export const HarnessIdSchema = z.enum(HARNESS_IDS);
export type HarnessId = z.infer<typeof HarnessIdSchema>;

export const EXTRA_ROOT_IDS = ["home", "cursor-user"] as const;
export const ROOT_IDS = [...HARNESS_IDS, ...EXTRA_ROOT_IDS] as const;
export const RootIdSchema = z.enum(ROOT_IDS);
export type RootId = z.infer<typeof RootIdSchema>;

export const ENTRY_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
export const SECRET_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const SETTINGS_KEY_PATTERN = new RegExp(
  `^(${ROOT_IDS.map((id) => id.replace(/[-]/g, "\\-")).join("|")})(:[^:\\\\]+)?$`,
);

const entryName = z
  .string()
  .max(64)
  .regex(
    ENTRY_NAME_PATTERN,
    "Use letters, digits, '.', '_', and '-', and start with a letter or digit.",
  );
const secretName = z
  .string()
  .max(64)
  .regex(SECRET_NAME_PATTERN, "Use letters, digits, and '_', and start with a letter or '_'.");
const relativePath = z
  .string()
  .min(1)
  .refine(isSafeRelative, "Use a relative path that stays inside its root.");
const harnessList = z.array(HarnessIdSchema).min(1);
const gitUrl = z
  .string()
  .min(1)
  .refine(isGitUrl, "Use a Git URL or a local path that does not start with '-'.");
const gitRef = z
  .string()
  .min(1)
  .refine(isGitRef, "Use a branch name, a tag name, HEAD, or a full commit hash.");
const commandValue = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith("-"), "The value must not start with '-'.");
const jsonObject = z.record(z.string(), z.json());
const overrides = z.partialRecord(HarnessIdSchema, jsonObject);

export const McpStdioServerSchema = z.strictObject({
  transport: z.literal("stdio"),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  harnesses: harnessList.optional(),
  overrides: overrides.optional(),
});

export const McpHttpServerSchema = z.strictObject({
  transport: z.literal("http"),
  url: z.string().min(1),
  headers: z.record(z.string(), z.string()).optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  harnesses: harnessList.optional(),
  overrides: overrides.optional(),
});

export const McpServerSchema = z.discriminatedUnion("transport", [
  McpStdioServerSchema,
  McpHttpServerSchema,
]);

export const SkillOriginSchema = z.strictObject({
  git: gitUrl,
  subdir: z.string().optional(),
  ref: gitRef.optional(),
});

export const PathSkillSchema = z.strictObject({
  path: relativePath,
  origin: SkillOriginSchema.optional(),
  harnesses: harnessList.optional(),
});

export const GitSkillSchema = z.strictObject({
  git: gitUrl,
  ref: gitRef.optional(),
  subdir: relativePath.optional(),
  harnesses: harnessList.optional(),
});

export const LinkSkillSchema = z.strictObject({
  link: z.string().min(1),
  harnesses: harnessList.optional(),
});

export const SkillSchema = z.union([PathSkillSchema, GitSkillSchema, LinkSkillSchema]);

export const SecretSourceSchema = z.discriminatedUnion("from", [
  z.strictObject({ from: z.literal("env"), name: z.string().min(1) }),
  z.strictObject({ from: z.literal("file"), path: z.string().min(1) }),
  z.strictObject({ from: z.literal("command"), argv: z.array(z.string().min(1)).min(1) }),
  z.strictObject({
    from: z.literal("keychain"),
    service: z.string().min(1),
    account: z.string().min(1),
  }),
]);

export const InstructionsSchema = z.strictObject({
  file: relativePath,
  harnesses: harnessList.optional(),
});

export const FileEntrySchema = z.strictObject({
  root: RootIdSchema,
  target: relativePath,
  source: relativePath.optional(),
  symlink: z.string().min(1).optional(),
  template: z.boolean().optional(),
  once: z.boolean().optional(),
  link: z.boolean().optional(),
  mode: z
    .string()
    .regex(/^[0-7]{3,4}$/, "Use an octal mode such as 600 or 644.")
    .optional(),
});

export const SettingsSchema = z.record(
  z
    .string()
    .regex(
      SETTINGS_KEY_PATTERN,
      "Use a harness name, or a harness name, a colon, and a relative file path.",
    ),
  jsonObject,
);

export const PluginSetSchema = z.strictObject({
  marketplaces: z.record(commandValue, commandValue).optional(),
  install: z.array(commandValue).optional(),
});

export const PatchEntrySchema = z.strictObject({
  root: RootIdSchema,
  target: relativePath,
  source: relativePath,
});

export const InstallModeSchema = z.enum(["auto", "link", "copy"]);

export const ProfileSchema = z.strictObject({
  $schema: z.string().optional(),
  version: z.literal(1),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  harnesses: harnessList.optional(),
  install: InstallModeSchema.optional(),
  instructions: InstructionsSchema.optional(),
  mcp: z.record(entryName, McpServerSchema).optional(),
  skills: z.record(entryName, SkillSchema).optional(),
  settings: SettingsSchema.optional(),
  files: z.array(FileEntrySchema).optional(),
  plugins: z.partialRecord(HarnessIdSchema, PluginSetSchema).optional(),
  patches: z.array(PatchEntrySchema).optional(),
  secrets: z.record(secretName, SecretSourceSchema).optional(),
});

export const LockedSkillSchema = z.strictObject({
  git: gitUrl,
  ref: gitRef,
  subdir: z.string().optional(),
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
});

export const LockSchema = z.strictObject({
  version: z.literal(1),
  skills: z.record(z.string(), LockedSkillSchema),
});

export type McpStdioServer = z.infer<typeof McpStdioServerSchema>;
export type McpHttpServer = z.infer<typeof McpHttpServerSchema>;
export type McpServer = z.infer<typeof McpServerSchema>;
export type PathSkill = z.infer<typeof PathSkillSchema>;
export type GitSkill = z.infer<typeof GitSkillSchema>;
export type LinkSkill = z.infer<typeof LinkSkillSchema>;
export type Skill = z.infer<typeof SkillSchema>;
export type SecretSource = z.infer<typeof SecretSourceSchema>;
export type Instructions = z.infer<typeof InstructionsSchema>;
export type FileEntry = z.infer<typeof FileEntrySchema>;
export type PluginSet = z.infer<typeof PluginSetSchema>;
export type PatchEntry = z.infer<typeof PatchEntrySchema>;
export type InstallMode = z.infer<typeof InstallModeSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
export type LockedSkill = z.infer<typeof LockedSkillSchema>;
export type Lock = z.infer<typeof LockSchema>;

export function isGitSkill(skill: Skill): skill is GitSkill {
  return "git" in skill;
}

export function isLinkSkill(skill: Skill): skill is LinkSkill {
  return "link" in skill;
}

export function emptyLock(): Lock {
  return { version: 1, skills: {} };
}

export const SCHEMA_ID = "https://github.com/woosal1337/ade/blob/main/schema/ade.schema.json";

export function profileJsonSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(ProfileSchema, {
    target: "draft-2020-12",
    unrepresentable: "any",
  }) as Record<string, unknown>;
  return {
    ...generated,
    $id: SCHEMA_ID,
    title: "ade profile",
    description: "The source of truth for one agent development environment.",
  };
}
