import type { FastifyInstance } from "fastify";
import type { ServerDeps } from "../server.ts";
import { existsSync } from "node:fs";
import path from "node:path";
import { AppError } from "../util/errors.ts";

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

  app.delete<{ Params: { id: string } }>("/api/working-repos/:id", async (req, reply) => {
    const r = await deps.workingRepos.get(req.params.id);
    if (!r) return reply.code(404).send({ code: "working_repo_not_found" });
    await deps.workingRepos.remove(req.params.id);
    return reply.code(204).send();
  });
}
