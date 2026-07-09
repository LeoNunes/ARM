import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildServer } from "../../src/server.ts";
import { SettingsStore } from "../../src/state/settings.ts";
import { SkillsRepoStore } from "../../src/state/skills-repos.ts";
import { WorkingRepoStore } from "../../src/state/working-repos.ts";
import { InstallsStore } from "../../src/state/installs.ts";
import { ArtifactSnapshotsStore } from "../../src/state/artifact-snapshots.ts";
import { DismissedNotificationsStore } from "../../src/state/notifications.ts";
import { ArtifactShaBaselineStore } from "../../src/state/artifact-sha-baseline.ts";
import { ActivityLogStore } from "../../src/state/activity-log.ts";
import { FavoritesStore } from "../../src/state/favorites.ts";
import { buildRegistries } from "../../src/adapters/index.ts";
import { buildFixtureRepo } from "../helpers/build-fixture-repo.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let stateDir: string;
let snapshots: ArtifactSnapshotsStore;
let dismissed: DismissedNotificationsStore;
let shaBaseline: ArtifactShaBaselineStore;

async function setup() {
  stateDir = await tmpDir("notif-api-state-");
  const cacheDir = await tmpDir("notif-api-cache-");
  const settings = new SettingsStore(stateDir);
  const skillsRepos = new SkillsRepoStore(stateDir);
  const workingRepos = new WorkingRepoStore(stateDir);
  const installs = new InstallsStore(stateDir);
  snapshots = new ArtifactSnapshotsStore(stateDir);
  dismissed = new DismissedNotificationsStore(stateDir);
  shaBaseline = new ArtifactShaBaselineStore(stateDir);
  const registries = buildRegistries();
  const activityLog = new ActivityLogStore(stateDir);
  const favorites = new FavoritesStore(stateDir);
  app = await buildServer({
    stateDir, cacheDir, settings, skillsRepos, workingRepos, installs,
    registries, snapshots, dismissed, activityLog, shaBaseline, favorites,
  });
}

beforeEach(setup);
afterEach(async () => { await app.close(); });

