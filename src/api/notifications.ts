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

    for (const source of sources) {
      const artifacts = await discoverArtifacts(source, deps.registries.types);
      const currentKeys = artifacts.map((a) => a.artifactKey);
      const { snapshot, wasInitialized } = await deps.snapshots.getSnapshotOrInit(
        source.id,
        currentKeys,
      );
      if (wasInitialized) continue; // first time for this repo — all "known"

      for (const artifact of artifacts) {
        if (snapshot.has(artifact.artifactKey)) continue;
        const sha = artifact.lastTouchedSha ?? "unknown";
        const key = `newArtifact:${source.id}:${artifact.artifactKey}:${sha}`;
        if (dismissedSet.has(key)) continue;
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

    return { newArtifacts };
  });

  app.post<{ Body: DismissBody }>("/api/notifications/dismiss", async (req, reply) => {
    const { key } = req.body ?? ({} as DismissBody);
    if (!key || typeof key !== "string") throw new AppError("bad_input", "key required");
    await deps.dismissed.dismiss(key);
    // key = "newArtifact:<sourceRepoId>:<artifactKey>:<sha>"
    // artifactKey itself contains colons (sourceRepoId:relPath)
    // Parse: strip "newArtifact:<sourceRepoId>:" prefix, then everything up to the last colon is the artifactKey
    const parts = key.split(":");
    if (parts[0] === "newArtifact" && parts.length >= 4) {
      const sourceRepoId = parts[1]!;
      const withoutPrefix = key.slice("newArtifact:".length + sourceRepoId.length + 1);
      const lastColon = withoutPrefix.lastIndexOf(":");
      const artifactKey = lastColon > 0 ? withoutPrefix.slice(0, lastColon) : withoutPrefix;
      await deps.snapshots.addToSnapshot(sourceRepoId, [artifactKey]);
    }
    return reply.code(204).send();
  });
}
