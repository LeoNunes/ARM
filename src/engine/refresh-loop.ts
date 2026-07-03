import { GitClient } from "../git/client";
import { runAutoUpdatePass } from "./update-pass";
import type { SettingsStore } from "../state/settings";
import type { SkillsRepoStore } from "../state/skills-repos";
import type { WorkingRepoStore } from "../state/working-repos";
import type { InstallsStore } from "../state/installs";
import type { ActivityLogStore } from "../state/activity-log";
import type { buildRegistries } from "../adapters/index";

export interface RefreshLoopDeps {
  settings: SettingsStore;
  skillsRepos: SkillsRepoStore;
  workingRepos: WorkingRepoStore;
  installs: InstallsStore;
  activityLog: ActivityLogStore;
  registries: ReturnType<typeof buildRegistries>;
}

function artifactDisplayName(artifactKey: string): string {
  return artifactKey.split(":").slice(1).join(":").split("/").pop() || artifactKey;
}

export async function runRefreshPass(deps: RefreshLoopDeps): Promise<void> {
  const allRepos = await deps.skillsRepos.list();
  const git = new GitClient();

  for (const repo of allRepos) {
    try {
      await git.fetchAndReset(repo.localClonePath, repo.branch);
      await deps.skillsRepos.update(repo.id, { lastFetchedAt: new Date().toISOString() });
    } catch (err) {
      process.stderr.write(`refresh-loop: fetch failed for ${repo.name}: ${(err as Error).message}\n`);
    }
  }

  const applied = await runAutoUpdatePass({
    installs: deps.installs,
    skillsRepos: deps.skillsRepos,
    workingRepos: deps.workingRepos,
    registries: deps.registries,
  });

  const allWrs = await deps.workingRepos.list();
  const wrsById = new Map(allWrs.map((w) => [w.id, w]));

  for (const { install, oldSha, newSha } of applied) {
    const name = artifactDisplayName(install.artifactKey);
    const wrName =
      install.target.type === "working-repo"
        ? (wrsById.get(install.target.workingRepoId)?.name ?? install.target.workingRepoId)
        : "global";
    await deps.activityLog.add({
      ts: new Date().toISOString(),
      category: "auto-update",
      summary: `Auto-updated '${name}' in '${wrName}'`,
      detail: `${oldSha.slice(0, 7)} → ${newSha.slice(0, 7)}`,
      artifactKey: install.artifactKey,
      workingRepoId: install.target.type === "working-repo" ? install.target.workingRepoId : undefined,
      sourceRepoId: install.sourceRepoId,
    });
  }
}

export function startRefreshLoop(deps: RefreshLoopDeps): void {
  async function tick(): Promise<void> {
    const settings = await deps.settings.read();
    let nextDelayMs: number;
    if (!settings.autoRefreshEnabled) {
      nextDelayMs = 60_000;
    } else {
      try {
        await runRefreshPass(deps);
      } catch (err) {
        process.stderr.write(`refresh-loop error: ${(err as Error).message}\n`);
      }
      const s2 = await deps.settings.read();
      nextDelayMs = s2.autoRefreshIntervalMinutes * 60_000;
    }
    setTimeout(() => { void tick(); }, nextDelayMs);
  }
  setTimeout(() => { void tick(); }, 60_000);
}
