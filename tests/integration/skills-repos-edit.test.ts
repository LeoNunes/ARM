// tests/integration/skills-repos-edit.test.ts
import { describe, it, expect } from "vitest";
import { buildServer } from "../../src/server.ts";
import { SettingsStore } from "../../src/state/settings.ts";
import { SkillsRepoStore } from "../../src/state/skills-repos.ts";
import { WorkingRepoStore } from "../../src/state/working-repos.ts";
import { InstallsStore } from "../../src/state/installs.ts";
import { buildRegistries } from "../../src/adapters/index.ts";
import { ArtifactSnapshotsStore } from "../../src/state/artifact-snapshots.ts";
import { DismissedNotificationsStore } from "../../src/state/notifications.ts";
import { ActivityLogStore } from "../../src/state/activity-log.ts";
import { ArtifactShaBaselineStore } from "../../src/state/artifact-sha-baseline.ts";
import { FavoritesStore } from "../../src/state/favorites.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";
import { buildFixtureRepo } from "../helpers/build-fixture-repo.ts";

async function makeDeps() {
  const stateDir = await tmpDir("arm-edit-");
  const cacheDir = await tmpDir("arm-edit-cache-");
  return {
    stateDir, cacheDir,
    settings: new SettingsStore(stateDir),
    skillsRepos: new SkillsRepoStore(stateDir),
    workingRepos: new WorkingRepoStore(stateDir),
    installs: new InstallsStore(stateDir),
    registries: buildRegistries(),
    snapshots: new ArtifactSnapshotsStore(stateDir),
    dismissed: new DismissedNotificationsStore(stateDir),
    activityLog: new ActivityLogStore(stateDir),
    shaBaseline: new ArtifactShaBaselineStore(stateDir),
    favorites: new FavoritesStore(stateDir),
  };
}

