import fs from "node:fs/promises";
import path from "node:path";
import type { Context } from "../core/context.ts";
import { AdeError } from "../core/errors.ts";
import { countFiles, isEmptyDir, safeJoin, statOrUndefined } from "../core/fsx.ts";
import { compareText } from "../core/hash.ts";
import { isSecretFileName } from "../harness/inventory-rules.ts";
import { type CommandRunner, expandUserPath } from "../secrets/resolve.ts";
import { findTokens, type TokenFinding } from "../secrets/scan.ts";
import { createSkillResolver } from "../skills/source.ts";
import {
  type Bundle,
  type BundleFile,
  dirToBundleFiles,
  exportBundle,
  importBundle,
  modeFlags,
} from "./bundle.ts";
import {
  LOCK_FILE,
  type LoadedProfile,
  PROFILE_FILE,
  profileText,
  SCHEMA_FILE,
  writeSchemaFile,
} from "./load.ts";
import { ADE_MD_FILE, isMarkdownProfile, parseMarkdown, writeMarkdown } from "./markdown.ts";
import { isGitSkill, isLinkSkill, type Lock, type Profile } from "./schema.ts";

export interface BundleBuildOptions {
  readonly vendorGit: boolean;
  readonly vendorLinks: boolean;
  readonly dropGitSkills?: boolean | undefined;
  readonly runner?: CommandRunner | undefined;
}

export interface BuiltBundle {
  readonly bundle: Bundle;
  readonly profile: Profile;
  readonly notes: readonly string[];
}

function isLocalGitUrl(url: string): boolean {
  return url.startsWith("file:") || path.isAbsolute(url) || url.startsWith(".");
}

export async function buildProfileBundle(
  loaded: LoadedProfile,
  ctx: Context,
  options: BundleBuildOptions,
): Promise<BuiltBundle> {
  const base = await exportBundle(loaded, ctx.now());
  const skills = createSkillResolver(loaded, ctx, {
    allowFetch: true,
    ...(options.runner === undefined ? {} : { runner: options.runner }),
  });
  const notes: string[] = [];
  const extra: BundleFile[] = [];
  const profile: Profile = structuredClone(loaded.profile);
  const lock: Lock = { version: 1, skills: { ...loaded.lock.skills } };
  for (const [name, skill] of Object.entries(loaded.profile.skills ?? {})) {
    if (options.dropGitSkills === true && isGitSkill(skill)) {
      delete profile.skills?.[name];
      delete lock.skills[name];
      notes.push(`ade sends the skill ${name} from ${skill.git} after you trust the source.`);
      continue;
    }
    const vendorGit = isGitSkill(skill) && (options.vendorGit || isLocalGitUrl(skill.git));
    const vendorLink = isLinkSkill(skill) && options.vendorLinks;
    if (!vendorGit && !vendorLink) {
      continue;
    }
    const source = await skills.resolve(name, skill);
    if (source.missing) {
      notes.push(`The skill ${name} links to a path that does not exist here. ade keeps the link.`);
      continue;
    }
    const prefix = `vendor/skills/${name}`;
    extra.push(...(await dirToBundleFiles(source.dir, prefix)));
    const harnesses = skill.harnesses === undefined ? {} : { harnesses: skill.harnesses };
    const skillsField = profile.skills ?? {};
    if (isGitSkill(skill)) {
      if (!options.vendorGit) {
        notes.push(`The skill ${name} comes from a local Git repository. ade copies its files.`);
      }
      skillsField[name] = {
        path: prefix,
        origin: {
          git: skill.git,
          ...(skill.subdir === undefined ? {} : { subdir: skill.subdir }),
          ...(skill.ref === undefined ? {} : { ref: skill.ref }),
        },
        ...harnesses,
      };
      delete lock.skills[name];
    } else {
      skillsField[name] = { path: prefix, ...harnesses };
    }
    profile.skills = skillsField;
  }
  const entries = [...(profile.files ?? [])];
  for (const [index, entry] of entries.entries()) {
    if (entry.symlink === undefined || !options.vendorLinks) {
      continue;
    }
    const target = expandUserPath(entry.symlink, ctx);
    const stat = await statOrUndefined(target);
    if (stat === undefined) {
      notes.push(
        `The link ${entry.root}:${entry.target} points to a path that does not exist here. ade keeps the link.`,
      );
      continue;
    }
    const prefix = `vendor/files/${entry.root}/${entry.target}`;
    if (stat.isDirectory()) {
      extra.push(...(await dirToBundleFiles(target, prefix)));
    } else {
      const content = await fs.readFile(target);
      extra.push({
        path: prefix,
        ...(content.includes(0)
          ? { encoding: "base64" as const, content: content.toString("base64") }
          : { encoding: "utf8" as const, content: content.toString("utf8") }),
        ...modeFlags(stat.mode),
      });
    }
    entries[index] = { root: entry.root, target: entry.target, source: prefix };
  }
  if (profile.files !== undefined) {
    profile.files = entries;
  }
  const kept = Object.keys(lock.skills).filter((name) => {
    const skill = profile.skills?.[name];
    return skill !== undefined && isGitSkill(skill);
  });
  const lockFiles: BundleFile[] =
    kept.length === 0
      ? []
      : [
          {
            path: LOCK_FILE,
            encoding: "utf8",
            content: `${JSON.stringify(
              {
                version: 1,
                skills: Object.fromEntries(
                  kept.sort(compareText).map((name) => [name, lock.skills[name]]),
                ),
              },
              null,
              2,
            )}\n`,
          },
        ];
  const files = base.files
    .filter((file) => file.path !== PROFILE_FILE && file.path !== LOCK_FILE)
    .concat(extra, lockFiles, [
      { path: PROFILE_FILE, encoding: "utf8", content: profileText(profile) },
    ]);
  return { bundle: { ...base, files }, profile, notes };
}

