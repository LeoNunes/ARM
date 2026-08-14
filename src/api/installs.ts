import type { FastifyInstance } from "fastify";
import type { ServerDeps } from "../server";
import { checkForUpdates } from "../engine/update-check";
import { checkForDrift } from "../engine/drift-check";
import { computeInstallStatus } from "../engine/status";
import { createInstall, updateInstall, reapplyInstall, removeInstall } from "../services/install-ops";
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
      try {
        const updateResult = await checkForUpdates(install, sr);
        const driftResult = await checkForDrift(install, sr, workingRepoPath);
        const status = computeInstallStatus(updateResult.hasUpdate, driftResult.isDrifted);
        return { ...install, status, availableSha: updateResult.availableSha };
      } catch {
        return { ...install, status: "up-to-date" as const, availableSha: null };
      }
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
    const persisted = await createInstall(deps, body);
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

  // The browser puts the drift diff in front of the user before they click, so the
  // human has already made the call: these routes opt past the drift gate that
  // protects non-interactive callers such as the MCP tools.
  app.post<{ Params: { id: string } }>("/api/installs/:id/update", async (req) => {
    const { install } = await updateInstall(deps, { installId: req.params.id, force: true });
    return install;
  });

  app.post<{ Params: { id: string } }>("/api/installs/:id/reapply", async (req) => {
    const { install } = await reapplyInstall(deps, { installId: req.params.id, force: true });
    return install;
  });

  app.get<{ Querystring: { artifactKey?: string } }>("/api/installs", async (req, reply) => {
    const rawKey = req.query.artifactKey;
    if (!rawKey) throw new AppError("bad_input", "artifactKey query param required");
    const decodedKey = decodeURIComponent(rawKey);

    const allInstalls = await deps.installs.list();
    const filtered = allInstalls.filter((i) => i.artifactKey === decodedKey);

    const allWorkingRepos = await deps.workingRepos.list();
    const wrById = new Map(allWorkingRepos.map((w) => [w.id, w]));
    const allSkillsRepos = await deps.skillsRepos.list();
    const srById = new Map(allSkillsRepos.map((s) => [s.id, s]));

    return Promise.all(
      filtered.map(async (install) => {
        const sr = srById.get(install.sourceRepoId);
        if (!sr) return { ...install, status: "up-to-date" as const, availableSha: null };
        try {
          const updateResult = await checkForUpdates(install, sr);
          if (install.target.type === "global") {
            const status = updateResult.hasUpdate ? "update-available" as const : "up-to-date" as const;
            return { ...install, status, availableSha: updateResult.availableSha };
          }
          const wr = wrById.get(install.target.workingRepoId);
          if (!wr) return { ...install, status: "up-to-date" as const, availableSha: null };
          const driftResult = await checkForDrift(install, sr, wr.path);
          const status = computeInstallStatus(updateResult.hasUpdate, driftResult.isDrifted);
          return { ...install, status, availableSha: updateResult.availableSha };
        } catch {
          return { ...install, status: "up-to-date" as const, availableSha: null };
        }
      }),
    );
  });

  app.delete<{ Params: { id: string } }>("/api/installs/:id", async (req, reply) => {
    await removeInstall(deps, { installId: req.params.id, force: true });
    return reply.code(204).send();
  });
}
