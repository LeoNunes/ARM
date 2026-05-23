import type { FastifyInstance } from "fastify";
import type { ServerDeps } from "../server";
import { installArtifact } from "../engine/install";
import { uninstallArtifact } from "../engine/uninstall";
import { applyUpdate } from "../engine/apply-update";
import { checkForUpdates } from "../engine/update-check";
import { checkForDrift } from "../engine/drift-check";
import { computeInstallStatus } from "../engine/status";
import { discoverArtifacts } from "../discovery/discover";
import { AppError } from "../util/errors";
import type { AgentId, Install, InstallTarget } from "../state/schema";

interface CreateBody {
  artifactKey: string;
  target: InstallTarget;
  agent?: AgentId;
  sha?: string;
  autoUpdate?: boolean;
}

interface PatchBody {
  autoUpdate?: boolean;
}

async function computeStatusForInstalls(
  installs: Install[],
  deps: ServerDeps,
  workingRepoPath: string,
) {
  const allRepos = await deps.skillsRepos.list();
  const reposById = new Map(allRepos.map((r) => [r.id, r]));
  return Promise.all(
    installs.map(async (install) => {
      const sr = reposById.get(install.sourceRepoId);
      if (!sr) return { ...install, status: "up-to-date" as const, availableSha: null };
      const updateResult = await checkForUpdates(install, sr);
      const driftResult = await checkForDrift(install, sr, workingRepoPath);
      const status = computeInstallStatus(updateResult.hasUpdate, driftResult.isDrifted);
      return { ...install, status, availableSha: updateResult.availableSha };
    }),
  );
}

