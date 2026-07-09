import { describe, it, expect } from "vitest";
import { buildServer } from "../../src/server.ts";
import { SettingsStore } from "../../src/state/settings.ts";
import { SkillsRepoStore } from "../../src/state/skills-repos.ts";
import { WorkingRepoStore } from "../../src/state/working-repos.ts";
import { InstallsStore } from "../../src/state/installs.ts";
import { ActivityLogStore } from "../../src/state/activity-log.ts";
import { ArtifactSnapshotsStore } from "../../src/state/artifact-snapshots.ts";
import { DismissedNotificationsStore } from "../../src/state/notifications.ts";
import { ArtifactShaBaselineStore } from "../../src/state/artifact-sha-baseline.ts";
import { FavoritesStore } from "../../src/state/favorites.ts";
import { buildRegistries } from "../../src/adapters/index.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";

async function makeDeps() {
  const stateDir = await tmpDir("arm-actlog-");
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

describe("GET /api/activity-log", () => {
  it("returns empty array initially", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const res = await app.inject({ method: "GET", url: "/api/activity-log" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("returns entries newest-first", async () => {
    const deps = await makeDeps();
    await deps.activityLog.add({ ts: "2026-01-01T00:00:00Z", category: "install", summary: "first" });
    await deps.activityLog.add({ ts: "2026-01-02T00:00:00Z", category: "uninstall", summary: "second" });
    const app = await buildServer(deps);
    const res = await app.inject({ method: "GET", url: "/api/activity-log" });
    const entries = res.json();
    expect(entries[0].summary).toBe("second");
    expect(entries[1].summary).toBe("first");
  });

  it("filters by category query param", async () => {
    const deps = await makeDeps();
    await deps.activityLog.add({ ts: "2026-01-01T00:00:00Z", category: "install", summary: "install one" });
    await deps.activityLog.add({ ts: "2026-01-01T00:00:00Z", category: "uninstall", summary: "uninstall one" });
    const app = await buildServer(deps);
    const res = await app.inject({ method: "GET", url: "/api/activity-log?category=install" });
    const entries = res.json();
    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe("install");
  });

  it("respects limit query param", async () => {
    const deps = await makeDeps();
    for (let i = 0; i < 10; i++) {
      await deps.activityLog.add({ ts: "2026-01-01T00:00:00Z", category: "install", summary: `e${i}` });
    }
    const app = await buildServer(deps);
    const res = await app.inject({ method: "GET", url: "/api/activity-log?limit=3" });
    expect(res.json()).toHaveLength(3);
  });
});

describe("DELETE /api/activity-log/:id", () => {
  it("deletes an entry and returns 204", async () => {
    const deps = await makeDeps();
    const entry = await deps.activityLog.add({ ts: "2026-01-01T00:00:00Z", category: "install", summary: "to delete" });
    const app = await buildServer(deps);
    const del = await app.inject({ method: "DELETE", url: `/api/activity-log/${entry.id}` });
    expect(del.statusCode).toBe(204);
    const list = await app.inject({ method: "GET", url: "/api/activity-log" });
    expect(list.json()).toHaveLength(0);
  });

  it("returns 204 for unknown id (idempotent)", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const res = await app.inject({ method: "DELETE", url: "/api/activity-log/nonexistent" });
    expect(res.statusCode).toBe(204);
  });
});