describe("GET /api/notifications", () => {
  it("returns empty arrays when no repos registered", async () => {
    const res = await app.inject({ method: "GET", url: "/api/notifications" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.newArtifacts).toEqual([]);
    expect(body.updatedArtifacts).toEqual([]);
  });

  it("seeds snapshot and baseline on first call and returns nothing", async () => {
    const fx = await buildFixtureRepo([
      { message: "init", files: { "skills/foo/SKILL.md": "# foo" } },
    ]);
    const regRes = await app.inject({
      method: "POST", url: "/api/skills-repos",
      payload: { name: "test", gitUrl: fx.fileUrl, branch: "main", artifactPaths: { skills: ["skills"] } },
    });
    expect(regRes.statusCode).toBe(201);

    const res = await app.inject({ method: "GET", url: "/api/notifications" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.newArtifacts).toHaveLength(0);
    expect(body.updatedArtifacts).toHaveLength(0);
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

    // Force-clear snapshot for this repo to surface foo as new
    const { JsonStore } = await import("../../src/state/store.ts");
    const pathMod = await import("node:path");
    const snapshotFile = pathMod.join(stateDir, "artifact-snapshots.json");
    const s = new JsonStore(snapshotFile, {});
    await s.write({ [sourceRepoId]: [] });

    const res = await app.inject({ method: "GET", url: "/api/notifications" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.newArtifacts.length).toBeGreaterThan(0);
    expect(body.newArtifacts[0].kind).toBe("new-artifact");
    expect(body.newArtifacts[0].name).toBe("foo");
  });

  it("surfaces updated-artifact notification when SHA baseline is behind current", async () => {
    const fx = await buildFixtureRepo([
      { message: "init", files: { "skills/foo/SKILL.md": "# foo" } },
    ]);
    const regRes = await app.inject({
      method: "POST", url: "/api/skills-repos",
      payload: { name: "test", gitUrl: fx.fileUrl, branch: "main", artifactPaths: { skills: ["skills"] } },
    });
    const sourceRepoId = JSON.parse(regRes.body).id;

    // Seed baseline and snapshot via first GET
    await app.inject({ method: "GET", url: "/api/notifications" });

    // Overwrite baseline with an old SHA to simulate the artifact having been updated upstream
    const { JsonStore } = await import("../../src/state/store.ts");
    const pathMod = await import("node:path");
    const baselineFile = pathMod.join(stateDir, "artifact-sha-baseline.json");
    const b = new JsonStore<Record<string, string>>(baselineFile, {});
    const artifactKey = `${sourceRepoId}:skills/foo`;
    await b.write({ [`${sourceRepoId}:${artifactKey}`]: "old-sha-000" });

    const res = await app.inject({ method: "GET", url: "/api/notifications" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.updatedArtifacts).toHaveLength(1);
    const notif = body.updatedArtifacts[0];
    expect(notif.kind).toBe("updated-artifact");
    expect(notif.name).toBe("foo");
    expect(notif.sourceRepoId).toBe(sourceRepoId);
    expect(notif.fromSha).toBe("old-sha-000");
    expect(typeof notif.toSha).toBe("string");
    expect(notif.toSha.length).toBeGreaterThan(0);
    expect(notif.toSha).not.toBe("old-sha-000");
    expect(typeof notif.key).toBe("string");
    expect(notif.key).toMatch(/^updatedArtifact:/);
  });

  it("does not surface updated-artifact when SHA is unchanged", async () => {
    const fx = await buildFixtureRepo([
      { message: "init", files: { "skills/foo/SKILL.md": "# foo" } },
    ]);
    await app.inject({
      method: "POST", url: "/api/skills-repos",
      payload: { name: "test", gitUrl: fx.fileUrl, branch: "main", artifactPaths: { skills: ["skills"] } },
    });

    // First GET seeds baseline to current SHA
    await app.inject({ method: "GET", url: "/api/notifications" });

    // Second GET: baseline === current SHA → no notification
    const res = await app.inject({ method: "GET", url: "/api/notifications" });
    const body = JSON.parse(res.body);
    expect(body.updatedArtifacts).toHaveLength(0);
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

  it("dismissed new-artifact does not reappear", async () => {
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

    const res1 = await app.inject({ method: "GET", url: "/api/notifications" });
    const { newArtifacts } = JSON.parse(res1.body);
    expect(newArtifacts.length).toBe(1);

    await app.inject({
      method: "POST", url: "/api/notifications/dismiss",
      payload: { key: newArtifacts[0].key },
    });

    const res2 = await app.inject({ method: "GET", url: "/api/notifications" });
    expect(JSON.parse(res2.body).newArtifacts).toHaveLength(0);
  });

  it("dismissing updated-artifact advances baseline and suppresses notification", async () => {
    const fx = await buildFixtureRepo([
      { message: "init", files: { "skills/foo/SKILL.md": "# foo" } },
    ]);
    const regRes = await app.inject({
      method: "POST", url: "/api/skills-repos",
      payload: { name: "test", gitUrl: fx.fileUrl, branch: "main", artifactPaths: { skills: ["skills"] } },
    });
    const sourceRepoId = JSON.parse(regRes.body).id;

    // Seed baseline via first GET, then set it behind
    await app.inject({ method: "GET", url: "/api/notifications" });

    const { JsonStore } = await import("../../src/state/store.ts");
    const pathMod = await import("node:path");
    const baselineFile = pathMod.join(stateDir, "artifact-sha-baseline.json");
    const b = new JsonStore<Record<string, string>>(baselineFile, {});
    const artifactKey = `${sourceRepoId}:skills/foo`;
    await b.write({ [`${sourceRepoId}:${artifactKey}`]: "old-sha-000" });

    // GET to get the notification key
    const res1 = await app.inject({ method: "GET", url: "/api/notifications" });
    const { updatedArtifacts } = JSON.parse(res1.body);
    expect(updatedArtifacts).toHaveLength(1);
    const { key, toSha } = updatedArtifacts[0];

    // Dismiss it
    await app.inject({
      method: "POST", url: "/api/notifications/dismiss",
      payload: { key },
    });

    // Baseline should now be toSha
    const newBaseline = await shaBaseline.getBaseline(sourceRepoId, artifactKey);
    expect(newBaseline).toBe(toSha);

    // Notification should be gone
    const res2 = await app.inject({ method: "GET", url: "/api/notifications" });
    expect(JSON.parse(res2.body).updatedArtifacts).toHaveLength(0);
  });
});
