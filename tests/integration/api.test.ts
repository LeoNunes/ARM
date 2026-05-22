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
