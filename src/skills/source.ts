import type { Context } from "../core/context.ts";
import { AdeError } from "../core/errors.ts";
import { safeJoin, statOrUndefined, treeHash } from "../core/fsx.ts";
import type { LoadedProfile } from "../profile/load.ts";
import {
  type GitSkill,
  isGitSkill,
  isLinkSkill,
  type LockedSkill,
  type Skill,
} from "../profile/schema.ts";
import { type CommandRunner, expandUserPath } from "../secrets/resolve.ts";
import { materializeGitTree, resolveGitRef } from "./git.ts";

export interface SkillSource {
  readonly dir: string;
  readonly hash: string;
  readonly linked: boolean;
  readonly missing: boolean;
}

export interface SkillResolver {
  resolve(name: string, skill: Skill): Promise<SkillSource>;
}

export interface SkillResolverOptions {
  readonly allowFetch: boolean;
  readonly runner?: CommandRunner;
}

export function createSkillResolver(
  loaded: LoadedProfile,
  ctx: Context,
  options: SkillResolverOptions,
): SkillResolver {
  const cache = new Map<string, SkillSource>();
  return {
    async resolve(name, skill) {
      const cached = cache.get(name);
      if (cached !== undefined) {
        return cached;
      }
      const source = isGitSkill(skill)
        ? await resolveLockedGitSkill(loaded, ctx, name, skill, options)
        : isLinkSkill(skill)
          ? await resolveLinkSkill(ctx, skill.link)
          : await resolvePathSkill(loaded, name, skill.path);
      cache.set(name, source);
      return source;
    },
  };
}

async function resolvePathSkill(
  loaded: LoadedProfile,
  name: string,
  relative: string,
): Promise<SkillSource> {
  const dir = safeJoin(loaded.dir, relative, "the profile directory");
  const stat = await statOrUndefined(dir);
  if (!stat?.isDirectory()) {
    throw new AdeError("not-found", `The skill ${name} has no directory: ${dir}.`, {
      hint: "Create the directory or correct the skill path in the profile.",
    });
  }
  return { dir, hash: await treeHash(dir), linked: false, missing: false };
}

async function resolveLinkSkill(ctx: Context, link: string): Promise<SkillSource> {
  const dir = expandUserPath(link, ctx);
  const stat = await statOrUndefined(dir);
  if (!stat?.isDirectory()) {
    return { dir, hash: "", linked: true, missing: true };
  }
  return { dir, hash: await treeHash(dir), linked: true, missing: false };
}

function lockMatches(locked: LockedSkill | undefined, skill: GitSkill): boolean {
  return (
    locked !== undefined &&
    locked.git === skill.git &&
    locked.ref === (skill.ref ?? "HEAD") &&
    (locked.subdir ?? "") === (skill.subdir ?? "")
  );
}

async function resolveLockedGitSkill(
  loaded: LoadedProfile,
  ctx: Context,
  name: string,
  skill: GitSkill,
  options: SkillResolverOptions,
): Promise<SkillSource> {
  const locked = loaded.lock.skills[name];
  if (!lockMatches(locked, skill) || locked === undefined) {
    throw new AdeError("not-found", `The skill ${name} has no matching lock entry.`, {
      hint: `Run \`ade update ${name}\` to fetch the skill and lock its commit.`,
    });
  }
  const dir = await materializeGitTree(
    ctx,
    {
      url: locked.git,
      ref: locked.ref,
      commit: locked.commit,
      subdir: locked.subdir,
      verifyRef: true,
    },
    { allowFetch: options.allowFetch, ...(options.runner ? { runner: options.runner } : {}) },
  );
  const hash = await treeHash(dir);
  if (hash !== locked.hash) {
    throw new AdeError(
      "conflict",
      `The content of the skill ${name} does not match the lock file.`,
      {
        hint: `Run \`ade update ${name}\` to lock the current content.`,
      },
    );
  }
  return { dir, hash, linked: false, missing: false };
}

export async function lockGitSkill(
  ctx: Context,
  skill: GitSkill,
  runner?: CommandRunner,
): Promise<LockedSkill> {
  const ref = skill.ref ?? "HEAD";
  const commit = await resolveGitRef(ctx, skill.git, ref, runner);
  const dir = await materializeGitTree(
    ctx,
    { url: skill.git, ref, commit, subdir: skill.subdir },
    { allowFetch: true, ...(runner ? { runner } : {}) },
  );
  return {
    git: skill.git,
    ref,
    ...(skill.subdir === undefined ? {} : { subdir: skill.subdir }),
    commit,
    hash: await treeHash(dir),
  };
}
