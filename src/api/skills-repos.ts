import type { FastifyInstance } from "fastify";
import type { ServerDeps } from '../server';
import { cloneIntoCache, removeClone } from '../git/clone';
import { GitClient } from '../git/client';
import { newId } from '../util/ids';
import { AppError } from '../util/errors';
import { runAutoUpdatePass } from '../engine/update-pass';

interface RegisterBody {
  name: string;
  gitUrl: string;
  branch?: string;
  artifactPaths?: Partial<Record<"skills", string[]>>;
  presetId?: string | null;
}

export async function registerSkillsReposRoutes(app: FastifyInstance, deps: ServerDeps): Promise<void> {
  app.get("/api/skills-repos", async () => deps.skillsRepos.list());

  app.get<{ Params: { id: string } }>("/api/skills-repos/:id", async (req, reply) => {
    const r = await deps.skillsRepos.get(req.params.id);
    if (!r) return reply.code(404).send({ code: "skills_repo_not_found" });
    return r;
  });

  app.post<{ Body: RegisterBody }>("/api/skills-repos", async (req, reply) => {
    const { name, gitUrl, branch = "main", artifactPaths = {}, presetId = null } = req.body ?? ({} as RegisterBody);
    if (!name || !gitUrl) throw new AppError("bad_input", "name and gitUrl required");
    const tempId = newId();
    const localClonePath = await cloneIntoCache({ gitUrl, branch, cacheDir: deps.cacheDir, repoId: tempId });
    let created;
    try {
      created = await deps.skillsRepos.add({
        name, gitUrl, branch, artifactPaths, presetId, localClonePath,
        lastFetchedAt: new Date().toISOString(),
      });
      // Rename clone dir to match store-assigned id if different
      if (created.id !== tempId) {
        const { rename } = await import("node:fs/promises");
        const pathMod = await import("node:path");
        const newPath = pathMod.join(deps.cacheDir, created.id);
        await rename(localClonePath, newPath);
        await deps.skillsRepos.update(created.id, { localClonePath: newPath });
        created.localClonePath = newPath;
      }
    } catch (err) {
      await removeClone(localClonePath).catch(() => {});
      throw err;
    }
    return reply.code(201).send(created);
  });

  app.delete<{ Params: { id: string } }>("/api/skills-repos/:id", async (req, reply) => {
    const r = await deps.skillsRepos.get(req.params.id);
    if (!r) return reply.code(404).send({ code: "skills_repo_not_found" });
    await removeClone(r.localClonePath);
    await deps.skillsRepos.remove(req.params.id);
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>("/api/skills-repos/:id/refresh", async (req, reply) => {
    const r = await deps.skillsRepos.get(req.params.id);
    if (!r) return reply.code(404).send({ code: "skills_repo_not_found" });
    await new GitClient().fetchAndReset(r.localClonePath, r.branch);
    const updated = await deps.skillsRepos.update(r.id, { lastFetchedAt: new Date().toISOString() });
    runAutoUpdatePass({
      installs: deps.installs,
      skillsRepos: deps.skillsRepos,
      workingRepos: deps.workingRepos,
      registries: deps.registries,
    }).catch(() => {});
    return updated;
  });
}
