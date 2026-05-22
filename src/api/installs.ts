import type { FastifyInstance } from "fastify";
import type { ServerDeps } from '../server';
import { installArtifact } from '../engine/install';
import { uninstallArtifact } from '../engine/uninstall';
import { discoverArtifacts } from '../discovery/discover';
import { AppError } from '../util/errors';
import type { AgentId, InstallTarget } from '../state/schema';

interface CreateBody {
  artifactKey: string;
  target: InstallTarget;
  agent?: AgentId;
  sha?: string;
  autoUpdate?: boolean;
}

export async function registerInstallsRoutes(app: FastifyInstance, deps: ServerDeps): Promise<void> {
  app.get<{ Params: { id: string } }>("/api/working-repos/:id/installs", async (req, reply) => {
    const wr = await deps.workingRepos.get(req.params.id);
    if (!wr) return reply.code(404).send({ code: "working_repo_not_found" });
    return deps.installs.listByWorkingRepo(wr.id);
  });

  app.post<{ Body: CreateBody }>("/api/installs", async (req, reply) => {
    const body = req.body ?? ({} as CreateBody);
    if (!body.artifactKey || !body.target) throw new AppError("bad_input", "artifactKey and target required");
    const settings = await deps.settings.read();
    const agentId = body.agent ?? settings.favoriteAgent;
    const agent = deps.registries.agents.get(agentId);

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

  app.delete<{ Params: { id: string } }>("/api/installs/:id", async (req, reply) => {
    const install = await deps.installs.get(req.params.id);
    if (!install) return reply.code(404).send({ code: "artifact_not_found" });
    let workingRepo;
    let remaining: Awaited<ReturnType<typeof deps.installs.list>> = [];
    if (install.target.type === "working-repo") {
      workingRepo = await deps.workingRepos.get(install.target.workingRepoId);
      remaining = (await deps.installs.listByWorkingRepo(install.target.workingRepoId)).filter((i) => i.id !== install.id);
    }
    await uninstallArtifact({ install, workingRepo, remainingInstallsInTarget: remaining });
    await deps.installs.remove(install.id);
    return reply.code(204).send();
  });
}
