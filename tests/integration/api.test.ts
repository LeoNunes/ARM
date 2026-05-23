import { describe, it, expect } from "vitest";
import { buildServer } from "../../src/server.ts";
import { SettingsStore } from "../../src/state/settings.ts";
import { SkillsRepoStore } from "../../src/state/skills-repos.ts";
import { WorkingRepoStore } from "../../src/state/working-repos.ts";
import { InstallsStore } from "../../src/state/installs.ts";
import { buildRegistries } from "../../src/adapters/index.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";
import { buildFixtureRepo } from "../helpers/build-fixture-repo.ts";
import { simpleGit } from "simple-git";

async function makeDeps() {
  const stateDir = await tmpDir("skillmgr-api-");
  const cacheDir = await tmpDir("skillmgr-cache-");
  return {
    stateDir,
    cacheDir,
    settings: new SettingsStore(stateDir),
    skillsRepos: new SkillsRepoStore(stateDir),
    workingRepos: new WorkingRepoStore(stateDir),
    installs: new InstallsStore(stateDir),
    registries: buildRegistries(),
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
    const wrPath = await tmpDir("skillmgr-wr-");
    await simpleGit(wrPath).init();

    const ok = await app.inject({
      method: "POST", url: "/api/working-repos",
      payload: { name: "alpha", path: wrPath },
    });
    expect(ok.statusCode).toBe(201);

    const nonGit = await tmpDir("skillmgr-not-git-");
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
    const wrPath = await tmpDir("skillmgr-wr-");
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
    const wrPath = await tmpDir("skillmgr-wr-");
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
    const wrPath2 = await tmpDir("skillmgr-wr-");
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
