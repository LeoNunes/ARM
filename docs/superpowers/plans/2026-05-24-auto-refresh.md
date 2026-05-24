# Auto-Refresh & Activity Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a configurable backend refresh loop that periodically fetches skills repos and runs auto-updates, a persistent activity log for all write operations, and a frontend that re-polls the API every 5 seconds.

**Architecture:** A `setTimeout`-based recursive loop (`src/engine/refresh-loop.ts`) fires on a user-configured interval, fetches all registered skills repos via `GitClient.fetchAndReset`, and runs the existing `runAutoUpdatePass`. All write operations (install, uninstall, re-apply, manual refresh, auto-update) write an entry to a new `ActivityLogStore` backed by `JsonStore<ActivityLogEntry[]>`. The frontend uses a `useAutoRefresh` hook (fixed 5 s interval) to re-poll the API, and the Dashboard shows a panel of the 10 most recent activity entries with a link to a full `/activity` page.

**Tech Stack:** Node.js / TypeScript / Fastify (backend); React 18 / React Router (frontend); Vitest (tests); existing `JsonStore<T>` for persistence.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/state/schema.ts` | Modify | Add `ActivityCategory`, `ActivityLogEntry` types; add `autoRefreshEnabled`, `autoRefreshIntervalMinutes` to `SettingsFile` |
| `src/state/settings.ts` | Modify | Update `DEFAULTS` with new settings fields |
| `src/state/activity-log.ts` | Create | `ActivityLogStore` — list/add/delete, 500-entry cap, newest-first |
| `src/engine/update-pass.ts` | Modify | Return `AppliedUpdate[]` instead of `void` |
| `src/engine/refresh-loop.ts` | Create | `runRefreshPass` (testable unit) + `startRefreshLoop` (timer wrapper) |
| `src/server.ts` | Modify | Add `activityLog: ActivityLogStore` to `ServerDeps` |
| `src/api/activity-log.ts` | Create | `GET /api/activity-log` and `DELETE /api/activity-log/:id` |
| `src/api/routes.ts` | Modify | Register activity log routes |
| `src/api/settings.ts` | Modify | Widen PATCH body type to include new settings fields |
| `src/api/installs.ts` | Modify | Write activity log entries on install, uninstall, re-apply, update |
| `src/api/skills-repos.ts` | Modify | Write activity log entry on manual refresh |
| `src/index.ts` | Modify | Instantiate `ActivityLogStore`; call `startRefreshLoop` |
| `web/api.ts` | Modify | Add `ActivityCategory`, `ActivityLogEntry` types; new API methods; extend `Settings` type |
| `web/hooks/useAutoRefresh.ts` | Create | Recursive `setTimeout` hook for FE polling |
| `web/pages/Settings.tsx` | Modify | Add auto-refresh enable toggle + interval input |
| `web/pages/ActivityLog.tsx` | Create | Full activity log page with category filter and per-entry delete |
| `web/pages/Dashboard.tsx` | Modify | Add activity panel (10 entries, filter, "View all"), add `useAutoRefresh` |
| `web/pages/Browse.tsx` | Modify | Add `useAutoRefresh` |
| `web/pages/WorkingRepoDetail.tsx` | Modify | Add `useAutoRefresh` |
| `web/routes.tsx` | Modify | Register `/activity` route |
| `web/components/Sidebar.tsx` | Modify | Add "Activity" nav link |
| `tests/unit/activity-log-store.test.ts` | Create | Unit tests for `ActivityLogStore` |
| `tests/integration/activity-log-api.test.ts` | Create | Integration tests for activity log API endpoints |

---

## Task 1: Schema additions

**Files:**
- Modify: `src/state/schema.ts`

- [ ] **Step 1: Add the new types and fields**

Open `src/state/schema.ts` and apply these changes:

```ts
// Add after ArtifactTypeId line:
export type ActivityCategory =
  | "auto-update"
  | "install"
  | "uninstall"
  | "re-apply"
  | "refresh";

export interface ActivityLogEntry {
  id: string;
  ts: string;
  category: ActivityCategory;
  summary: string;
  detail?: string;
  artifactKey?: string;
  workingRepoId?: string;
  sourceRepoId?: string;
}
```

Also extend `SettingsFile`:

```ts
export interface SettingsFile {
  favoriteAgent: AgentId;
  mcpPort: number;
  autoRefreshEnabled: boolean;
  autoRefreshIntervalMinutes: number;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc -p tsconfig.be.json --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/state/schema.ts
git commit -m "feat(schema): add ActivityLogEntry types and auto-refresh settings fields"
```

---

## Task 2: ActivityLogStore

**Files:**
- Create: `src/state/activity-log.ts`
- Create: `tests/unit/activity-log-store.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/activity-log-store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ActivityLogStore } from "../../src/state/activity-log.ts";