export function scanBundle(bundle: Bundle): TokenFinding[] {
  return bundle.files.flatMap((file) => [
    ...(isSecretFileName(path.posix.basename(file.path))
      ? [{ file: file.path, line: 1, kind: "credential file" }]
      : []),
    ...findTokens(
      file.encoding === "utf8"
        ? file.content
        : Buffer.from(file.content, "base64").toString("latin1"),
      file.path,
    ),
  ]);
}

export interface PackOptions {
  readonly vendorGit?: boolean | undefined;
  readonly force?: boolean | undefined;
  readonly repo?: string | undefined;
  readonly runner?: CommandRunner | undefined;
}

export interface PackResult {
  readonly dir: string;
  readonly files: number;
  readonly warnings: readonly string[];
  readonly notes: readonly string[];
}

function portabilityWarnings(profile: Profile, ctx: Context): string[] {
  const warnings: string[] = [];
  const text = JSON.stringify([profile.mcp, profile.settings]);
  if (ctx.home.length > 1 && text.includes(JSON.stringify(ctx.home).slice(1, -1))) {
    warnings.push(
      "The profile holds the local home path. Use ${home} so that it works on other machines.",
    );
  }
  for (const [name, source] of Object.entries(profile.secrets ?? {})) {
    if (source.from !== "env") {
      warnings.push(
        `The secret ${name} reads from a ${source.from}. Other users need the same ${source.from}. An env source works on every machine.`,
      );
    }
  }
  return warnings;
}

