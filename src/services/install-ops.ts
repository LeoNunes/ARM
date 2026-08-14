import type { ServerDeps } from '../server';
import { installArtifact } from '../engine/install';
import { uninstallArtifact } from '../engine/uninstall';
import { applyUpdate } from '../engine/apply-update';
import { checkForUpdates } from '../engine/update-check';
import { checkForDrift } from '../engine/drift-check';
import { discoverArtifacts } from '../discovery/discover';
import { AppError } from '../util/errors';
import { artifactDisplayName } from '../util/artifact-key';
import type { AgentAdapter } from '../adapters/types';
import type { ActivityLogEntry, AgentId, Install, InstallTarget, SkillsRepo, WorkingRepo } from '../state/schema';

/**
 * Deps-aware orchestration for the install lifecycle, shared by the HTTP API
 * (`src/api/installs.ts`) and the MCP tools (`src/mcp/tools.ts`) so both
 * transports behave identically. Engine functions stay pure and take explicit
 * arguments; everything that reads stores or writes the activity log lives here.
 */

export interface CreateInstallParams {
  artifactKey: string;
  target: InstallTarget;
  agent?: AgentId;
  sha?: string;
  autoUpdate?: boolean;
}

/** Everything the mutating ops need after resolving an install id. */
interface InstallContext {
  install: Install;
  skillsRepo: SkillsRepo;
  workingRepo?: WorkingRepo;
  agent: AgentAdapter;
  /** Other installs sharing the same working repo, for exclude-block recompute. */
  others: Install[];
}

/**
 * Awaited so a caller that immediately reads the activity log sees the entry,
 * but never fatal: a failed log write must not fail the operation itself.
 */
async function logActivity(deps: ServerDeps, entry: Omit<ActivityLogEntry, "id">): Promise<void> {
  await deps.activityLog.add(entry).catch(() => {});
}

async function loadInstall(deps: ServerDeps, installId: string): Promise<Install> {
  const install = await deps.installs.get(installId);
  if (!install) throw new AppError("install_not_found", installId);
  return install;
}

async function resolveContext(deps: ServerDeps, install: Install): Promise<InstallContext> {
  const skillsRepo = await deps.skillsRepos.get(install.sourceRepoId);
  if (!skillsRepo) throw new AppError("skills_repo_not_found", install.sourceRepoId);
  const agent = deps.registries.agents.get(install.agent);

  if (install.target.type !== "working-repo") {
    return { install, skillsRepo, agent, others: [] };
  }
  const workingRepo = await deps.workingRepos.get(install.target.workingRepoId);
  if (!workingRepo) throw new AppError("working_repo_not_found", install.target.workingRepoId);
  const others = (await deps.installs.listByWorkingRepo(workingRepo.id)).filter((i) => i.id !== install.id);
  return { install, skillsRepo, workingRepo, agent, others };
}

/** Update and re-apply rewrite files in place, which only makes sense inside a working repo. */
function requireWorkingRepo(ctx: InstallContext, operation: string): WorkingRepo {
  if (!ctx.workingRepo) {
    throw new AppError("bad_input", `${operation} only supported for working-repo targets`);
  }
  return ctx.workingRepo;
}

/**
 * Refuses an operation that would silently discard the user's local edits.
 *
 * Callers that have already put the diff in front of a human — the browser UI —
 * pass `force`. Non-interactive callers such as the MCP tools get the refusal,
 * with the drifted paths and a pointer to the diff tool, and must opt in
 * explicitly on the retry.
 */
async function guardDrift(
  install: Install,
  skillsRepo: SkillsRepo,
  workingRepo: WorkingRepo,
  force: boolean | undefined,
): Promise<void> {
  if (force) return;
  const driftResult = await checkForDrift(install, skillsRepo, workingRepo.path);
  if (!driftResult.isDrifted) return;
  const driftedFiles = driftResult.driftedFiles.map((f) => f.targetPath);
  throw new AppError(
    "drift_detected",
    `${driftedFiles.length} file(s) in '${workingRepo.name}' differ from the installed version; proceeding would discard those edits`,
    {
      driftedFiles,
      hint: "Call get_install_diff to see the local edits, then retry with force: true to discard them.",
    },
  );
}

