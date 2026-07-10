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
import { simpleGit } from "simple-git";

async function makeDeps() {
  const stateDir = await tmpDir("arm-api-");
  const cacheDir = await tmpDir("arm-cache-");
  return {
    stateDir,
    cacheDir,
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

describe("API /settings", () => {
  it("GET returns defaults", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const res = await app.inject({ method: "GET", url: "/api/settings" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ favoriteAgent: "claude-code", mcpPort: 7747 });
  });

  it("PATCH updates favoriteAgent", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const res = await app.inject({
      method: "PATCH",
      url: "/api/settings",
      payload: { favoriteAgent: "cursor" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().favoriteAgent).toBe("cursor");
  });
});

describe("API /skills-repos", () => {
  it("registers a source by cloning + lists + removes", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const fx = await buildFixtureRepo([
      { message: "init", files: { "ai/skills/foo/SKILL.md": "# Foo\n" } },
    ]);
    const created = await app.inject({
      method: "POST", url: "/api/skills-repos",
      payload: {
        name: "test-src",
        gitUrl: fx.fileUrl,
        branch: "main",
        artifactPaths: { skills: ["ai/skills"] },
      },
    });
    expect(created.statusCode).toBe(201);
    const repo = created.json();
    expect(repo.id).toMatch(/[0-9a-f-]{36}/);

    const list = await app.inject({ method: "GET", url: "/api/skills-repos" });
    expect(list.json()).toHaveLength(1);

    const removed = await app.inject({ method: "DELETE", url: `/api/skills-repos/${repo.id}` });
    expect(removed.statusCode).toBe(204);
    const list2 = await app.inject({ method: "GET", url: "/api/skills-repos" });
    expect(list2.json()).toHaveLength(0);
  });
});

describe("API /working-repos", () => {
  it("registers a working repo, refusing non-git paths", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const wrPath = await tmpDir("arm-wr-");
    await simpleGit(wrPath).init();

    const ok = await app.inject({
      method: "POST", url: "/api/working-repos",
      payload: { name: "alpha", path: wrPath },
    });
    expect(ok.statusCode).toBe(201);

    const nonGit = await tmpDir("arm-not-git-");
    const bad = await app.inject({
      method: "POST", url: "/api/working-repos",
      payload: { name: "x", path: nonGit },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe("bad_input");

    const list = await app.inject({ method: "GET", url: "/api/working-repos" });
    expect(list.json()).toHaveLength(1);
  });
});

describe("API /artifacts", () => {
  it("lists artifacts across registered sources", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const fx = await buildFixtureRepo([
      { message: "init", files: {
        "ai/skills/foo/SKILL.md": "# Foo\n",
        "ai/skills/bar/SKILL.md": "# Bar\n",
      } },
    ]);
    await app.inject({
      method: "POST", url: "/api/skills-repos",
      payload: { name: "src", gitUrl: fx.fileUrl, branch: "main", artifactPaths: { skills: ["ai/skills"] } },
    });
    const list = await app.inject({ method: "GET", url: "/api/artifacts" });
    expect(list.statusCode).toBe(200);
    const names = list.json().map((a: { name: string }) => a.name).sort();
    expect(names).toEqual(["bar", "foo"]);
  });

  it("includes sourceName resolved from the registered repo's name", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const fx = await buildFixtureRepo([
      { message: "init", files: { "ai/skills/foo/SKILL.md": "# Foo\n" } },
    ]);
    await app.inject({
      method: "POST", url: "/api/skills-repos",
      payload: { name: "my-skills-repo", gitUrl: fx.fileUrl, branch: "main", artifactPaths: { skills: ["ai/skills"] } },
    });
    const list = await app.inject({ method: "GET", url: "/api/artifacts" });
    const [foo] = list.json();
    expect(foo.sourceName).toBe("my-skills-repo");

    const detail = await app.inject({
      method: "GET", url: `/api/artifacts/${encodeURIComponent(foo.artifactKey)}`,
    });
    expect(detail.json().sourceName).toBe("my-skills-repo");
  });
});