async function register(app: Awaited<ReturnType<typeof buildServer>>, gitUrl: string, artifactPaths: Record<string, string[]>) {
  const res = await app.inject({
    method: "POST", url: "/api/skills-repos",
    payload: { name: "src", gitUrl, branch: "main", artifactPaths },
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

describe("PATCH /api/skills-repos/:id — rename", () => {
  it("changes the display name only", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const fx = await buildFixtureRepo([{ message: "init", files: { "ai/skills/foo/SKILL.md": "# Foo\n" } }]);
    const repo = await register(app, fx.fileUrl, { skills: ["ai/skills"] });

    const res = await app.inject({ method: "PATCH", url: `/api/skills-repos/${repo.id}`, payload: { name: "renamed" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("renamed");
    // artifactPaths untouched by a rename-only patch.
    expect(res.json().artifactPaths).toEqual({ skills: ["ai/skills"] });
  });

  it("404s for an unknown repo", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const res = await app.inject({ method: "PATCH", url: "/api/skills-repos/nope", payload: { name: "x" } });
    expect(res.statusCode).toBe(404);
  });

  it("400s when the body has neither name nor artifactPaths", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const fx = await buildFixtureRepo([{ message: "init", files: { "ai/skills/foo/SKILL.md": "# Foo\n" } }]);
    const repo = await register(app, fx.fileUrl, { skills: ["ai/skills"] });
    const res = await app.inject({ method: "PATCH", url: `/api/skills-repos/${repo.id}`, payload: {} });
    expect(res.statusCode).toBe(400);
  });
});

describe("PATCH /api/skills-repos/:id — add path", () => {
  it("makes new artifacts discoverable and seeds them silently", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const fx = await buildFixtureRepo([{ message: "init", files: {
      "ai/skills/foo/SKILL.md": "# Foo\n",
      "extra/skills/bar/SKILL.md": "# Bar\n",
    } }]);
    const repo = await register(app, fx.fileUrl, { skills: ["ai/skills"] });

    const res = await app.inject({
      method: "PATCH", url: `/api/skills-repos/${repo.id}`,
      payload: { artifactPaths: { skills: ["ai/skills", "extra/skills"] } },
    });
    expect(res.statusCode).toBe(200);

    const arts = await app.inject({ method: "GET", url: `/api/artifacts?sourceRepoId=${repo.id}` });
    expect(arts.json().map((a: { name: string }) => a.name).sort()).toEqual(["bar", "foo"]);

    // Seeded silently: no new-artifact notifications for bar.
    const notes = await app.inject({ method: "GET", url: "/api/notifications" });
    expect(notes.json().newArtifacts).toHaveLength(0);
  });
});

describe("PATCH /api/skills-repos/:id — remove path guard", () => {
  it("removes an unused path", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const fx = await buildFixtureRepo([{ message: "init", files: {
      "ai/skills/foo/SKILL.md": "# Foo\n",
      "extra/skills/bar/SKILL.md": "# Bar\n",
    } }]);
    const repo = await register(app, fx.fileUrl, { skills: ["ai/skills", "extra/skills"] });

    const res = await app.inject({
      method: "PATCH", url: `/api/skills-repos/${repo.id}`,
      payload: { artifactPaths: { skills: ["ai/skills"] } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().artifactPaths.skills).toEqual(["ai/skills"]);
  });

  it("blocks removing a path with an installed artifact and lists the blocker", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const fx = await buildFixtureRepo([{ message: "init", files: { "ai/skills/foo/SKILL.md": "# Foo\n" } }]);
    const repo = await register(app, fx.fileUrl, { skills: ["ai/skills"] });

    // Seed a blocking install directly (global target keeps the test independent of the install engine).
    await deps.installs.add({
      artifactKey: `${repo.id}:ai/skills/foo`,
      sourceRepoId: repo.id,
      target: { type: "global" },
      agent: "claude-code",
      artifactType: "skills",
      installedCommitSha: "sha1",
      autoUpdate: false,
      installedFiles: [],
      installedAt: new Date().toISOString(),
    });

    const res = await app.inject({
      method: "PATCH", url: `/api/skills-repos/${repo.id}`,
      payload: { artifactPaths: { skills: [] } },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.code).toBe("paths_in_use");
    expect(body.blockers).toEqual([
      { type: "skills", path: "ai/skills", artifacts: [{ artifactKey: `${repo.id}:ai/skills/foo`, name: "foo" }] },
    ]);

    // Nothing changed.
    const after = await app.inject({ method: "GET", url: `/api/skills-repos/${repo.id}` });
    expect(after.json().artifactPaths.skills).toEqual(["ai/skills"]);
  });
});

describe("DELETE /api/skills-repos/:id — guard + purge", () => {
  it("blocks removal when an artifact is installed and lists the blocker", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const fx = await buildFixtureRepo([{ message: "init", files: { "ai/skills/foo/SKILL.md": "# Foo\n" } }]);
    const repo = await register(app, fx.fileUrl, { skills: ["ai/skills"] });
    await deps.installs.add({
      artifactKey: `${repo.id}:ai/skills/foo`, sourceRepoId: repo.id,
      target: { type: "working-repo", workingRepoId: "wr1" }, agent: "claude-code",
      artifactType: "skills", installedCommitSha: "sha1", autoUpdate: false,
      installedFiles: [], installedAt: new Date().toISOString(),
    });

    const res = await app.inject({ method: "DELETE", url: `/api/skills-repos/${repo.id}` });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      code: "repo_in_use",
      blockers: [{ artifactKey: `${repo.id}:ai/skills/foo`, name: "foo" }],
    });
    // Repo still present.
    const list = await app.inject({ method: "GET", url: "/api/skills-repos" });
    expect(list.json()).toHaveLength(1);
  });

  it("removes the repo and purges its state when nothing is installed", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const fx = await buildFixtureRepo([{ message: "init", files: { "ai/skills/foo/SKILL.md": "# Foo\n" } }]);
    const repo = await register(app, fx.fileUrl, { skills: ["ai/skills"] });
    await deps.favorites.setFavorite(`${repo.id}:ai/skills/foo`, true);

    const res = await app.inject({ method: "DELETE", url: `/api/skills-repos/${repo.id}` });
    expect(res.statusCode).toBe(204);
    const list = await app.inject({ method: "GET", url: "/api/skills-repos" });
    expect(list.json()).toHaveLength(0);
    expect((await deps.favorites.listFavorites()).size).toBe(0);
    expect((await deps.snapshots.getSnapshot(repo.id)).size).toBe(0);
  });
});