export async function createInstall(deps: ServerDeps, params: CreateInstallParams): Promise<Install> {
  const { artifactKey, target } = params;
  if (!artifactKey || !target) throw new AppError("bad_input", "artifactKey and target required");

  const settings = await deps.settings.read();
  const agentId = params.agent ?? settings.favoriteAgent;
  if (!agentId) {
    throw new AppError("agent_not_specified", "No agent specified and no favoriteAgent configured");
  }
  let agent;
  try {
    agent = deps.registries.agents.get(agentId);
  } catch {
    throw new AppError("bad_input", `unknown agent: ${agentId}`);
  }

  if (target.type === "working-repo" && !target.workingRepoId) {
    throw new AppError("bad_input", "workingRepoId required for working-repo target");
  }

  const sources = await deps.skillsRepos.list();
  const [sourceRepoId] = artifactKey.split(":", 1);
  const skillsRepo = sources.find((s) => s.id === sourceRepoId);
  // The caller named an artifact, not a repo: an unresolvable source prefix means
  // the key does not identify any artifact.
  if (!skillsRepo) throw new AppError("artifact_not_found", `${artifactKey} (unknown source: ${sourceRepoId})`);

  const allArtifacts = await discoverArtifacts(skillsRepo, deps.registries.types);
  const artifact = allArtifacts.find((a) => a.artifactKey === artifactKey);
  if (!artifact) throw new AppError("artifact_not_found", artifactKey);

  let workingRepo: WorkingRepo | undefined;
  if (target.type === "working-repo") {
    workingRepo = await deps.workingRepos.get(target.workingRepoId);
    if (!workingRepo) throw new AppError("working_repo_not_found", target.workingRepoId);
  }

  const existing = await deps.installs.findExisting(artifactKey, target, agentId);
  if (existing) {
    const where = workingRepo ? `in ${workingRepo.name}` : `globally for ${agentId}`;
    throw new AppError("already_installed", `${artifactKey} already installed ${where}`);
  }

  const targetInstalls = workingRepo ? await deps.installs.listByWorkingRepo(workingRepo.id) : [];
  const sha = params.sha ?? artifact.lastTouchedSha;
  if (!sha) throw new AppError("bad_input", "could not resolve SHA for artifact");

  const record = await installArtifact({
    artifact, skillsRepo, target, workingRepo, agent, sha,
    autoUpdate: params.autoUpdate ?? false,
    existingInstallsInTarget: targetInstalls,
  });
  const persisted = await deps.installs.add(record);

  const targetName = workingRepo ? `'${workingRepo.name}'` : `globally (${agentId})`;
  await logActivity(deps, {
    ts: new Date().toISOString(),
    category: "install",
    summary: `Installed '${artifact.name}' into ${targetName}`,
    artifactKey,
    workingRepoId: workingRepo?.id,
    sourceRepoId: skillsRepo.id,
  });

  return persisted;
}

export async function updateInstall(
  deps: ServerDeps,
  params: { installId: string; force?: boolean },
): Promise<{ install: Install; fromSha: string; toSha: string }> {
  const install = await loadInstall(deps, params.installId);
  const ctx = await resolveContext(deps, install);
  const workingRepo = requireWorkingRepo(ctx, "update");

  // Checked before the drift gate: with nothing to update to, nothing is at risk.
  const updateResult = await checkForUpdates(install, ctx.skillsRepo);
  if (!updateResult.hasUpdate || !updateResult.availableSha) {
    throw new AppError("no_update_available", "no update available for this install");
  }
  await guardDrift(install, ctx.skillsRepo, workingRepo, params.force);

  const patch = await applyUpdate({
    install, skillsRepo: ctx.skillsRepo, workingRepo,
    newSha: updateResult.availableSha, agent: ctx.agent,
    otherInstallsInTarget: ctx.others,
  });
  const updated = await deps.installs.update(install.id, patch);

  await logActivity(deps, {
    ts: new Date().toISOString(),
    category: "install",
    summary: `Updated '${artifactDisplayName(install.artifactKey)}' in '${workingRepo.name}'`,
    detail: `${install.installedCommitSha.slice(0, 7)} → ${updateResult.availableSha.slice(0, 7)}`,
    artifactKey: install.artifactKey,
    workingRepoId: workingRepo.id,
    sourceRepoId: install.sourceRepoId,
  });

  return { install: updated, fromSha: install.installedCommitSha, toSha: updateResult.availableSha };
}

export async function reapplyInstall(
  deps: ServerDeps,
  params: { installId: string; force?: boolean },
): Promise<{ install: Install }> {
  const install = await loadInstall(deps, params.installId);
  const ctx = await resolveContext(deps, install);
  const workingRepo = requireWorkingRepo(ctx, "reapply");
  // Re-applying a clean install just rewrites identical bytes, so the gate only
  // ever fires on the case that actually destroys something.
  await guardDrift(install, ctx.skillsRepo, workingRepo, params.force);

  const patch = await applyUpdate({
    install, skillsRepo: ctx.skillsRepo, workingRepo,
    newSha: install.installedCommitSha, agent: ctx.agent,
    otherInstallsInTarget: ctx.others,
  });
  const updated = await deps.installs.update(install.id, patch);

  await logActivity(deps, {
    ts: new Date().toISOString(),
    category: "re-apply",
    summary: `Re-applied '${artifactDisplayName(install.artifactKey)}' in '${workingRepo.name}'`,
    artifactKey: install.artifactKey,
    workingRepoId: workingRepo.id,
    sourceRepoId: install.sourceRepoId,
  });

  return { install: updated };
}

export async function removeInstall(
  deps: ServerDeps,
  params: { installId: string; force?: boolean },
): Promise<void> {
  const install = await loadInstall(deps, params.installId);

  let workingRepo: WorkingRepo | undefined;
  let remaining: Install[] = [];
  if (install.target.type === "working-repo") {
    workingRepo = await deps.workingRepos.get(install.target.workingRepoId);
    remaining = (await deps.installs.listByWorkingRepo(install.target.workingRepoId)).filter(
      (i) => i.id !== install.id,
    );
    if (workingRepo) {
      // A missing source repo leaves nothing to compare against, so the gate cannot
      // fire — an orphaned install stays removable.
      const skillsRepo = await deps.skillsRepos.get(install.sourceRepoId);
      if (skillsRepo) await guardDrift(install, skillsRepo, workingRepo, params.force);
    }
  }

  try {
    await uninstallArtifact({ install, workingRepo, remainingInstallsInTarget: remaining });
  } finally {
    await deps.installs.remove(install.id);
  }

  await logActivity(deps, {
    ts: new Date().toISOString(),
    category: "uninstall",
    summary: `Uninstalled '${artifactDisplayName(install.artifactKey)}' from ${workingRepo ? `'${workingRepo.name}'` : "global"}`,
    artifactKey: install.artifactKey,
    workingRepoId: install.target.type === "working-repo" ? install.target.workingRepoId : undefined,
    sourceRepoId: install.sourceRepoId,
  });
}
