import type { Context } from "../core/context.ts";
import { AdeError } from "../core/errors.ts";
import { type LoadedProfile, saveLock } from "../profile/load.ts";
import { isGitSkill, type Lock } from "../profile/schema.ts";
import type { CommandRunner } from "../secrets/resolve.ts";
import { lockGitSkill } from "../skills/source.ts";

export interface SkillUpdate {
  readonly name: string;
  readonly from: string | undefined;
  readonly to: string;
  readonly changed: boolean;
}

export interface UpdateResult {
  readonly updates: readonly SkillUpdate[];
  readonly lock: Lock;
}

export async function updateSkills(
  loaded: LoadedProfile,
  ctx: Context,
  names: readonly string[] = [],
  runner?: CommandRunner,
): Promise<UpdateResult> {
  const skills = loaded.profile.skills ?? {};
  for (const name of names) {
    const skill = skills[name];
    if (skill === undefined) {
      throw new AdeError("not-found", `The profile has no skill ${name}.`);
    }
    if (!isGitSkill(skill)) {
      throw new AdeError("usage", `The skill ${name} has a path source. Only Git skills update.`);
    }
  }
  const selected = Object.entries(skills).filter(
    ([name, skill]) => isGitSkill(skill) && (names.length === 0 || names.includes(name)),
  );
  const lock: Lock = { version: 1, skills: { ...loaded.lock.skills } };
  for (const name of Object.keys(lock.skills)) {
    const skill = skills[name];
    if (skill === undefined || !isGitSkill(skill)) {
      delete lock.skills[name];
    }
  }
  const updates: SkillUpdate[] = [];
  for (const [name, skill] of selected) {
    if (!isGitSkill(skill)) {
      continue;
    }
    const previous = lock.skills[name];
    const next = await lockGitSkill(ctx, skill, runner);
    lock.skills[name] = next;
    updates.push({
      name,
      from: previous?.commit,
      to: next.commit,
      changed: previous?.commit !== next.commit || previous?.hash !== next.hash,
    });
  }
  await saveLock(loaded.dir, lock);
  return { updates, lock };
}