export async function registerInstallsRoutes(app: FastifyInstance, deps: ServerDeps): Promise<void> {
  app.get<{ Params: { id: string } }>("/api/working-repos/:id/installs", async (req, reply) => {
    const wr = await deps.workingRepos.get(req.params.id);
    if (!wr) return reply.code(404).send({ code: "working_repo_not_found" });
    const installs = await deps.installs.listByWorkingRepo(wr.id);
    return computeStatusForInstalls(installs, deps, wr.path);
  });

  app.post<{ Body: CreateBody }>("/api/installs", async (req, reply) => {
    const body = req.body ?? ({} as CreateBody);
    if (!body.artifactKey || !body.target) throw new AppError("bad_input", "artifactKey and target required");
    const settings = await deps.settings.read();
    const agentId = body.agent ?? settings.favoriteAgent;
    let agent;
    try {
      agent = deps.registries.agents.get(agentId);
    } catch {
      throw new AppError("bad_input", `unknown agent: ${agentId}`);
    }

    const sources = await deps.skillsRepos.list();
    const [sourceRepoId] = body.artifactKey.split(":", 1);
    const skillsRepo = sources.find((s) => s.id === sourceRepoId);
    if (!skillsRepo) throw new AppError("skills_repo_not_found", `unknown source: ${sourceRepoId}`);

    const allArtifacts = await discoverArtifacts(skillsRepo, deps.registries.types);
    const artifact = allArtifacts.find((a) => a.artifactKey === body.artifactKey);
    if (!artifact) throw new AppError("artifact_not_found", body.artifactKey);

    let workingRepo;
    let existing;
    if (body.target.type === "working-repo") {
      workingRepo = await deps.workingRepos.get(body.target.workingRepoId);
      if (!workingRepo) throw new AppError("working_repo_not_found", body.target.workingRepoId);
      existing = await deps.installs.findExisting(body.artifactKey, body.target, agentId);
      if (existing) throw new AppError("already_installed", `${body.artifactKey} already installed in ${workingRepo.name}`);
    } else {
      existing = await deps.installs.findExisting(body.artifactKey, body.target, agentId);
      if (existing) throw new AppError("already_installed", `${body.artifactKey} already installed globally for ${agentId}`);
    }

    const targetInstalls = workingRepo ? await deps.installs.listByWorkingRepo(workingRepo.id) : [];
    const sha = body.sha ?? artifact.lastTouchedSha;
    if (!sha) throw new AppError("bad_input", "could not resolve SHA for artifact");

    const record = await installArtifact({
      artifact, skillsRepo, target: body.target, workingRepo, agent, sha,
      autoUpdate: body.autoUpdate ?? false,
      existingInstallsInTarget: targetInstalls,
    });
    const persisted = await deps.installs.add(record);
    return reply.code(201).send(persisted);
  });

  app.patch<{ Params: { id: string }; Body: PatchBody }>("/api/installs/:id", async (req, reply) => {
    const install = await deps.installs.get(req.params.id);
    if (!install) return reply.code(404).send({ code: "install_not_found" });
    const body = req.body ?? ({} as PatchBody);
    if (typeof body.autoUpdate !== "boolean") {
      throw new AppError("bad_input", "autoUpdate (boolean) required");
    }
    const updated = await deps.installs.update(install.id, { autoUpdate: body.autoUpdate });
    return updated;
  });

  app.post<{ Params: { id: string } }>("/api/installs/:id/update", async (req, reply) => {
    const install = await deps.installs.get(req.params.id);
    if (!install) return reply.code(404).send({ code: "install_not_found" });
    if (install.target.type !== "working-repo") {
      throw new AppError("bad_input", "update only supported for working-repo targets");
    }
    const sr = await deps.skillsRepos.get(install.sourceRepoId);
    if (!sr) throw new AppError("skills_repo_not_found", install.sourceRepoId);
    const wr = await deps.workingRepos.get(install.target.workingRepoId);
    if (!wr) throw new AppError("working_repo_not_found", install.target.workingRepoId);
    const updateResult = await checkForUpdates(install, sr);
    if (!updateResult.hasUpdate || !updateResult.availableSha) {
      throw new AppError("bad_input", "no update available for this install");
    }
    const agent = deps.registries.agents.get(install.agent);
    const others = (await deps.installs.listByWorkingRepo(wr.id)).filter((i) => i.id !== install.id);
    const patch = await applyUpdate({
      install, skillsRepo: sr, workingRepo: wr,
      newSha: updateResult.availableSha, agent,
      otherInstallsInTarget: others,
    });
    const updated = await deps.installs.update(install.id, patch);
    return updated;
  });

  app.post<{ Params: { id: string } }>("/api/installs/:id/reapply", async (req, reply) => {
    const install = await deps.installs.get(req.params.id);
    if (!install) return reply.code(404).send({ code: "install_not_found" });
    if (install.target.type !== "working-repo") {
      throw new AppError("bad_input", "reapply only supported for working-repo targets");
    }
    const sr = await deps.skillsRepos.get(install.sourceRepoId);
    if (!sr) throw new AppError("skills_repo_not_found", install.sourceRepoId);
    const wr = await deps.workingRepos.get(install.target.workingRepoId);
    if (!wr) throw new AppError("working_repo_not_found", install.target.workingRepoId);
    const agent = deps.registries.agents.get(install.agent);
    const others = (await deps.installs.listByWorkingRepo(wr.id)).filter((i) => i.id !== install.id);
    const patch = await applyUpdate({
      install, skillsRepo: sr, workingRepo: wr,
      newSha: install.installedCommitSha, agent,
      otherInstallsInTarget: others,
    });
    const updated = await deps.installs.update(install.id, patch);
    return updated;
  });

  app.delete<{ Params: { id: string } }>("/api/installs/:id", async (req, reply) => {
    const install = await deps.installs.get(req.params.id);
    if (!install) return reply.code(404).send({ code: "install_not_found" });
    let workingRepo;
    let remaining: Awaited<ReturnType<typeof deps.installs.list>> = [];
    if (install.target.type === "working-repo") {
      workingRepo = await deps.workingRepos.get(install.target.workingRepoId);
      remaining = (await deps.installs.listByWorkingRepo(install.target.workingRepoId)).filter(
        (i) => i.id !== install.id,
      );
    }
    try {
      await uninstallArtifact({ install, workingRepo, remainingInstallsInTarget: remaining });
    } finally {
      await deps.installs.remove(install.id);
    }
    return reply.code(204).send();
  });
}