function readme(profile: Profile, repo: string | undefined): string {
  const name = profile.name ?? "agents";
  const target = repo ?? "<owner>/<repo>";
  const lines = [
    `# ${name}`,
    "",
    profile.description ?? "An agent development environment profile for ade.",
    "",
    "## Use it",
    "",
    "1. Show the changes for your machine:",
    "",
    "   ```bash",
    `   ade plan ${target}`,
    "   ```",
    "",
    "2. Apply the profile. ade shows what it runs and writes, and asks you to trust the source:",
    "",
    "   ```bash",
    `   ade apply ${target}`,
    "   ```",
    "",
    "## Contents",
    "",
    "| Item | Value |",
    "|---|---|",
    `| Harnesses | ${(profile.harnesses ?? ["the installed harnesses"]).join(", ")} |`,
    `| Instructions | ${profile.instructions === undefined ? "none" : profile.instructions.file} |`,
    `| MCP servers | ${Object.keys(profile.mcp ?? {}).join(", ") || "none"} |`,
    `| Skills | ${Object.keys(profile.skills ?? {}).join(", ") || "none"} |`,
    `| Settings | ${Object.keys(profile.settings ?? {}).join(", ") || "none"} |`,
    `| Files | ${(profile.files ?? []).map((entry) => `${entry.root}:${entry.target}`).join(", ") || "none"} |`,
  ];
  const secrets = Object.entries(profile.secrets ?? {});
  if (secrets.length > 0) {
    lines.push(
      "",
      "## Secrets",
      "",
      "Set these values on your machine before you apply the profile:",
      "",
    );
    for (const [secretName, source] of secrets) {
      lines.push(
        `- \`${secretName}\`: ${source.from === "env" ? `the environment variable \`${source.name}\`` : `a ${source.from} source`}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

export async function packProfile(
  loaded: LoadedProfile,
  ctx: Context,
  outDir: string,
  options: PackOptions = {},
): Promise<PackResult> {
  const root = path.resolve(outDir);
  if (path.resolve(root) === path.resolve(loaded.dir)) {
    throw new AdeError("usage", "The output directory is the profile directory.", {
      hint: "Give another directory with --out.",
    });
  }
  if (!(await isEmptyDir(root)) && options.force !== true) {
    throw new AdeError("profile-exists", `The directory is not empty: ${root}.`, {
      hint: "Use an empty directory, or add --force to write into it.",
    });
  }
  const built = await buildProfileBundle(loaded, ctx, {
    vendorGit: options.vendorGit === true,
    vendorLinks: true,
    runner: options.runner,
  });
  const findings = scanBundle(built.bundle);
  if (findings.length > 0) {
    throw new AdeError(
      "conflict",
      `The profile holds ${findings.length} values that look like secrets.`,
      {
        details: findings.map((finding) => `${finding.file}:${finding.line}: ${finding.kind}`),
        hint: "Replace each value with a ${secret:NAME} reference, then run the command again.",
      },
    );
  }
  const published: Profile = { $schema: `./${SCHEMA_FILE}`, ...built.profile };
  const bundle: Bundle = {
    ...built.bundle,
    files: built.bundle.files.map((file) =>
      file.path === PROFILE_FILE ? { ...file, content: profileText(published) } : file,
    ),
  };
  await importBundle(bundle, root, { force: options.force });
  await writeSchemaFile(root);
  const readmePath = safeJoin(root, "README.md", "the output directory");
  if ((await statOrUndefined(readmePath)) === undefined) {
    await fs.writeFile(readmePath, readme(built.profile, options.repo));
  }
  return {
    dir: root,
    files: await countFiles(root),
    warnings: portabilityWarnings(built.profile, ctx),
    notes: built.notes,
  };
}

export interface ShareOptions {
  readonly source?: string | undefined;
  readonly vendorGit?: boolean | undefined;
  readonly runner?: CommandRunner | undefined;
  readonly previous?: string | undefined;
}

export interface ShareResult {
  readonly markdown: string;
  readonly files: number;
  readonly digest: string;
  readonly warnings: readonly string[];
  readonly notes: readonly string[];
}

export interface SharedBundle {
  readonly bundle: Bundle;
  readonly profile: Profile;
  readonly notes: readonly string[];
}

export async function sharedBundle(
  loaded: LoadedProfile,
  ctx: Context,
  options: Pick<ShareOptions, "vendorGit" | "runner"> = {},
): Promise<SharedBundle> {
  const built = await buildProfileBundle(loaded, ctx, {
    vendorGit: options.vendorGit === true,
    vendorLinks: true,
    runner: options.runner,
  });
  const { $schema: _schema, ...profile } = built.profile;
  const files = built.bundle.files
    .filter((file) => file.path !== SCHEMA_FILE)
    .map((file) =>
      file.path === PROFILE_FILE
        ? { ...file, encoding: "utf8" as const, content: profileText(profile) }
        : file,
    );
  const bundle: Bundle = { ...built.bundle, files };
  const findings = scanBundle(bundle);
  if (findings.length > 0) {
    throw new AdeError(
      "conflict",
      `The profile holds ${findings.length} values that look like secrets.`,
      {
        details: findings.map((finding) => `${finding.file}:${finding.line}: ${finding.kind}`),
        hint: "Replace each value with a ${secret:NAME} reference, then run the command again.",
      },
    );
  }
  return { bundle, profile, notes: built.notes };
}

export async function shareProfile(
  loaded: LoadedProfile,
  ctx: Context,
  options: ShareOptions = {},
): Promise<ShareResult> {
  const { bundle, profile, notes } = await sharedBundle(loaded, ctx, options);
  let markdown = writeMarkdown(bundle, profile, {
    source: options.source,
    createdAt: ctx.now(),
  });
  const parsed = parseMarkdown(markdown, ADE_MD_FILE);
  if (options.previous !== undefined && isMarkdownProfile(options.previous)) {
    try {
      const before = parseMarkdown(options.previous, ADE_MD_FILE);
      if (before.digest === parsed.digest && typeof before.meta.created === "string") {
        markdown = writeMarkdown(bundle, profile, {
          source: options.source,
          createdAt: new Date(before.meta.created),
        });
      }
    } catch {
      markdown = writeMarkdown(bundle, profile, { source: options.source, createdAt: ctx.now() });
    }
  }
  return {
    markdown,
    files: parsed.bundle.files.length,
    digest: parsed.digest,
    warnings: portabilityWarnings(profile, ctx),
    notes,
  };
}
