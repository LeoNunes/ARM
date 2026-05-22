import { checkForUpdates } from "./update-check";
import { checkForDrift } from "./drift-check";
import { applyUpdate } from "./apply-update";
import type { InstallsStore } from "../state/installs";
import type { SkillsRepoStore } from "../state/skills-repos";
import type { WorkingRepoStore } from "../state/working-repos";
import type { AgentRegistry } from "../adapters/registry";

export interface AutoUpdatePassDeps {
  installs: InstallsStore;
  skillsRepos: SkillsRepoStore;
  workingRepos: WorkingRepoStore;
  registries: { agents: AgentRegistry };
}

export async function runAutoUpdatePass(deps: AutoUpdatePassDeps): Promise<void> {
  const allInstalls = await deps.installs.list();
  const allRepos = await deps.skillsRepos.list();
  const allWrs = await deps.workingRepos.list();
  const reposById = new Map(allRepos.map((r) => [r.id, r]));
  const wrsById = new Map(allWrs.map((w) => [w.id, w]));

  for (const install of allInstalls) {
    if (!install.autoUpdate) continue;
    if (install.target.type !== "working-repo") continue;

    const sr = reposById.get(install.sourceRepoId);
    if (!sr) continue;

    const wr = wrsById.get(install.target.workingRepoId);
    if (!wr) continue;

    const updateResult = await checkForUpdates(install, sr);
    if (!updateResult.hasUpdate || !updateResult.availableSha) continue;

    const driftResult = await checkForDrift(install, sr, wr.path);
    if (driftResult.isDrifted) continue;

    const agent = deps.registries.agents.get(install.agent);
    const others = allInstalls.filter((i) => i.id !== install.id);
    const patch = await applyUpdate({
      install, skillsRepo: sr, workingRepo: wr,
      newSha: updateResult.availableSha, agent,
      otherInstallsInTarget: others,
    });
    await deps.installs.update(install.id, patch);
  }
}
