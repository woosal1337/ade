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
export {
  type InventoryReport,
  type InventoryRow,
  type InventoryStatus,
  inventory,
} from "./engine/inventory.ts";
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
  describeHarnesses,
  detectHarnesses,
  getAdapter,
  type HarnessRow,
  listAdapters,
  sharedSkillsDir,
} from "./harness/registry.ts";
export type { HarnessAdapter } from "./harness/types.ts";
export { type Bundle, exportBundle, importBundle } from "./profile/bundle.ts";
export {
  addFile,
  addMarketplace,
  addMcpServer,
  addPlugin,
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
  ADE_MD_FILE,
  digestOf,
  isMarkdownProfile,
  type ParsedMarkdown,
  parseMarkdown,
  writeMarkdown,
} from "./profile/markdown.ts";
export {
  type PackOptions,
  type PackResult,
  packProfile,
  type ShareOptions,
  type ShareResult,
  shareProfile,
} from "./profile/pack.ts";
export { type RiskItem, riskSummary } from "./profile/risk.ts";
export {
  type FileEntry,
  HARNESS_IDS,
  type HarnessId,
  type InstallMode,
  type Lock,
  type McpServer,
  type PatchEntry,
  type PluginSet,
  type Profile,
  ProfileSchema,
  profileJsonSchema,
  ROOT_IDS,
  type RootId,
  type SecretSource,
  type Skill,
} from "./profile/schema.ts";
export {
  loadMarkdownProfile,
  type ProfileSource,
  type ResolvedProfile,
  readDefaultProfile,
  resolveProfile,
  sharedProblems,
  writeDefaultProfile,
} from "./profile/source.ts";
export { type ProfileSpec, parseProfileSpec } from "./profile/spec.ts";
export {
  checkTrust,
  listTrust,
  recordTrust,
  removeTrust,
  type TrustEntry,
  type TrustStatus,
  trustEntries,
} from "./profile/trust.ts";
export {
  callRemote,
  type RemoteCaptureResult,
  type RemoteOptions,
  type RemoteProfileOptions,
  type RemoteResult,
  type RemoteTarget,
  type RemoteTransport,
  remoteApply,
  remoteCapture,
  remoteDoctor,
  remoteHarnesses,
  remoteHistory,
  remotePlan,
  remoteRevert,
  remoteStatus,
  shipProfile,
  sshTransport,
} from "./remote/client.ts";
export type { RemoteInfo, RemoteOp } from "./remote/protocol.ts";
export {
  type CommandRunner,
  createPreviewResolver,
  createSecretResolver,
  type SecretResolver,
} from "./secrets/resolve.ts";
export { VERSION } from "./version.ts";