describe("ActivityLogStore", () => {
  let dir: string;
  let store: ActivityLogStore;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "actlog-test-"));
    store = new ActivityLogStore(dir);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("list returns empty array initially", async () => {
    expect(await store.list()).toEqual([]);
  });

  it("add persists an entry with generated id, newest first", async () => {
    const e1 = await store.add({ ts: "2026-01-01T00:00:00Z", category: "install", summary: "first" });
    const e2 = await store.add({ ts: "2026-01-02T00:00:00Z", category: "refresh", summary: "second" });
    expect(e1.id).toMatch(/[0-9a-f-]{36}/);
    expect(e2.id).toMatch(/[0-9a-f-]{36}/);
    const entries = await store.list();
    expect(entries[0]!.summary).toBe("second");
    expect(entries[1]!.summary).toBe("first");
  });

  it("list filters by category", async () => {
    await store.add({ ts: "2026-01-01T00:00:00Z", category: "install", summary: "install one" });
    await store.add({ ts: "2026-01-02T00:00:00Z", category: "refresh", summary: "refresh one" });
    const installs = await store.list({ category: "install" });
    expect(installs).toHaveLength(1);
    expect(installs[0]!.category).toBe("install");
  });

  it("list respects limit", async () => {
    for (let i = 0; i < 5; i++) {
      await store.add({ ts: "2026-01-01T00:00:00Z", category: "install", summary: `entry ${i}` });
    }
    const limited = await store.list({ limit: 3 });
    expect(limited).toHaveLength(3);
  });

  it("delete removes an entry by id", async () => {
    const e = await store.add({ ts: "2026-01-01T00:00:00Z", category: "install", summary: "to delete" });
    await store.delete(e.id);
    expect(await store.list()).toHaveLength(0);
  });

  it("caps at 500 entries, discarding oldest", async () => {
    for (let i = 0; i < 502; i++) {
      await store.add({ ts: "2026-01-01T00:00:00Z", category: "install", summary: `entry ${i}` });
    }
    const all = await store.list();
    expect(all).toHaveLength(500);
    expect(all[0]!.summary).toBe("entry 501");
    expect(all[499]!.summary).toBe("entry 2");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/unit/activity-log-store.test.ts
```

Expected: FAIL — `ActivityLogStore` not found.

- [ ] **Step 3: Implement ActivityLogStore**

Create `src/state/activity-log.ts`:

```ts
import path from "node:path";
import { JsonStore } from "./store";
import type { ActivityLogEntry, ActivityCategory } from "./schema";
import { newId } from "../util/ids";

const MAX_ENTRIES = 500;

export class ActivityLogStore {
  private store: JsonStore<ActivityLogEntry[]>;

  constructor(stateDir: string) {
    this.store = new JsonStore<ActivityLogEntry[]>(
      path.join(stateDir, "activityLog.json"),
      [],
    );
  }

  async list(filter?: { category?: ActivityCategory; limit?: number }): Promise<ActivityLogEntry[]> {
    let entries = await this.store.read();
    if (filter?.category) {
      entries = entries.filter((e) => e.category === filter.category);
    }
    if (filter?.limit !== undefined) {
      entries = entries.slice(0, filter.limit);
    }
    return entries;
  }

  async add(input: Omit<ActivityLogEntry, "id">): Promise<ActivityLogEntry> {
    const entries = await this.store.read();
    const entry: ActivityLogEntry = { id: newId(), ...input };
    entries.unshift(entry);
    await this.store.write(entries.slice(0, MAX_ENTRIES));
    return entry;
  }

  async delete(id: string): Promise<void> {
    const entries = await this.store.read();
    await this.store.write(entries.filter((e) => e.id !== id));
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/unit/activity-log-store.test.ts
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state/activity-log.ts tests/unit/activity-log-store.test.ts
git commit -m "feat(state): add ActivityLogStore with 500-entry cap"
```

---

## Task 3: Update settings defaults and settings route

**Files:**
- Modify: `src/state/settings.ts`
- Modify: `src/api/settings.ts`

- [ ] **Step 1: Update DEFAULTS in settings store**

In `src/state/settings.ts`, replace the `DEFAULTS` line:

```ts
const DEFAULTS: SettingsFile = {
  favoriteAgent: "claude-code",
  mcpPort: 7747,
  autoRefreshEnabled: true,
  autoRefreshIntervalMinutes: 30,
};
```

- [ ] **Step 2: Widen PATCH body type in settings route**

In `src/api/settings.ts`, replace the patch handler:

```ts
import type { FastifyInstance } from "fastify";
import type { ServerDeps } from '../server';
import type { AgentId } from '../state/schema';

export async function registerSettingsRoutes(app: FastifyInstance, { settings }: ServerDeps): Promise<void> {
  app.get("/api/settings", async () => settings.read());
  app.patch<{
    Body: {
      favoriteAgent?: AgentId;
      mcpPort?: number;
      autoRefreshEnabled?: boolean;
      autoRefreshIntervalMinutes?: number;
    };
  }>(
    "/api/settings",
    async (req) => settings.update(req.body ?? {}),
  );
}
```

- [ ] **Step 3: Verify existing settings tests still pass**

```bash
npx vitest run tests/integration/api.test.ts
```

Expected: PASS — `GET /api/settings` returns defaults including new fields.

- [ ] **Step 4: Commit**

```bash
git add src/state/settings.ts src/api/settings.ts
git commit -m "feat(settings): add autoRefreshEnabled and autoRefreshIntervalMinutes defaults"
```

---

## Task 4: Wire ActivityLogStore into ServerDeps

**Files:**
- Modify: `src/server.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Add activityLog to ServerDeps**

In `src/server.ts`, add the import and the field:

```ts
import type { ActivityLogStore } from './state/activity-log';
```

Inside `ServerDeps`:
```ts
export interface ServerDeps {
  stateDir: string;
  cacheDir: string;
  settings: SettingsStore;
  skillsRepos: SkillsRepoStore;
  workingRepos: WorkingRepoStore;
  installs: InstallsStore;
  registries: ReturnType<typeof buildRegistries>;
  snapshots: ArtifactSnapshotsStore;
  dismissed: DismissedNotificationsStore;
  activityLog: ActivityLogStore;
}
```

- [ ] **Step 2: Instantiate ActivityLogStore in index.ts**

In `src/index.ts`, add the import:

```ts
import { ActivityLogStore } from './state/activity-log';
```

And inside `main()`, after the `dismissed` line:

```ts
const activityLog = new ActivityLogStore(stateDir);
```

Then pass it into `buildServer`:

```ts
const app = await buildServer({
  stateDir, cacheDir, settings, skillsRepos, workingRepos, installs,
  registries, snapshots, dismissed, activityLog,
});
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc -p tsconfig.be.json --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/server.ts src/index.ts
git commit -m "feat(server): wire ActivityLogStore into ServerDeps"
```

---

## Task 5: Activity log API routes

**Files:**
- Create: `src/api/activity-log.ts`
- Modify: `src/api/routes.ts`
- Create: `tests/integration/activity-log-api.test.ts`

- [ ] **Step 1: Write the failing integration tests**

Create `tests/integration/activity-log-api.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildServer } from "../../src/server.ts";
import { SettingsStore } from "../../src/state/settings.ts";
import { SkillsRepoStore } from "../../src/state/skills-repos.ts";
import { WorkingRepoStore } from "../../src/state/working-repos.ts";
import { InstallsStore } from "../../src/state/installs.ts";
import { ActivityLogStore } from "../../src/state/activity-log.ts";
import { ArtifactSnapshotsStore } from "../../src/state/artifact-snapshots.ts";
import { DismissedNotificationsStore } from "../../src/state/notifications.ts";
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
    await deps.activityLog.add({ ts: "2026-01-02T00:00:00Z", category: "refresh", summary: "second" });
    const app = await buildServer(deps);
    const res = await app.inject({ method: "GET", url: "/api/activity-log" });
    const entries = res.json();
    expect(entries[0].summary).toBe("second");
    expect(entries[1].summary).toBe("first");
  });

  it("filters by category query param", async () => {
    const deps = await makeDeps();
    await deps.activityLog.add({ ts: "2026-01-01T00:00:00Z", category: "install", summary: "install one" });
    await deps.activityLog.add({ ts: "2026-01-01T00:00:00Z", category: "refresh", summary: "refresh one" });
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
```

- [ ] **Step 2: Run to confirm they fail**

```bash
npx vitest run tests/integration/activity-log-api.test.ts
```

Expected: FAIL — routes not registered yet.

- [ ] **Step 3: Create the route handler**

Create `src/api/activity-log.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { ServerDeps } from "../server";
import type { ActivityCategory } from "../state/schema";

export async function registerActivityLogRoutes(app: FastifyInstance, deps: ServerDeps): Promise<void> {
  app.get<{ Querystring: { category?: string; limit?: string } }>(
    "/api/activity-log",
    async (req) => {
      const { category, limit } = req.query;
      return deps.activityLog.list({
        category: category as ActivityCategory | undefined,
        limit: limit !== undefined ? parseInt(limit, 10) : 50,
      });
    },
  );

  app.delete<{ Params: { id: string } }>("/api/activity-log/:id", async (req, reply) => {
    await deps.activityLog.delete(req.params.id);
    return reply.code(204).send();
  });
}
```

- [ ] **Step 4: Register routes in routes.ts**

In `src/api/routes.ts`, add the import:

```ts
import { registerActivityLogRoutes } from './activity-log';
```

And inside `registerRoutes`, add after `registerDiffRoutes`:

```ts
await registerActivityLogRoutes(app, deps);
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npx vitest run tests/integration/activity-log-api.test.ts
```

Expected: all 6 tests PASS.

- [ ] **Step 6: Run full test suite to confirm no regressions**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/api/activity-log.ts src/api/routes.ts tests/integration/activity-log-api.test.ts
git commit -m "feat(api): add GET and DELETE /api/activity-log endpoints"
```

---

## Task 6: Instrument installs API with activity log

**Files:**
- Modify: `src/api/installs.ts`

- [ ] **Step 1: Add the helper function and instrument write routes**

In `src/api/installs.ts`, add this helper near the top (after the imports):

```ts
function artifactDisplayName(artifactKey: string): string {
  return artifactKey.split(":").slice(1).join(":").split("/").pop() ?? artifactKey;
}
```

Then add activity log entries to each write operation:

**After `const persisted = await deps.installs.add(record);` in `POST /api/installs`:**

```ts
const targetName = workingRepo ? `'${workingRepo.name}'` : `globally (${agentId})`;
await deps.activityLog.add({
  ts: new Date().toISOString(),
  category: "install",
  summary: `Installed '${artifact.name}' into ${targetName}`,
  artifactKey: body.artifactKey,
  workingRepoId: workingRepo?.id,
  sourceRepoId: skillsRepo.id,
}).catch(() => {});
return reply.code(201).send(persisted);
```

**After `const updated = await deps.installs.update(install.id, patch);` in `POST /api/installs/:id/update`:**

```ts
await deps.activityLog.add({
  ts: new Date().toISOString(),
  category: "install",
  summary: `Updated '${artifactDisplayName(install.artifactKey)}' in '${wr.name}'`,
  detail: `${install.installedCommitSha.slice(0, 7)} → ${updateResult.availableSha!.slice(0, 7)}`,
  artifactKey: install.artifactKey,
  workingRepoId: wr.id,
  sourceRepoId: install.sourceRepoId,
}).catch(() => {});
return updated;
```

**After `const updated = await deps.installs.update(install.id, patch);` in `POST /api/installs/:id/reapply`:**

```ts
await deps.activityLog.add({
  ts: new Date().toISOString(),
  category: "re-apply",
  summary: `Re-applied '${artifactDisplayName(install.artifactKey)}' in '${wr.name}'`,
  artifactKey: install.artifactKey,
  workingRepoId: wr.id,
  sourceRepoId: install.sourceRepoId,
}).catch(() => {});
return updated;
```

**After `await deps.installs.remove(install.id);` in `DELETE /api/installs/:id`:**

```ts
const wrName = workingRepo ? `'${workingRepo.name}'` : "global";
await deps.activityLog.add({
  ts: new Date().toISOString(),
  category: "uninstall",
  summary: `Uninstalled '${artifactDisplayName(install.artifactKey)}' from ${wrName}`,
  artifactKey: install.artifactKey,
  workingRepoId: install.target.type === "working-repo" ? install.target.workingRepoId : undefined,
  sourceRepoId: install.sourceRepoId,
}).catch(() => {});
return reply.code(204).send();
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc -p tsconfig.be.json --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/api/installs.ts
git commit -m "feat(api): log install/uninstall/update/reapply to activity log"
```

---

## Task 7: Instrument skills-repos manual refresh

**Files:**
- Modify: `src/api/skills-repos.ts`

- [ ] **Step 1: Add activity log write to the refresh handler**

In `src/api/skills-repos.ts`, locate the `POST /api/skills-repos/:id/refresh` handler. After `const updated = await deps.skillsRepos.update(r.id, { lastFetchedAt: ... });`, add:

```ts
await deps.activityLog.add({
  ts: new Date().toISOString(),
  category: "refresh",
  summary: `Refreshed '${r.name}'`,
  sourceRepoId: r.id,
}).catch(() => {});
```

The full updated handler:

```ts
app.post<{ Params: { id: string } }>("/api/skills-repos/:id/refresh", async (req, reply) => {
  const r = await deps.skillsRepos.get(req.params.id);
  if (!r) return reply.code(404).send({ code: "skills_repo_not_found" });
  await new GitClient().fetchAndReset(r.localClonePath, r.branch);
  const updated = await deps.skillsRepos.update(r.id, { lastFetchedAt: new Date().toISOString() });
  await deps.activityLog.add({
    ts: new Date().toISOString(),
    category: "refresh",
    summary: `Refreshed '${r.name}'`,
    sourceRepoId: r.id,
  }).catch(() => {});
  runAutoUpdatePass({
    installs: deps.installs,
    skillsRepos: deps.skillsRepos,
    workingRepos: deps.workingRepos,
    registries: deps.registries,
  }).catch(() => {});
  return updated;
});
```

- [ ] **Step 2: Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/api/skills-repos.ts
git commit -m "feat(api): log manual skills-repo refresh to activity log"
```

---

## Task 8: Update runAutoUpdatePass to return AppliedUpdate[]

**Files:**
- Modify: `src/engine/update-pass.ts`

- [ ] **Step 1: Add the AppliedUpdate type and update the function signature**

Replace `src/engine/update-pass.ts` entirely:

```ts
import { checkForUpdates } from "./update-check";
import { checkForDrift } from "./drift-check";
import { applyUpdate } from "./apply-update";
import type { InstallsStore } from "../state/installs";
import type { SkillsRepoStore } from "../state/skills-repos";
import type { WorkingRepoStore } from "../state/working-repos";
import type { AgentRegistry } from "../adapters/registry";
import type { Install } from "../state/schema";

export interface AutoUpdatePassDeps {
  installs: InstallsStore;
  skillsRepos: SkillsRepoStore;
  workingRepos: WorkingRepoStore;
  registries: { agents: AgentRegistry };
}

export interface AppliedUpdate {
  install: Install;
  oldSha: string;
  newSha: string;
}

export async function runAutoUpdatePass(deps: AutoUpdatePassDeps): Promise<AppliedUpdate[]> {
  const allInstalls = await deps.installs.list();
  const allRepos = await deps.skillsRepos.list();
  const allWrs = await deps.workingRepos.list();
  const reposById = new Map(allRepos.map((r) => [r.id, r]));
  const wrsById = new Map(allWrs.map((w) => [w.id, w]));
  const applied: AppliedUpdate[] = [];

  for (const install of allInstalls) {
    if (!install.autoUpdate) continue;
    if (install.target.type !== "working-repo") continue;

    const sr = reposById.get(install.sourceRepoId);
    if (!sr) continue;

    const wr = wrsById.get(install.target.workingRepoId);
    if (!wr) continue;

    const updateResult = await checkForUpdates(install, sr);
    if (!updateResult.hasUpdate || !updateResult.availableSha) continue;

    const driftResult = await checkForDrift(install, sr, wr.path);
    if (driftResult.isDrifted) continue;

    const agent = deps.registries.agents.get(install.agent);
    const others = allInstalls.filter((i) => i.id !== install.id);
    const oldSha = install.installedCommitSha;
    const patch = await applyUpdate({
      install, skillsRepo: sr, workingRepo: wr,
      newSha: updateResult.availableSha, agent,
      otherInstallsInTarget: others,
    });
    await deps.installs.update(install.id, patch);
    applied.push({ install, oldSha, newSha: updateResult.availableSha });
  }

  return applied;
}
```

- [ ] **Step 2: Run full test suite to confirm no regressions**

```bash
npm test
```

Expected: all tests PASS (existing callers ignore the return value).

- [ ] **Step 3: Commit**

```bash
git add src/engine/update-pass.ts
git commit -m "feat(engine): runAutoUpdatePass now returns AppliedUpdate[]"
```

---

## Task 9: Backend refresh loop

**Files:**
- Create: `src/engine/refresh-loop.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Create the refresh loop module**

Create `src/engine/refresh-loop.ts`:

```ts
import { GitClient } from "../git/client";
import { runAutoUpdatePass } from "./update-pass";
import type { SettingsStore } from "../state/settings";
import type { SkillsRepoStore } from "../state/skills-repos";
import type { WorkingRepoStore } from "../state/working-repos";
import type { InstallsStore } from "../state/installs";
import type { ActivityLogStore } from "../state/activity-log";
import type { buildRegistries } from "../adapters/index";

export interface RefreshLoopDeps {
  settings: SettingsStore;
  skillsRepos: SkillsRepoStore;
  workingRepos: WorkingRepoStore;
  installs: InstallsStore;
  activityLog: ActivityLogStore;
  registries: ReturnType<typeof buildRegistries>;
}

function artifactDisplayName(artifactKey: string): string {
  return artifactKey.split(":").slice(1).join(":").split("/").pop() ?? artifactKey;
}

export async function runRefreshPass(deps: RefreshLoopDeps): Promise<void> {
  const allRepos = await deps.skillsRepos.list();
  const git = new GitClient();

  for (const repo of allRepos) {
    try {
      await git.fetchAndReset(repo.localClonePath, repo.branch);
      await deps.skillsRepos.update(repo.id, { lastFetchedAt: new Date().toISOString() });
      await deps.activityLog.add({
        ts: new Date().toISOString(),
        category: "refresh",
        summary: `Refreshed '${repo.name}'`,
        sourceRepoId: repo.id,
      });
    } catch (err) {
      process.stderr.write(`refresh-loop: fetch failed for ${repo.name}: ${(err as Error).message}\n`);
      await deps.activityLog.add({
        ts: new Date().toISOString(),
        category: "refresh",
        summary: `Failed to refresh '${repo.name}'`,
        detail: (err as Error).message,
        sourceRepoId: repo.id,
      });
    }
  }

  const applied = await runAutoUpdatePass({
    installs: deps.installs,
    skillsRepos: deps.skillsRepos,
    workingRepos: deps.workingRepos,
    registries: deps.registries,
  });

  const allWrs = await deps.workingRepos.list();
  const wrsById = new Map(allWrs.map((w) => [w.id, w]));

  for (const { install, oldSha, newSha } of applied) {
    const name = artifactDisplayName(install.artifactKey);
    const wrName =
      install.target.type === "working-repo"
        ? (wrsById.get(install.target.workingRepoId)?.name ?? install.target.workingRepoId)
        : "global";
    await deps.activityLog.add({
      ts: new Date().toISOString(),
      category: "auto-update",
      summary: `Auto-updated '${name}' in '${wrName}'`,
      detail: `${oldSha.slice(0, 7)} → ${newSha.slice(0, 7)}`,
      artifactKey: install.artifactKey,
      workingRepoId: install.target.type === "working-repo" ? install.target.workingRepoId : undefined,
      sourceRepoId: install.sourceRepoId,
    });
  }
}

export function startRefreshLoop(deps: RefreshLoopDeps): void {
  async function tick(): Promise<void> {
    const settings = await deps.settings.read();
    let nextDelayMs: number;
    if (!settings.autoRefreshEnabled) {
      nextDelayMs = 60_000;
    } else {
      try {
        await runRefreshPass(deps);
      } catch (err) {
        process.stderr.write(`refresh-loop error: ${(err as Error).message}\n`);
      }
      const s2 = await deps.settings.read();
      nextDelayMs = s2.autoRefreshIntervalMinutes * 60_000;
    }
    setTimeout(() => { void tick(); }, nextDelayMs);
  }
  setTimeout(() => { void tick(); }, 60_000);
}
```

- [ ] **Step 2: Wire startRefreshLoop into index.ts**

In `src/index.ts`, add the import:

```ts
import { startRefreshLoop } from './engine/refresh-loop';
```

After the `runAutoUpdatePass(...)` call inside `main()`, add:

```ts
startRefreshLoop({ settings, skillsRepos, workingRepos, installs, activityLog, registries });
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc -p tsconfig.be.json --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/refresh-loop.ts src/index.ts
git commit -m "feat(engine): add background refresh loop with activity log instrumentation"
```

---

## Task 10: Frontend API additions

**Files:**
- Modify: `web/api.ts`

- [ ] **Step 1: Add types and extend Settings**

In `web/api.ts`, after the `Settings` interface, add:

```ts
export type ActivityCategory =
  | "auto-update"
  | "install"
  | "uninstall"
  | "re-apply"
  | "refresh";

export interface ActivityLogEntry {
  id: string;
  ts: string;
  category: ActivityCategory;
  summary: string;
  detail?: string;
  artifactKey?: string;
  workingRepoId?: string;
  sourceRepoId?: string;
}
```

Replace the existing `Settings` interface with:

```ts
export interface Settings {
  favoriteAgent: "claude-code" | "cursor";
  mcpPort: number;
  autoRefreshEnabled: boolean;
  autoRefreshIntervalMinutes: number;
}
```

- [ ] **Step 2: Add API methods**

Inside the `api` object in `web/api.ts`, add after `updateSettings`:

```ts
getActivityLog: (params?: { category?: ActivityCategory; limit?: number }) => {
  const qs = new URLSearchParams();
  if (params?.category) qs.set("category", params.category);
  if (params?.limit !== undefined) qs.set("limit", String(params.limit));
  const q = qs.toString();
  return req<ActivityLogEntry[]>("GET", `/api/activity-log${q ? `?${q}` : ""}`);
},
deleteActivityLogEntry: (id: string) => req<void>("DELETE", `/api/activity-log/${id}`),
```

- [ ] **Step 3: Verify frontend TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/api.ts
git commit -m "feat(web): add ActivityLogEntry types and API methods"
```

---

## Task 11: useAutoRefresh hook

**Files:**
- Create: `web/hooks/useAutoRefresh.ts`

- [ ] **Step 1: Create the hook**

Create directory and file `web/hooks/useAutoRefresh.ts`:

```ts
import { useEffect, useRef } from "react";

export function useAutoRefresh(callback: () => void, intervalMs = 5000): void {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    let id: ReturnType<typeof setTimeout>;
    function schedule() {
      id = setTimeout(() => {
        cbRef.current();
        schedule();
      }, intervalMs);
    }
    schedule();
    return () => clearTimeout(id);
  }, [intervalMs]);
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/hooks/useAutoRefresh.ts
git commit -m "feat(web): add useAutoRefresh hook (5s recursive setTimeout)"
```

---

## Task 12: Settings page — auto-refresh fields

**Files:**
- Modify: `web/pages/Settings.tsx`

- [ ] **Step 1: Add auto-refresh fields to the settings card**

In `web/pages/Settings.tsx`, inside the first `<div className="card">` block (after the favorite-agent field), add:

```tsx
<div className="field">
  <label>Auto-refresh</label>
  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
    <input
      type="checkbox"
      checked={s.autoRefreshEnabled}
      onChange={async (e) => {
        try {
          setS(await api.updateSettings({ autoRefreshEnabled: e.target.checked }));
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    />
    Automatically fetch skills repos in the background
  </label>
</div>

<div className="field">
  <label>Refresh interval (minutes)</label>
  <input
    type="number"
    min={1}
    disabled={!s.autoRefreshEnabled}
    value={s.autoRefreshIntervalMinutes}
    onChange={async (e) => {
      const val = parseInt(e.target.value, 10);
      if (isNaN(val) || val < 1) return;
      try {
        setS(await api.updateSettings({ autoRefreshIntervalMinutes: val }));
      } catch (err) {
        setError((err as Error).message);
      }
    }}
    style={{ width: 80 }}
  />
</div>
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/pages/Settings.tsx
git commit -m "feat(web): add auto-refresh settings fields to Settings page"
```

---

## Task 13: ActivityLog page, route, and sidebar

**Files:**
- Create: `web/pages/ActivityLog.tsx`
- Modify: `web/routes.tsx`
- Modify: `web/components/Sidebar.tsx`

- [ ] **Step 1: Create the ActivityLog page**

Create `web/pages/ActivityLog.tsx`:

```tsx
import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { ActivityLogEntry, ActivityCategory } from "../api.ts";

const CATEGORY_LABELS: Record<ActivityCategory, string> = {
  "auto-update": "Auto-update",
  "install":     "Install",
  "uninstall":   "Uninstall",
  "re-apply":    "Re-apply",
  "refresh":     "Refresh",
};

const CATEGORY_STYLES: Record<ActivityCategory, React.CSSProperties> = {
  "auto-update": { background: "#cce5ff", color: "#004085" },
  "install":     { background: "#d4edda", color: "#155724" },
  "uninstall":   { background: "#f8d7da", color: "#721c24" },
  "re-apply":    { background: "#fff3cd", color: "#856404" },
  "refresh":     { background: "rgba(255,255,255,0.08)", color: "var(--muted)" },
};

function formatRelative(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export function ActivityLog() {
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [category, setCategory] = useState<ActivityCategory | "all">("all");
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api
      .getActivityLog({ category: category === "all" ? undefined : category })
      .then(setEntries)
      .catch((e) => setError((e as Error).message));
  };

  useEffect(load, [category]);

  const handleDelete = async (id: string) => {
    try {
      await api.deleteActivityLogEntry(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch {
      // silently ignore
    }
  };

  return (
    <>
      <h2 style={{ marginTop: 0 }}>Activity</h2>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>Filter:</label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as ActivityCategory | "all")}
          style={{ fontSize: 12 }}
        >
          <option value="all">All</option>
          {(Object.keys(CATEGORY_LABELS) as ActivityCategory[]).map((c) => (
            <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
          ))}
        </select>
      </div>

      {entries.length === 0 && <p style={{ color: "var(--muted)" }}>No activity yet.</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {entries.map((e) => (
          <div
            key={e.id}
            style={{
              display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
              background: "rgba(255,255,255,0.03)", borderRadius: 4, fontSize: 12,
            }}
          >
            <span style={{ color: "var(--muted)", minWidth: 72, flexShrink: 0 }}>
              {formatRelative(e.ts)}
            </span>
            <span style={{
              ...CATEGORY_STYLES[e.category],
              padding: "1px 7px", borderRadius: 10,
              fontWeight: 600, whiteSpace: "nowrap", fontSize: 11,
            }}>
              {CATEGORY_LABELS[e.category]}
            </span>
            <span style={{ flex: 1 }}>{e.summary}</span>
            {e.detail && (
              <span style={{ color: "var(--muted)", fontFamily: "monospace", fontSize: 11 }}>
                {e.detail}
              </span>
            )}
            <button
              title="Delete entry"
              onClick={() => handleDelete(e.id)}
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: "var(--muted)", padding: "2px 6px", fontSize: 13, lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Register the route**

In `web/routes.tsx`, add the import:

```tsx
import { ActivityLog } from "./pages/ActivityLog.tsx";
```

And inside `AppRoutes`, add:

```tsx
<Route path="/activity" element={<ActivityLog />} />
```

- [ ] **Step 3: Add sidebar link**

In `web/components/Sidebar.tsx`, add after the Settings link:

```tsx
<NavLink to="/activity" className={({ isActive }) => (isActive ? "active" : "")}>Activity</NavLink>
```

- [ ] **Step 4: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add web/pages/ActivityLog.tsx web/routes.tsx web/components/Sidebar.tsx
git commit -m "feat(web): add Activity page with category filter and per-entry delete"
```

---

## Task 14: Dashboard activity panel and auto-refresh

**Files:**
- Modify: `web/pages/Dashboard.tsx`

- [ ] **Step 1: Add activity panel and useAutoRefresh to Dashboard**

In `web/pages/Dashboard.tsx`:

Add these imports (the `Link` import from `react-router-dom` is already present — only add the new ones):

```tsx
import { useAutoRefresh } from "../hooks/useAutoRefresh.ts";
import type { ActivityLogEntry, ActivityCategory } from "../api.ts";
```

Add state variables after the existing state declarations:

```tsx
const [activityEntries, setActivityEntries] = useState<ActivityLogEntry[]>([]);
const [activityCategory, setActivityCategory] = useState<ActivityCategory | "all">("all");
```

In the `load` function, add the activity log fetch inside the `Promise.all` or after it:

```tsx
const load = async () => {
  try {
    const [notifs, wr, srcs] = await Promise.all([
      api.getNotifications(),
      api.listWorkingRepos(),
      api.listSkillsRepos(),
    ]);
    setNewArtifacts(notifs.newArtifacts);
    setWorking(wr);
    setSources(srcs);
    const map: Record<string, InstallWithStatus[]> = {};
    await Promise.all(
      wr.map(async (w) => {
        map[w.id] = await api.listInstallsByWorkingRepo(w.id);
      }),
    );
    setInstallsByWr(map);
    const log = await api.getActivityLog({
      limit: 10,
      category: activityCategory === "all" ? undefined : activityCategory,
    });
    setActivityEntries(log);
  } catch (e) {
    setError((e as Error).message);
  }
};
```

Add `useAutoRefresh(load)` after the existing `useEffect`:

```tsx
useAutoRefresh(load);
```

Add the activity panel constants near the top of the component (after state declarations):

```tsx
const ACTIVITY_LABELS: Record<ActivityCategory, string> = {
  "auto-update": "Auto-update",
  "install":     "Install",
  "uninstall":   "Uninstall",
  "re-apply":    "Re-apply",
  "refresh":     "Refresh",
};

const ACTIVITY_STYLES: Record<ActivityCategory, React.CSSProperties> = {
  "auto-update": { background: "#cce5ff", color: "#004085" },
  "install":     { background: "#d4edda", color: "#155724" },
  "uninstall":   { background: "#f8d7da", color: "#721c24" },
  "re-apply":    { background: "#fff3cd", color: "#856404" },
  "refresh":     { background: "rgba(255,255,255,0.08)", color: "var(--muted)" },
};

function formatRelative(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}
```

Add the delete handler:

```tsx
const handleDeleteActivity = async (id: string) => {
  try {
    await api.deleteActivityLogEntry(id);
    setActivityEntries((prev) => prev.filter((e) => e.id !== id));
  } catch {
    // silently ignore
  }
};
```

Add the activity panel at the bottom of the return, after the SKILLS REPOS section and before the `InstallModal`:

```tsx
<section style={{ marginTop: 28 }}>
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
    <span style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.05em" }}>RECENT ACTIVITY</span>
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <select
        value={activityCategory}
        onChange={(e) => {
          const cat = e.target.value as ActivityCategory | "all";
          setActivityCategory(cat);
          api.getActivityLog({ limit: 10, category: cat === "all" ? undefined : cat })
            .then(setActivityEntries)
            .catch(() => {});
        }}
        style={{ fontSize: 11 }}
      >
        <option value="all">All</option>
        {(Object.keys(ACTIVITY_LABELS) as ActivityCategory[]).map((c) => (
          <option key={c} value={c}>{ACTIVITY_LABELS[c]}</option>
        ))}
      </select>
      <Link to="/activity" style={{ fontSize: 11, color: "var(--muted)" }}>View all →</Link>
    </div>
  </div>
  {activityEntries.length === 0 && (
    <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>No activity yet.</p>
  )}
  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
    {activityEntries.map((e) => (
      <div
        key={e.id}
        style={{
          display: "flex", alignItems: "center", gap: 10, padding: "7px 12px",
          background: "rgba(255,255,255,0.03)", borderRadius: 4, fontSize: 12,
        }}
      >
        <span style={{ color: "var(--muted)", minWidth: 72, flexShrink: 0 }}>
          {formatRelative(e.ts)}
        </span>
        <span style={{
          ...ACTIVITY_STYLES[e.category],
          padding: "1px 7px", borderRadius: 10, fontWeight: 600, whiteSpace: "nowrap", fontSize: 11,
        }}>
          {ACTIVITY_LABELS[e.category]}
        </span>
        <span style={{ flex: 1 }}>{e.summary}</span>
        {e.detail && (
          <span style={{ color: "var(--muted)", fontFamily: "monospace", fontSize: 11 }}>
            {e.detail}
          </span>
        )}
        <button
          title="Delete entry"
          onClick={() => handleDeleteActivity(e.id)}
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: "var(--muted)", padding: "2px 6px", fontSize: 13, lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>
    ))}
  </div>
</section>
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/pages/Dashboard.tsx
git commit -m "feat(web): add activity panel and 5s auto-refresh to Dashboard"
```

---

## Task 15: Add useAutoRefresh to Browse and WorkingRepoDetail

**Files:**
- Modify: `web/pages/Browse.tsx`
- Modify: `web/pages/WorkingRepoDetail.tsx`

- [ ] **Step 1: Add useAutoRefresh to Browse**

In `web/pages/Browse.tsx`, add the import:

```tsx
import { useAutoRefresh } from "../hooks/useAutoRefresh.ts";
```

Extract the fetch logic into a named callback and call `useAutoRefresh`. The current `useEffect` in Browse uses an `AbortController` tied to `q` changes — keep that for search, and add a separate `useAutoRefresh` call for re-fetching on an interval:

After the existing `useEffect`, add:

```tsx
useAutoRefresh(() => {
  const ac = new AbortController();
  api.listArtifacts({ q: q || undefined }, ac.signal)
    .then(setArtifacts)
    .catch(() => {});
});
```

- [ ] **Step 2: Add useAutoRefresh to WorkingRepoDetail**

In `web/pages/WorkingRepoDetail.tsx`, add the import:

```tsx
import { useAutoRefresh } from "../hooks/useAutoRefresh.ts";
```

After the existing `useEffect(reload, [id])`, add:

```tsx
useAutoRefresh(reload);
```

- [ ] **Step 3: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add web/pages/Browse.tsx web/pages/WorkingRepoDetail.tsx
git commit -m "feat(web): add 5s auto-refresh polling to Browse and WorkingRepoDetail"
```

---

## Done

All tasks complete. The feature delivers:
- A backend refresh loop on a user-configured interval (default 30 min)
- A persistent `ActivityLogStore` capped at 500 entries
- All write operations instrumented with categorized activity log entries
- `GET /api/activity-log` (with category + limit filters) and `DELETE /api/activity-log/:id`
- Settings page with auto-refresh toggle and interval input
- `useAutoRefresh` hook (5 s fixed) applied to Dashboard, Browse, and WorkingRepoDetail
- Full Activity page at `/activity` with category filter and per-entry delete
- Dashboard activity panel showing 10 most recent entries with "View all" link
