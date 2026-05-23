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

let app: FastifyInstance;
let stateDir: string;
let snapshots: ArtifactSnapshotsStore;
let dismissed: DismissedNotificationsStore;

async function setup() {
  stateDir = await tmpDir("notif-api-state-");
  const cacheDir = await tmpDir("notif-api-cache-");
  const settings = new SettingsStore(stateDir);
  const skillsRepos = new SkillsRepoStore(stateDir);
  const workingRepos = new WorkingRepoStore(stateDir);
  const installs = new InstallsStore(stateDir);
  snapshots = new ArtifactSnapshotsStore(stateDir);
  dismissed = new DismissedNotificationsStore(stateDir);
  const registries = buildRegistries();
  app = await buildServer({ stateDir, cacheDir, settings, skillsRepos, workingRepos, installs, registries, snapshots, dismissed });
}

beforeEach(setup);
afterEach(async () => { await app.close(); });

describe("GET /api/notifications", () => {
  it("returns empty newArtifacts when no repos registered", async () => {
    const res = await app.inject({ method: "GET", url: "/api/notifications" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.newArtifacts).toEqual([]);
  });

  it("seeds snapshot on first call and returns nothing new", async () => {
    const fx = await buildFixtureRepo([
      { message: "init", files: { "skills/foo/SKILL.md": "# foo" } },
    ]);
    // Register repo
    const regRes = await app.inject({
      method: "POST", url: "/api/skills-repos",
      payload: { name: "test", gitUrl: fx.fileUrl, branch: "main", artifactPaths: { skills: ["skills"] } },
    });
    expect(regRes.statusCode).toBe(201);

    const res = await app.inject({ method: "GET", url: "/api/notifications" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // After registration, snapshot is seeded → no new artifacts
    expect(body.newArtifacts).toHaveLength(0);
  });

  it("surfaces new artifact when key appears after snapshot seeded", async () => {
    const fx = await buildFixtureRepo([
      { message: "init", files: { "skills/foo/SKILL.md": "# foo" } },
    ]);
    const regRes = await app.inject({
      method: "POST", url: "/api/skills-repos",
      payload: { name: "test", gitUrl: fx.fileUrl, branch: "main", artifactPaths: { skills: ["skills"] } },
    });
    const sourceRepoId = JSON.parse(regRes.body).id;

    // Force-clear snapshot for this repo using JsonStore directly
    const { JsonStore } = await import("../../src/state/store.ts");
    const pathMod = await import("node:path");
    const snapshotFile = pathMod.join(stateDir, "artifact-snapshots.json");
    const s = new JsonStore(snapshotFile, {});
    await s.write({ [sourceRepoId]: [] }); // clear snapshot for this repo

    const res = await app.inject({ method: "GET", url: "/api/notifications" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.newArtifacts.length).toBeGreaterThan(0);
    expect(body.newArtifacts[0].kind).toBe("new-artifact");
    expect(body.newArtifacts[0].name).toBe("foo");
  });
});

describe("POST /api/notifications/dismiss", () => {
  it("returns 204 and persists the dismiss key", async () => {
    const key = "newArtifact:r1:r1:ai/skills/foo:abc123";
    const res = await app.inject({
      method: "POST", url: "/api/notifications/dismiss",
      payload: { key },
    });
    expect(res.statusCode).toBe(204);
    expect(await dismissed.isDismissed(key)).toBe(true);
  });

  it("dismissed artifact does not appear in notifications", async () => {
    const fx = await buildFixtureRepo([
      { message: "init", files: { "skills/foo/SKILL.md": "# foo" } },
    ]);
    const regRes = await app.inject({
      method: "POST", url: "/api/skills-repos",
      payload: { name: "test", gitUrl: fx.fileUrl, branch: "main", artifactPaths: { skills: ["skills"] } },
    });
    const sourceRepoId = JSON.parse(regRes.body).id;

    // Clear snapshot to surface foo as new
    const { JsonStore } = await import("../../src/state/store.ts");
    const pathMod = await import("node:path");
    const snapshotFile = pathMod.join(stateDir, "artifact-snapshots.json");
    const s = new JsonStore(snapshotFile, {});
    await s.write({ [sourceRepoId]: [] });

    // Get notifications to find the key
    const res1 = await app.inject({ method: "GET", url: "/api/notifications" });
    const { newArtifacts } = JSON.parse(res1.body);
    expect(newArtifacts.length).toBe(1);
    const dismissKey = newArtifacts[0].key;

    // Dismiss it
    await app.inject({ method: "POST", url: "/api/notifications/dismiss", payload: { key: dismissKey } });

    // Check it's gone
    const res2 = await app.inject({ method: "GET", url: "/api/notifications" });
    const body2 = JSON.parse(res2.body);
    expect(body2.newArtifacts).toHaveLength(0);
  });
});
