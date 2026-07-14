import type { FastifyInstance } from "fastify";
import type { ServerDeps } from '../server';
import { cloneIntoCache, removeClone } from '../git/clone';
import { GitClient } from '../git/client';
import { newId } from '../util/ids';
import { AppError } from '../util/errors';
import { runAutoUpdatePass } from '../engine/update-pass';
import { discoverArtifacts } from '../discovery/discover';
import { artifactRootRelativePath, artifactDisplayName } from "../util/artifact-key";
import { purgePathState, purgeRepoState } from "../engine/purge";
import type { ArtifactTypeId, SkillsRepo } from "../state/schema";

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
      // Seed snapshot so existing artifacts don't appear as "new"
      const artifacts = await discoverArtifacts(created, deps.registries.types);
      await deps.snapshots.initSnapshot(created.id, artifacts.map((a) => a.artifactKey));
    } catch (err) {
      await removeClone(localClonePath).catch(() => {});
      throw err;
    }
    return reply.code(201).send(created);
  });

  app.patch<{
    Params: { id: string };
    Body: { name?: string; artifactPaths?: Partial<Record<ArtifactTypeId, string[]>> };
  }>("/api/skills-repos/:id", async (req, reply) => {
    const repo = await deps.skillsRepos.get(req.params.id);
    if (!repo) return reply.code(404).send({ code: "skills_repo_not_found" });

    const { name, artifactPaths } = req.body ?? {};
    if (name === undefined && artifactPaths === undefined) {
      throw new AppError("bad_input", "name or artifactPaths required");
    }

    // Diff paths per type.
    const removed: { type: ArtifactTypeId; path: string }[] = [];
    const added: { type: ArtifactTypeId; path: string }[] = [];
    if (artifactPaths) {
      const types = new Set<ArtifactTypeId>([
        ...Object.keys(repo.artifactPaths) as ArtifactTypeId[],
        ...Object.keys(artifactPaths) as ArtifactTypeId[],
      ]);
      for (const type of types) {
        const before = repo.artifactPaths[type] ?? [];
        const after = artifactPaths[type] ?? before; // omitted type = unchanged
        for (const p of before) if (!after.includes(p)) removed.push({ type, path: p });
        for (const p of after) if (!before.includes(p)) added.push({ type, path: p });
      }
    }

    // Guard removed paths.
    if (removed.length > 0) {
      const installs = await deps.installs.list();
      const mine = installs.filter((i) => i.sourceRepoId === repo.id);
      const blockers = removed
        .map(({ type, path }) => {
          const artifacts = mine
            .filter((i) => artifactRootRelativePath(i.artifactKey).startsWith(`${path}/`))
            .map((i) => ({ artifactKey: i.artifactKey, name: artifactDisplayName(i.artifactKey) }));
          return { type, path, artifacts };
        })
        .filter((b) => b.artifacts.length > 0);
      if (blockers.length > 0) {
        return reply.code(409).send({ code: "paths_in_use", blockers });
      }
    }

    // Build the patch. For artifactPaths, merge onto the existing object so
    // omitted types are preserved.
    const patch: { name?: string; artifactPaths?: SkillsRepo["artifactPaths"] } = {};
    if (name !== undefined) patch.name = name;
    let mergedPaths = repo.artifactPaths;
    if (artifactPaths) {
      mergedPaths = { ...repo.artifactPaths, ...artifactPaths };
      patch.artifactPaths = mergedPaths;
    }
    const updated = await deps.skillsRepos.update(repo.id, patch);

    // Seed added paths silently so they don't surface as new-artifact notifications.
    if (added.length > 0) {
      const artifacts = await discoverArtifacts(updated, deps.registries.types);
      const addedKeys = artifacts
        .filter((a) => added.some(({ path }) => a.rootRelativePath.startsWith(`${path}/`)))
        .map((a) => a.artifactKey);
      if (addedKeys.length > 0) await deps.snapshots.addToSnapshot(updated.id, addedKeys);
    }

    // Purge state for successfully-removed paths.
    for (const { path } of removed) {
      await purgePathState(deps, repo.id, path);
    }

    return updated;
  });

  app.delete<{ Params: { id: string } }>("/api/skills-repos/:id", async (req, reply) => {
    const r = await deps.skillsRepos.get(req.params.id);
    if (!r) return reply.code(404).send({ code: "skills_repo_not_found" });

    const installs = await deps.installs.list();
    const blockers = installs
      .filter((i) => i.sourceRepoId === r.id)
      .map((i) => ({ artifactKey: i.artifactKey, name: artifactDisplayName(i.artifactKey) }));
    if (blockers.length > 0) {
      return reply.code(409).send({ code: "repo_in_use", blockers });
    }

    await purgeRepoState(deps, r.id);
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
