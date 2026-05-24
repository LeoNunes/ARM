import type { FastifyInstance } from "fastify";
import type { ServerDeps } from "../server.js";
import { discoverArtifacts } from "../discovery/discover.js";
import { readFileAtSha, listFilesAtSha } from "../git/show.js";
import { lastSHATouching } from "../git/log.js";
import { AppError } from "../util/errors.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { checkForUpdates } from "../engine/update-check.js";

interface FileDiff {
  path: string;
  fromContent: string | null;
  toContent: string | null;
  changed: boolean;
}

interface DiffResponse {
  artifactKey: string;
  artifactName: string;
  fromSha: string;
  toSha: string;
  mode: "version-vs-version" | "installed-vs-latest" | "installed-vs-drifted";
  label: string;
  files: FileDiff[];
  primaryAction: "update" | "re-apply" | null;
  installId: string | null;
}

async function safeReadAtSha(clonePath: string, sha: string, filePath: string): Promise<string | null> {
  try {
    return await readFileAtSha(clonePath, sha, filePath);
  } catch {
    return null;
  }
}

async function safeReadFile(absPath: string): Promise<string | null> {
  try {
    return await readFile(absPath, "utf8");
  } catch {
    return null;
  }
}

export async function registerDiffRoutes(app: FastifyInstance, deps: ServerDeps): Promise<void> {
  app.get<{
    Querystring: {
      mode: string;
      installId?: string;
      artifactKey?: string;
      fromSha?: string;
      toSha?: string;
    };
  }>("/api/diff", async (req, reply) => {
    const { mode, installId, fromSha, toSha } = req.query;
    const artifactKeyParam = req.query.artifactKey ? decodeURIComponent(req.query.artifactKey) : undefined;

    if (mode === "version-vs-version") {
      if (!artifactKeyParam || !fromSha || !toSha) {
        throw new AppError("bad_input", "mode=version-vs-version requires artifactKey, fromSha, toSha");
      }
      const sources = await deps.skillsRepos.list();
      const allArtifacts = (await Promise.all(sources.map((s) => discoverArtifacts(s, deps.registries.types)))).flat();
      const artifact = allArtifacts.find((a) => a.artifactKey === artifactKeyParam);
      if (!artifact) return reply.code(404).send({ code: "artifact_not_found" });
      const repo = await deps.skillsRepos.get(artifact.sourceRepoId);
      if (!repo) return reply.code(404).send({ code: "skills_repo_not_found" });

      // Use artifact.files directly since DiscoveredArtifact has files[] with all paths
      const filesFrom = await listFilesAtSha(repo.localClonePath, fromSha, artifact.rootRelativePath);
      const filesTo = await listFilesAtSha(repo.localClonePath, toSha, artifact.rootRelativePath);
      const allPaths = [...new Set([...filesFrom, ...filesTo])];

      const files: FileDiff[] = await Promise.all(
        allPaths.map(async (p) => {
          const fc = await safeReadAtSha(repo.localClonePath, fromSha, p);
          const tc = await safeReadAtSha(repo.localClonePath, toSha, p);
          return { path: p, fromContent: fc, toContent: tc, changed: fc !== tc };
        }),
      );

      return {
        artifactKey: artifact.artifactKey,
        artifactName: artifact.name,
        fromSha,
        toSha,
        mode: "version-vs-version",
        label: `${fromSha.slice(0, 7)} → ${toSha.slice(0, 7)}`,
        files,
        primaryAction: null,
        installId: null,
      } as DiffResponse;
    }

    if (mode === "installed-vs-latest") {
      if (!installId) throw new AppError("bad_input", "mode=installed-vs-latest requires installId");
      const install = await deps.installs.get(installId);
      if (!install) return reply.code(404).send({ code: "install_not_found" });
      const sr = await deps.skillsRepos.get(install.sourceRepoId);
      if (!sr) return reply.code(404).send({ code: "skills_repo_not_found" });

      const updateResult = await checkForUpdates(install, sr);
      const latestSha =
        updateResult.availableSha ??
        (await lastSHATouching(sr.localClonePath, sr.branch, install.installedFiles.map((f) => f.sourcePath))) ??
        install.installedCommitSha;

      const sources = await deps.skillsRepos.list();
      const allArtifacts = (await Promise.all(sources.map((s) => discoverArtifacts(s, deps.registries.types)))).flat();
      const artifact = allArtifacts.find((a) => a.artifactKey === install.artifactKey);

      // Union of installed paths and paths in the latest commit (catches newly added files)
      const installedPaths = install.installedFiles.map((f) => f.sourcePath);
      const latestPaths = artifact
        ? await listFilesAtSha(sr.localClonePath, latestSha, artifact.rootRelativePath)
        : [];
      const allPaths = [...new Set([...installedPaths, ...latestPaths])];

      const files: FileDiff[] = await Promise.all(
        allPaths.map(async (p) => {
          const fc = await safeReadAtSha(sr.localClonePath, install.installedCommitSha, p);
          const tc = await safeReadAtSha(sr.localClonePath, latestSha, p);
          return { path: p, fromContent: fc, toContent: tc, changed: fc !== tc };
        }),
      );

      return {
        artifactKey: install.artifactKey,
        artifactName: artifact?.name ?? install.artifactKey.split(":").pop() ?? install.artifactKey,
        fromSha: install.installedCommitSha,
        toSha: latestSha,
        mode: "installed-vs-latest",
        label: "installed vs latest",
        files,
        primaryAction: updateResult.hasUpdate ? "update" : null,
        installId,
      } as DiffResponse;
    }

    if (mode === "installed-vs-drifted") {
      if (!installId) throw new AppError("bad_input", "mode=installed-vs-drifted requires installId");
      const install = await deps.installs.get(installId);
      if (!install) return reply.code(404).send({ code: "install_not_found" });
      if (install.target.type !== "working-repo") {
        throw new AppError("bad_input", "installed-vs-drifted only supported for working-repo targets");
      }
      const sr = await deps.skillsRepos.get(install.sourceRepoId);
      if (!sr) return reply.code(404).send({ code: "skills_repo_not_found" });
      const wr = await deps.workingRepos.get(install.target.workingRepoId);
      if (!wr) return reply.code(404).send({ code: "working_repo_not_found" });

      const files: FileDiff[] = await Promise.all(
        install.installedFiles.map(async (f) => {
          const fc = await safeReadAtSha(sr.localClonePath, install.installedCommitSha, f.sourcePath);
          const tc = await safeReadFile(path.join(wr.path, f.targetPath));
          return { path: f.targetPath, fromContent: fc, toContent: tc, changed: fc !== tc };
        }),
      );

      const sources = await deps.skillsRepos.list();
      const allArtifacts = (await Promise.all(sources.map((s) => discoverArtifacts(s, deps.registries.types)))).flat();
      const artifact = allArtifacts.find((a) => a.artifactKey === install.artifactKey);

      return {
        artifactKey: install.artifactKey,
        artifactName: artifact?.name ?? install.artifactKey.split(":").pop() ?? install.artifactKey,
        fromSha: install.installedCommitSha,
        toSha: "working-repo",
        mode: "installed-vs-drifted",
        label: "installed vs current file",
        files,
        primaryAction: "re-apply",
        installId,
      } as DiffResponse;
    }

    throw new AppError("bad_input", "mode must be version-vs-version, installed-vs-latest, or installed-vs-drifted");
  });
}
