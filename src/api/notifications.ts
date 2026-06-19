import type { FastifyInstance } from "fastify";
import type { ServerDeps } from "../server.js";
import { discoverArtifacts } from "../discovery/discover.js";
import { AppError } from "../util/errors.js";

interface DismissBody {
  key: string;
}

export async function registerNotificationsRoutes(
  app: FastifyInstance,
  deps: ServerDeps,
): Promise<void> {
  app.get("/api/notifications", async () => {
    const sources = await deps.skillsRepos.list();
    const dismissedSet = await deps.dismissed.listDismissed();
    const newArtifacts: Array<{
      kind: "new-artifact";
      key: string;
      artifactKey: string;
      sourceRepoId: string;
      sourceName: string;
      sha: string;
      name: string;
      description: string | null;
    }> = [];
    const updatedArtifacts: Array<{
      kind: "updated-artifact";
      key: string;
      artifactKey: string;
      sourceRepoId: string;
      sourceName: string;
      fromSha: string;
      toSha: string;
      name: string;
      description: string | null;
    }> = [];

    for (const source of sources) {
      const artifacts = await discoverArtifacts(source, deps.registries.types);
      const currentKeys = artifacts.map((a) => a.artifactKey);
      const { snapshot, wasInitialized } = await deps.snapshots.getSnapshotOrInit(
        source.id,
        currentKeys,
      );

      for (const artifact of artifacts) {
        // new-artifact check
        if (!wasInitialized && !snapshot.has(artifact.artifactKey)) {
          const sha = artifact.lastTouchedSha ?? "unknown";
          const key = `newArtifact:${source.id}:${artifact.artifactKey}:${sha}`;
          if (!dismissedSet.has(key)) {
            newArtifacts.push({
              kind: "new-artifact",
              key,
              artifactKey: artifact.artifactKey,
              sourceRepoId: source.id,
              sourceName: source.name,
              sha,
              name: artifact.name,
              description: artifact.description,
            });
          }
        }

        // updated-artifact check (independent of wasInitialized)
        const currentSha = artifact.lastTouchedSha;
        if (!currentSha) continue;
        const baseline = await deps.shaBaseline.getBaseline(source.id, artifact.artifactKey);
        if (baseline === null) {
          await deps.shaBaseline.setBaseline(source.id, artifact.artifactKey, currentSha);
          continue;
        }
        if (currentSha === baseline) continue;
        const updKey = `updatedArtifact:${source.id}:${artifact.artifactKey}:${currentSha}`;
        if (dismissedSet.has(updKey)) continue;
        updatedArtifacts.push({
          kind: "updated-artifact",
          key: updKey,
          artifactKey: artifact.artifactKey,
          sourceRepoId: source.id,
          sourceName: source.name,
          fromSha: baseline,
          toSha: currentSha,
          name: artifact.name,
          description: artifact.description,
        });
      }
    }

    return { newArtifacts, updatedArtifacts };
  });

  app.post<{ Body: DismissBody }>("/api/notifications/dismiss", async (req, reply) => {
    const { key } = req.body ?? ({} as DismissBody);
    if (!key || typeof key !== "string") throw new AppError("bad_input", "key required");
    await deps.dismissed.dismiss(key);
    const parts = key.split(":");
    if (parts[0] === "newArtifact" && parts.length >= 4) {
      const sourceRepoId = parts[1]!;
      const withoutPrefix = key.slice("newArtifact:".length + sourceRepoId.length + 1);
      const lastColon = withoutPrefix.lastIndexOf(":");
      const artifactKey = lastColon > 0 ? withoutPrefix.slice(0, lastColon) : withoutPrefix;
      await deps.snapshots.addToSnapshot(sourceRepoId, [artifactKey]);
    } else if (parts[0] === "updatedArtifact" && parts.length >= 4) {
      const sourceRepoId = parts[1]!;
      const withoutPrefix = key.slice("updatedArtifact:".length + sourceRepoId.length + 1);
      const lastColon = withoutPrefix.lastIndexOf(":");
      const toSha = lastColon > 0 ? withoutPrefix.slice(lastColon + 1) : "";
      const artifactKey = lastColon > 0 ? withoutPrefix.slice(0, lastColon) : withoutPrefix;
      await deps.shaBaseline.setBaseline(sourceRepoId, artifactKey, toSha);
    }
    return reply.code(204).send();
  });
}
