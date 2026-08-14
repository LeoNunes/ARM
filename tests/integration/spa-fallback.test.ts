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

async function makeDeps() {
  const stateDir = await tmpDir("arm-spa-");
  const cacheDir = await tmpDir("arm-spa-cache-");
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

describe("SPA fallback", () => {
  it("serves index.html for a deep client-side route", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const res = await app.inject({ method: "GET", url: "/working-repos/abc123" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.body).toContain('<div id="root">');
  });

  it("still returns a 404 for unmatched API routes", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const res = await app.inject({ method: "GET", url: "/api/does-not-exist" });
    expect(res.statusCode).toBe(404);
  });
});
