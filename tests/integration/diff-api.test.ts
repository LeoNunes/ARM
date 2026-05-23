import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildServer } from "../../src/server.ts";
import { SettingsStore } from "../../src/state/settings.ts";
import { SkillsRepoStore } from "../../src/state/skills-repos.ts";
import { WorkingRepoStore } from "../../src/state/working-repos.ts";
import { InstallsStore } from "../../src/state/installs.ts";
import { ArtifactSnapshotsStore } from "../../src/state/artifact-snapshots.ts";
import { DismissedNotificationsStore } from "../../src/state/notifications.ts";
import { buildRegistries } from "../../src/adapters/index.ts";
import { buildFixtureRepo } from "../helpers/build-fixture-repo.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";
import type { FastifyInstance } from "fastify";
import { simpleGit } from "simple-git";

let app: FastifyInstance;

async function setup() {
  const stateDir = await tmpDir("diff-api-state-");
  const cacheDir = await tmpDir("diff-api-cache-");
  const settings = new SettingsStore(stateDir);
  const skillsRepos = new SkillsRepoStore(stateDir);
  const workingRepos = new WorkingRepoStore(stateDir);
  const installs = new InstallsStore(stateDir);
  const snapshots = new ArtifactSnapshotsStore(stateDir);
  const dismissed = new DismissedNotificationsStore(stateDir);
  const registries = buildRegistries();
  app = await buildServer({ stateDir, cacheDir, settings, skillsRepos, workingRepos, installs, registries, snapshots, dismissed });
}

beforeEach(setup);
afterEach(async () => { await app.close(); });

describe("GET /api/diff — version-vs-version", () => {
  it("returns fromContent and toContent that differ between two commits", async () => {
    const fx = await buildFixtureRepo([
      { message: "v1", files: { "ai/skills/foo/SKILL.md": "# Foo\nv1 content\n" } },
      { message: "v2", files: { "ai/skills/foo/SKILL.md": "# Foo\nv2 content\n" } },
    ]);

    const src = (await app.inject({
      method: "POST", url: "/api/skills-repos",
      payload: { name: "src", gitUrl: fx.fileUrl, branch: "main", artifactPaths: { skills: ["ai/skills"] } },
    })).json();

    const arts = (await app.inject({ method: "GET", url: "/api/artifacts" })).json();
    const foo = arts.find((a: { name: string }) => a.name === "foo");
    expect(foo).toBeDefined();

    const fromSha = fx.shas[0]!;
    const toSha = fx.shas[1]!;

    const res = await app.inject({
      method: "GET",
      url: `/api/diff?mode=version-vs-version&artifactKey=${encodeURIComponent(foo.artifactKey)}&fromSha=${fromSha}&toSha=${toSha}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mode).toBe("version-vs-version");
    expect(body.fromSha).toBe(fromSha);
    expect(body.toSha).toBe(toSha);
    expect(body.artifactKey).toBe(foo.artifactKey);
    expect(body.primaryAction).toBeNull();
    expect(body.installId).toBeNull();

    const skillFile = body.files.find((f: { path: string }) => f.path.endsWith("SKILL.md"));
    expect(skillFile).toBeDefined();
    expect(skillFile.changed).toBe(true);
    expect(skillFile.fromContent).toContain("v1 content");
    expect(skillFile.toContent).toContain("v2 content");
    expect(skillFile.fromContent).not.toBe(skillFile.toContent);
  });

  it("returns 400 when required params are missing", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/diff?mode=version-vs-version&artifactKey=some%3Akey",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("bad_input");
  });

  it("returns 404 for unknown artifactKey", async () => {
    const fx = await buildFixtureRepo([
      { message: "v1", files: { "ai/skills/foo/SKILL.md": "# Foo\n" } },
    ]);
    await app.inject({
      method: "POST", url: "/api/skills-repos",
      payload: { name: "src", gitUrl: fx.fileUrl, branch: "main", artifactPaths: { skills: ["ai/skills"] } },
    });
    const res = await app.inject({
      method: "GET",
      url: `/api/diff?mode=version-vs-version&artifactKey=${encodeURIComponent("nonexistent:key")}&fromSha=${fx.shas[0]}&toSha=${fx.shas[0]}`,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/diff — installed-vs-latest", () => {
  async function setupInstallAtV1() {
    const fx = await buildFixtureRepo([
      { message: "v1", files: { "ai/skills/foo/SKILL.md": "# Foo\nv1\n" } },
      { message: "v2", files: { "ai/skills/foo/SKILL.md": "# Foo\nv2\n" } },
    ]);

    await app.inject({
      method: "POST", url: "/api/skills-repos",
      payload: { name: "src", gitUrl: fx.fileUrl, branch: "main", artifactPaths: { skills: ["ai/skills"] } },
    });

    const wrPath = await tmpDir("diff-api-wr-");
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

    // Install at v1 SHA explicitly
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

    return { fx, wr, foo, install };
  }

  it("shows v1→v2 diff with primaryAction: update", async () => {
    const { fx, install } = await setupInstallAtV1();

    const res = await app.inject({
      method: "GET",
      url: `/api/diff?mode=installed-vs-latest&installId=${install.id}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mode).toBe("installed-vs-latest");
    expect(body.installId).toBe(install.id);
    expect(body.fromSha).toBe(fx.shas[0]);
    expect(body.primaryAction).toBe("update");

    const skillFile = body.files.find((f: { path: string }) => f.path.endsWith("SKILL.md"));
    expect(skillFile).toBeDefined();
    expect(skillFile.changed).toBe(true);
    expect(skillFile.fromContent).toContain("v1");
    expect(skillFile.toContent).toContain("v2");
  });

  it("returns 400 when installId is missing", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/diff?mode=installed-vs-latest",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("bad_input");
  });

  it("returns 404 for unknown installId", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/diff?mode=installed-vs-latest&installId=no-such-id",
    });
    expect(res.statusCode).toBe(404);
  });
});