describe("API /installs", () => {
  it("creates an install and lists it under the working repo", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const fx = await buildFixtureRepo([
      { message: "init", files: { "ai/skills/foo/SKILL.md": "# Foo\n" } },
    ]);
    const src = (await app.inject({
      method: "POST", url: "/api/skills-repos",
      payload: { name: "src", gitUrl: fx.fileUrl, branch: "main", artifactPaths: { skills: ["ai/skills"] } },
    })).json();
    const wrPath = await tmpDir("arm-wr-");
    await simpleGit(wrPath).init();
    const wr = (await app.inject({
      method: "POST", url: "/api/working-repos",
      payload: { name: "w", path: wrPath },
    })).json();

    const arts = (await app.inject({ method: "GET", url: "/api/artifacts" })).json();
    const foo = arts.find((a: { name: string }) => a.name === "foo");

    const created = await app.inject({
      method: "POST", url: "/api/installs",
      payload: { artifactKey: foo.artifactKey, target: { type: "working-repo", workingRepoId: wr.id }, agent: "claude-code", autoUpdate: false },
    });
    expect(created.statusCode).toBe(201);

    const list = await app.inject({ method: "GET", url: `/api/working-repos/${wr.id}/installs` });
    expect(list.json()).toHaveLength(1);

    const dup = await app.inject({
      method: "POST", url: "/api/installs",
      payload: { artifactKey: foo.artifactKey, target: { type: "working-repo", workingRepoId: wr.id }, agent: "claude-code", autoUpdate: false },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe("already_installed");

    const del = await app.inject({ method: "DELETE", url: `/api/installs/${created.json().id}` });
    expect(del.statusCode).toBe(204);
    const list2 = await app.inject({ method: "GET", url: `/api/working-repos/${wr.id}/installs` });
    expect(list2.json()).toHaveLength(0);
  });
});

describe("API /installs — status, PATCH auto-update, POST update", () => {
  async function setup() {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const fx = await buildFixtureRepo([
      { message: "v1", files: { "ai/skills/foo/SKILL.md": "# Foo\nv1\n" } },
      { message: "v2", files: { "ai/skills/foo/SKILL.md": "# Foo\nv2\n" } },
    ]);
    const src = (await app.inject({
      method: "POST", url: "/api/skills-repos",
      payload: { name: "src", gitUrl: fx.fileUrl, branch: "main", artifactPaths: { skills: ["ai/skills"] } },
    })).json();
    const wrPath = await tmpDir("arm-wr-");
    await simpleGit(wrPath).init();
    await simpleGit(wrPath).addConfig("user.email", "a@b");
    await simpleGit(wrPath).addConfig("user.name", "t");
    await simpleGit(wrPath).addConfig("commit.gpgsign", "false");
    await simpleGit(wrPath).commit("seed", [], { "--allow-empty": null });
    const wr = (await app.inject({
      method: "POST", url: "/api/working-repos",
      payload: { name: "w", path: wrPath },
    })).json();
    // Install at v1 SHA
    const arts = (await app.inject({ method: "GET", url: "/api/artifacts" })).json();
    const foo = arts.find((a: { name: string }) => a.name === "foo");
    const install = (await app.inject({
      method: "POST", url: "/api/installs",
      payload: {
        artifactKey: foo.artifactKey,
        target: { type: "working-repo", workingRepoId: wr.id },
        agent: "claude-code",
        autoUpdate: false,
        sha: fx.shas[0],
      },
    })).json();
    return { deps, app, fx, src, wr, install, wrPath };
  }

  it("GET installs returns status field", async () => {
    const { app, wr, fx } = await setup();
    const list = await app.inject({ method: "GET", url: `/api/working-repos/${wr.id}/installs` });
    expect(list.statusCode).toBe(200);
    const installs = list.json();
    expect(installs).toHaveLength(1);
    // Installed at v1, HEAD is v2 → update-available
    expect(installs[0].status).toBe("update-available");
    expect(installs[0].availableSha).toBe(fx.shas[1]);
  });

  it("PATCH /api/installs/:id toggles autoUpdate", async () => {
    const { app, install } = await setup();
    const patched = await app.inject({
      method: "PATCH", url: `/api/installs/${install.id}`,
      payload: { autoUpdate: true },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().autoUpdate).toBe(true);
  });

  it("PATCH /api/installs/:id returns 400 for missing autoUpdate field", async () => {
    const { app, install } = await setup();
    const res = await app.inject({
      method: "PATCH", url: `/api/installs/${install.id}`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("bad_input");
  });

  it("POST /api/installs/:id/update applies available update and returns updated install", async () => {
    const { app, install, fx, wrPath } = await setup();
    const res = await app.inject({ method: "POST", url: `/api/installs/${install.id}/update` });
    expect(res.statusCode).toBe(200);
    const updated = res.json();
    expect(updated.installedCommitSha).toBe(fx.shas[1]);
    // File should be updated to v2 content
    const { readFile } = await import("node:fs/promises");
    const content = await readFile(`${wrPath}/.claude/skills/foo/SKILL.md`, "utf8");
    expect(content).toBe("# Foo\nv2\n");
  });

  it("POST /api/installs/:id/update returns 400 when no update is available", async () => {
    const fx2 = await buildFixtureRepo([
      { message: "v1", files: { "ai/skills/bar/SKILL.md": "# Bar\n" } },
    ]);
    const deps2 = await makeDeps();
    const app2 = await buildServer(deps2);
    await app2.inject({
      method: "POST", url: "/api/skills-repos",
      payload: { name: "s", gitUrl: fx2.fileUrl, branch: "main", artifactPaths: { skills: ["ai/skills"] } },
    });
    const wrPath2 = await tmpDir("arm-wr-");
    await simpleGit(wrPath2).init();
    await simpleGit(wrPath2).addConfig("user.email", "a@b");
    await simpleGit(wrPath2).addConfig("user.name", "t");
    await simpleGit(wrPath2).addConfig("commit.gpgsign", "false");
    await simpleGit(wrPath2).commit("seed", [], { "--allow-empty": null });
    const wr2 = (await app2.inject({ method: "POST", url: "/api/working-repos", payload: { name: "w", path: wrPath2 } })).json();
    const arts2 = (await app2.inject({ method: "GET", url: "/api/artifacts" })).json();
    const bar = arts2.find((a: { name: string }) => a.name === "bar");
    const inst2 = (await app2.inject({
      method: "POST", url: "/api/installs",
      payload: { artifactKey: bar.artifactKey, target: { type: "working-repo", workingRepoId: wr2.id }, autoUpdate: false },
    })).json();
    const res2 = await app2.inject({ method: "POST", url: `/api/installs/${inst2.id}/update` });
    expect(res2.statusCode).toBe(400);
    expect(res2.json().code).toBe("bad_input");
  });
});

describe("API POST /working-repos/:id/refresh", () => {
  it("runs auto-update pass and returns installs with updated status", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const fx = await buildFixtureRepo([
      { message: "v1", files: { "ai/skills/foo/SKILL.md": "v1\n" } },
      { message: "v2", files: { "ai/skills/foo/SKILL.md": "v2\n" } },
    ]);
    await app.inject({
      method: "POST", url: "/api/skills-repos",
      payload: { name: "src", gitUrl: fx.fileUrl, branch: "main", artifactPaths: { skills: ["ai/skills"] } },
    });
    const wrPath = await tmpDir("arm-wr-");
    await simpleGit(wrPath).init();
    await simpleGit(wrPath).addConfig("user.email", "a@b");
    await simpleGit(wrPath).addConfig("user.name", "t");
    await simpleGit(wrPath).addConfig("commit.gpgsign", "false");
    await simpleGit(wrPath).commit("seed", [], { "--allow-empty": null });
    const wr = (await app.inject({
      method: "POST", url: "/api/working-repos",
      payload: { name: "w", path: wrPath },
    })).json();
    const arts = (await app.inject({ method: "GET", url: "/api/artifacts" })).json();
    const foo = arts.find((a: { name: string }) => a.name === "foo");
    // Install at v1 with autoUpdate=true
    await app.inject({
      method: "POST", url: "/api/installs",
      payload: {
        artifactKey: foo.artifactKey,
        target: { type: "working-repo", workingRepoId: wr.id },
        autoUpdate: true,
        sha: fx.shas[0],
      },
    });

    const res = await app.inject({ method: "POST", url: `/api/working-repos/${wr.id}/refresh` });
    expect(res.statusCode).toBe(200);
    const installs = res.json();
    expect(installs).toHaveLength(1);
    // Auto-update should have fired: SHA updated to v2
    expect(installs[0].installedCommitSha).toBe(fx.shas[1]);
    expect(installs[0].status).toBe("up-to-date");
  });

  it("returns 404 for unknown working repo", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const res = await app.inject({ method: "POST", url: "/api/working-repos/no-such-id/refresh" });
    expect(res.statusCode).toBe(404);
  });
});

describe("API GET /api/installs?artifactKey=", () => {
  it("returns 400 when artifactKey is missing", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const res = await app.inject({ method: "GET", url: "/api/installs" });
    expect(res.statusCode).toBe(400);
  });

  it("returns installs with status for the given artifactKey", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);

    const fx = await buildFixtureRepo([
      { message: "init", files: { "skills/foo/SKILL.md": "# Foo\n" } },
    ]);
    const srcRes = await app.inject({
      method: "POST", url: "/api/skills-repos",
      payload: { name: "src", gitUrl: fx.fileUrl, branch: "main", artifactPaths: { skills: ["skills"] } },
    });
    expect(srcRes.statusCode).toBe(201);
    const src = srcRes.json();

    const wrDir = await tmpDir("arm-wr-");
    const sg = simpleGit(wrDir);
    await sg.init();
    await sg.addConfig("user.email", "a@b");
    await sg.addConfig("user.name", "t");
    await sg.addConfig("commit.gpgsign", "false");
    await sg.commit("seed", [], { "--allow-empty": null });

    const wrRes = await app.inject({
      method: "POST", url: "/api/working-repos",
      payload: { name: "my-repo", path: wrDir },
    });
    expect(wrRes.statusCode).toBe(201);
    const wr = wrRes.json();

    const artifactsRes = await app.inject({ method: "GET", url: `/api/artifacts?sourceRepoId=${src.id}` });
    const artifacts = artifactsRes.json();
    expect(artifacts.length).toBeGreaterThan(0);
    const artifactKey: string = artifacts[0].artifactKey;

    await app.inject({
      method: "POST", url: "/api/installs",
      payload: { artifactKey, target: { type: "working-repo", workingRepoId: wr.id } },
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/installs?artifactKey=${encodeURIComponent(artifactKey)}`,
    });
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list).toHaveLength(1);
    expect(list[0].artifactKey).toBe(artifactKey);
    expect(list[0].status).toBe("up-to-date");
    expect(list[0].availableSha).toBeNull();
  });

  it("returns empty array when no installs exist for the artifactKey", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const res = await app.inject({
      method: "GET",
      url: "/api/installs?artifactKey=nonexistent%3Afoo",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe("Activity log instrumentation", () => {
  it("POST /api/installs writes an install activity entry", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const fx = await buildFixtureRepo([
      { message: "init", files: { "ai/skills/foo/SKILL.md": "# Foo\n" } },
    ]);
    // Register skills repo
    const srcRes = await app.inject({
      method: "POST", url: "/api/skills-repos",
      payload: { name: "src", gitUrl: fx.fileUrl, branch: "main", artifactPaths: { skills: ["ai/skills"] } },
    });
    const src = srcRes.json();
    // Register working repo
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const wrPath = await mkdtemp(tmpdir() + "/wr-test-");
    const sg = simpleGit(wrPath);
    await sg.init();
    await sg.addConfig("user.email", "a@b");
    await sg.addConfig("user.name", "t");
    await sg.addConfig("commit.gpgsign", "false");
    await sg.commit("seed", [], { "--allow-empty": null });
    const wrRes = await app.inject({
      method: "POST", url: "/api/working-repos",
      payload: { name: "my-repo", path: wrPath },
    });
    const wr = wrRes.json();
    // List artifacts to get artifact key
    const arts = await app.inject({ method: "GET", url: `/api/artifacts?sourceRepoId=${src.id}` });
    const artifact = arts.json()[0];
    // Install
    await app.inject({
      method: "POST", url: "/api/installs",
      payload: { artifactKey: artifact.artifactKey, target: { type: "working-repo", workingRepoId: wr.id } },
    });
    // Give the async log write a moment to complete
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Check activity log
    const log = await app.inject({ method: "GET", url: "/api/activity-log?category=install" });
    const entries = log.json();
    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe("install");
    expect(entries[0].summary).toContain("Installed");
    expect(entries[0].artifactKey).toBe(artifact.artifactKey);
  });
});

describe("API /artifacts — favorites", () => {
  async function seedTwoArtifacts() {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const fx = await buildFixtureRepo([
      { message: "init", files: {
        "ai/skills/zulu/SKILL.md": "# Zulu\n",
        "ai/skills/alpha/SKILL.md": "# Alpha\n",
      } },
    ]);
    await app.inject({
      method: "POST", url: "/api/skills-repos",
      payload: { name: "src", gitUrl: fx.fileUrl, branch: "main", artifactPaths: { skills: ["ai/skills"] } },
    });
    const arts = (await app.inject({ method: "GET", url: "/api/artifacts" })).json();
    const zulu = arts.find((a: { name: string }) => a.name === "zulu");
    const alpha = arts.find((a: { name: string }) => a.name === "alpha");
    return { app, zulu, alpha };
  }

  it("GET /api/artifacts includes isFavorite=false by default, alphabetically sorted", async () => {
    const { app } = await seedTwoArtifacts();
    const res = await app.inject({ method: "GET", url: "/api/artifacts" });
    const arts = res.json();
    expect(arts.map((a: { name: string }) => a.name)).toEqual(["alpha", "zulu"]);
    expect(arts.every((a: { isFavorite: boolean }) => a.isFavorite === false)).toBe(true);
  });

  it("PUT /api/artifacts/:artifactKey/favorite marks an artifact favorited and sorts it first", async () => {
    const { app, zulu } = await seedTwoArtifacts();
    const put = await app.inject({
      method: "PUT", url: `/api/artifacts/${encodeURIComponent(zulu.artifactKey)}/favorite`,
    });
    expect(put.statusCode).toBe(204);

    const res = await app.inject({ method: "GET", url: "/api/artifacts" });
    const arts = res.json();
    expect(arts.map((a: { name: string }) => a.name)).toEqual(["zulu", "alpha"]);
    expect(arts.find((a: { name: string }) => a.name === "zulu").isFavorite).toBe(true);
  });

  it("GET /api/artifacts/:artifactKey reflects favorited status", async () => {
    const { app, alpha } = await seedTwoArtifacts();
    await app.inject({ method: "PUT", url: `/api/artifacts/${encodeURIComponent(alpha.artifactKey)}/favorite` });
    const res = await app.inject({ method: "GET", url: `/api/artifacts/${encodeURIComponent(alpha.artifactKey)}` });
    expect(res.json().isFavorite).toBe(true);
  });

  it("DELETE /api/artifacts/:artifactKey/favorite unmarks a favorited artifact", async () => {
    const { app, zulu } = await seedTwoArtifacts();
    await app.inject({ method: "PUT", url: `/api/artifacts/${encodeURIComponent(zulu.artifactKey)}/favorite` });
    const del = await app.inject({
      method: "DELETE", url: `/api/artifacts/${encodeURIComponent(zulu.artifactKey)}/favorite`,
    });
    expect(del.statusCode).toBe(204);
    const res = await app.inject({ method: "GET", url: `/api/artifacts/${encodeURIComponent(zulu.artifactKey)}` });
    expect(res.json().isFavorite).toBe(false);
  });

  it("PUT on an unknown artifactKey returns 404 artifact_not_found", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const res = await app.inject({ method: "PUT", url: "/api/artifacts/nonexistent%3Afoo/favorite" });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("artifact_not_found");
  });

  it("DELETE on an unknown artifactKey returns 404 artifact_not_found", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const res = await app.inject({ method: "DELETE", url: "/api/artifacts/nonexistent%3Afoo/favorite" });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("artifact_not_found");
  });
});
