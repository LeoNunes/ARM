import type { FastifyInstance } from "fastify";
import type { ServerDeps } from "../server";
import { existsSync } from "node:fs";
import path from "node:path";
import { AppError } from "../util/errors";
import { runAutoUpdatePass } from "../engine/update-pass";
import { checkForUpdates } from "../engine/update-check";
import { checkForDrift } from "../engine/drift-check";
import { computeInstallStatus } from "../engine/status";
import type { Install } from "../state/schema";

export async function registerWorkingReposRoutes(app: FastifyInstance, deps: ServerDeps): Promise<void> {
  app.get("/api/working-repos", async () => deps.workingRepos.list());

  app.post<{ Body: { name: string; path: string } }>("/api/working-repos", async (req, reply) => {
    const body = req.body ?? ({} as { name: string; path: string });
    if (!body.name || !body.path) throw new AppError("bad_input", "name and path required");
    const absPath = path.resolve(body.path);
    if (!existsSync(path.join(absPath, ".git"))) {
      throw new AppError("bad_input", `not a git repository: ${absPath}`);
    }
    const r = await deps.workingRepos.add({ name: body.name, path: absPath, addedAt: new Date().toISOString() });
    return reply.code(201).send(r);
  });

  app.post<{ Params: { id: string } }>("/api/working-repos/:id/refresh", async (req, reply) => {
    const wr = await deps.workingRepos.get(req.params.id);
    if (!wr) return reply.code(404).send({ code: "working_repo_not_found" });

    await runAutoUpdatePass({
      installs: deps.installs,
      skillsRepos: deps.skillsRepos,
      workingRepos: deps.workingRepos,
      registries: deps.registries,
    });

    const allRepos = await deps.skillsRepos.list();
    const reposById = new Map(allRepos.map((r) => [r.id, r]));
    const installs = await deps.installs.listByWorkingRepo(wr.id);
    return Promise.all(
      installs.map(async (install: Install) => {
        const sr = reposById.get(install.sourceRepoId);
        if (!sr) return { ...install, status: "up-to-date" as const, availableSha: null };
        const updateResult = await checkForUpdates(install, sr);
        const driftResult = await checkForDrift(install, sr, wr.path);
        const status = computeInstallStatus(updateResult.hasUpdate, driftResult.isDrifted);
        return { ...install, status, availableSha: updateResult.availableSha };
      }),
    );
  });

  app.delete<{ Params: { id: string } }>("/api/working-repos/:id", async (req, reply) => {
    const r = await deps.workingRepos.get(req.params.id);
    if (!r) return reply.code(404).send({ code: "working_repo_not_found" });
    const orphanedInstalls = await deps.installs.listByWorkingRepo(r.id);
    for (const inst of orphanedInstalls) {
      await deps.installs.remove(inst.id);
    }
    await deps.workingRepos.remove(req.params.id);
    return reply.code(204).send();
  });
}
