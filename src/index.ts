export {
  type Context,
  type ContextOptions,
  createContext,
  defaultProfileDir,
} from "./core/context.ts";
export { AdeError, type ErrorCode, isAdeError } from "./core/errors.ts";
export { type ApplyOptions, type ApplyResult, apply } from "./engine/apply.ts";
export {
  type CaptureInclude,
  type CaptureOptions,
  type CaptureResult,
  capture,
  writeCapture,
} from "./engine/capture.ts";
export { type Check, type DoctorReport, doctor } from "./engine/doctor.ts";
export {
  listApplies,
  type RecordSummary,
  type RevertOptions,
  type RevertResult,
  revert,
} from "./engine/history.ts";
export type { ItemKind, Scope } from "./engine/items.ts";
export {
  type Action,
  type Change,
  type Plan,
  type PlanOptions,
  type PlanSummary,
  plan,
} from "./engine/plan.ts";
export { type StatusReport, status } from "./engine/status.ts";
export { type SkillUpdate, type UpdateResult, updateSkills } from "./engine/update.ts";
export {
  type Detection,
  detectHarnesses,
  getAdapter,
  listAdapters,
  sharedSkillsDir,
} from "./harness/registry.ts";
export type { HarnessAdapter } from "./harness/types.ts";
export { type Bundle, exportBundle, importBundle } from "./profile/bundle.ts";
export {
  addFile,
  addMcpServer,
  addSecret,
  addSkill,
  type EntryKind,
  removeEntry,
  setSetting,
  unsetSetting,
} from "./profile/edit.ts";
export {
  initProfile,
  type LoadedProfile,
  loadProfile,
  PROFILE_FILE,
  saveLock,
  saveProfile,
} from "./profile/load.ts";
export {
  type FileEntry,
  HARNESS_IDS,
  type HarnessId,
  type InstallMode,
  type Lock,
  type McpServer,
  type Profile,
  ProfileSchema,
  profileJsonSchema,
  type SecretSource,
  type Skill,
} from "./profile/schema.ts";
export {
  type CommandRunner,
  createSecretResolver,
  type SecretResolver,
} from "./secrets/resolve.ts";
