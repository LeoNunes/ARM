# Slice 4 — Dashboard Polish & Diff Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the dashboard with new-skill notification cards, working-repo notification dots, and skills-repo thin list; add new-artifact detection with dismissal persistence; build a full-page diff viewer supporting three comparison modes.

**Architecture:** Two new JSON state stores (`dismissed-notifications.json`, `artifact-snapshots.json`) power the notification system. `GET /api/notifications` computes new-artifact candidates live by diffing current discovery against the snapshot. `GET /api/diff` loads file contents at two SHAs (or one SHA + working-repo disk file for drift) and returns full per-file from/to content. The `/diff` route hosts a React page using `react-diff-viewer-continued` for side-by-side rendering.

**Tech Stack:** Fastify + TypeScript + simple-git (existing); React 18 + Vite + `react-diff-viewer-continued` (new dependency); Vitest + React Testing Library (FE tests); real git + tmp dirs (integration tests).

---

## Key types referenced throughout

```typescript
// src/state/notifications.ts
export class DismissedNotificationsStore { /* see Task 2 */ }

// src/state/artifact-snapshots.ts
export class ArtifactSnapshotsStore { /* see Task 3 */ }

// src/api/notifications.ts  — GET /api/notifications response
export interface NewArtifactNotification {
  kind: "new-artifact";
  key: string;              // "newArtifact:<sourceRepoId>:<artifactKey>:<sha>"
  artifactKey: string;
  sourceRepoId: string;
  sourceName: string;
  sha: string;
  name: string;
  description: string | null;
}
export interface NotificationsResponse {
  newArtifacts: NewArtifactNotification[];
}

// src/api/diff.ts  — GET /api/diff response
export interface FileDiff {
  path: string;
  fromContent: string | null;
  toContent: string | null;
  changed: boolean;
}
export interface DiffResponse {
  artifactKey: string;
  artifactName: string;
  fromSha: string;
  toSha: string;         // "working-repo" sentinel for installed-vs-drifted
  mode: "version-vs-version" | "installed-vs-latest" | "installed-vs-drifted";
  label: string;
  files: FileDiff[];
  primaryAction: "update" | "re-apply" | null;
  installId: string | null;
}

// web/api.ts additions
export type DiffMode = "version-vs-version" | "installed-vs-latest" | "installed-vs-drifted";
export interface NewArtifactNotification { /* same as backend */ }
export interface NotificationsResponse { newArtifacts: NewArtifactNotification[]; }
export interface FileDiff { path: string; fromContent: string|null; toContent: string|null; changed: boolean; }
export interface DiffResponse { artifactKey: string; artifactName: string; fromSha: string; toSha: string; mode: DiffMode; label: string; files: FileDiff[]; primaryAction: "update"|"re-apply"|null; installId: string|null; }
export interface CommitSummary { sha: string; date: string; subject: string; }
```

---

## File Structure

### New files
| Path | Responsibility |
|------|---------------|
| `src/state/notifications.ts` | `DismissedNotificationsStore` — persists dismissed notification keys |
| `src/state/artifact-snapshots.ts` | `ArtifactSnapshotsStore` — persists "known" artifact keys per source repo |
| `src/api/notifications.ts` | `GET /api/notifications`, `POST /api/notifications/dismiss` |
| `src/api/diff.ts` | `GET /api/diff` — returns per-file from/to content for all three modes |
| `web/pages/Diff.tsx` | Full-page diff view: file list pane + side-by-side diff pane |
| `tests/unit/notifications-stores.test.ts` | Unit tests for both state stores |
| `tests/unit/dashboard.test.tsx` | Dashboard component tests |
| `tests/unit/diff-view.test.tsx` | Diff page component tests |
| `tests/integration/notifications-api.test.ts` | Integration tests for GET/POST /api/notifications |
| `tests/integration/diff-api.test.ts` | Integration tests for GET /api/diff |

### Modified files
| Path | Change |
|------|--------|
| `src/api/artifacts.ts` | Add `?sha=` to files/* endpoint; add `GET /api/artifacts/:key/history` |
| `src/api/installs.ts` | Add `POST /api/installs/:id/reapply`; add snapshot update on install |
| `src/api/routes.ts` | Register notifications + diff routes |
| `src/api/skills-repos.ts` | Call `initSnapshot` on register |
| `src/server.ts` | Add `snapshots`, `dismissed` to `ServerDeps` |
| `src/index.ts` | Instantiate new stores |
| `web/api.ts` | Add `getNotifications`, `dismissNotification`, `getDiff`, `getArtifactHistory`, `reapplyInstall` |
| `web/pages/Dashboard.tsx` | Full rewrite: new-skill cards + working-repo cards w/ dot + skills-repo list |
| `web/pages/WorkingRepoDetail.tsx` | Add "View diff" link-buttons for update-available and drifted installs |
| `web/routes.tsx` | Add `/diff` route |
| `package.json` | Add `react-diff-viewer-continued` |

---

## Task 1: Install react-diff-viewer-continued

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json` (auto-generated)

- [ ] **Step 1.1: Install the package**

```bash
cd /workspace && npm install react-diff-viewer-continued
```

Expected output: `added N packages` (no errors).

- [ ] **Step 1.2: Verify TypeScript can resolve it**

```bash
cd /workspace && npx tsc -p tsconfig.fe.json --noEmit 2>&1 | head -20
```

Expected: zero errors about `react-diff-viewer-continued`.

- [ ] **Step 1.3: Commit**

```bash
cd /workspace && git add package.json package-lock.json
git commit -m "chore: add react-diff-viewer-continued dependency"
```

---

## Task 2: DismissedNotificationsStore

**Files:**
- Create: `src/state/notifications.ts`
- Create: `tests/unit/notifications-stores.test.ts`

- [ ] **Step 2.1: Write the failing tests**

Create `tests/unit/notifications-stores.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DismissedNotificationsStore } from "../../src/state/notifications.ts";

describe("DismissedNotificationsStore", () => {
  let dir: string;
  let store: DismissedNotificationsStore;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "notif-test-"));
    store = new DismissedNotificationsStore(dir);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("isDismissed returns false for unknown key", async () => {
    expect(await store.isDismissed("newArtifact:r1:k1:sha1")).toBe(false);
  });

  it("dismiss persists a key", async () => {
    await store.dismiss("newArtifact:r1:k1:sha1");
    expect(await store.isDismissed("newArtifact:r1:k1:sha1")).toBe(true);
  });

  it("listDismissed returns all dismissed keys", async () => {
    await store.dismiss("key1");
    await store.dismiss("key2");
    const set = await store.listDismissed();
    expect(set.has("key1")).toBe(true);
    expect(set.has("key2")).toBe(true);
    expect(set.size).toBe(2);
  });

  it("dismiss is idempotent", async () => {
    await store.dismiss("key1");
    await store.dismiss("key1");
    const set = await store.listDismissed();
    expect(set.size).toBe(1);
  });
});
```

- [ ] **Step 2.2: Run tests to verify they fail**

```bash
cd /workspace && npx vitest run tests/unit/notifications-stores.test.ts 2>&1 | tail -10
```

Expected: FAIL — `DismissedNotificationsStore` not found.

- [ ] **Step 2.3: Implement DismissedNotificationsStore**

Create `src/state/notifications.ts`:

```typescript
import path from "node:path";
import { JsonStore } from "./store.js";

export class DismissedNotificationsStore {
  private store: JsonStore<Record<string, boolean>>;

  constructor(stateDir: string) {
    this.store = new JsonStore<Record<string, boolean>>(
      path.join(stateDir, "dismissed-notifications.json"),
      {},
    );
  }

  async isDismissed(key: string): Promise<boolean> {
    const data = await this.store.read();
    return !!data[key];
  }

  async dismiss(key: string): Promise<void> {
    const data = await this.store.read();
    data[key] = true;
    await this.store.write(data);
  }

  async listDismissed(): Promise<Set<string>> {
    const data = await this.store.read();
    return new Set(Object.keys(data));
  }
}
```

- [ ] **Step 2.4: Run tests to verify they pass**

```bash
cd /workspace && npx vitest run tests/unit/notifications-stores.test.ts 2>&1 | tail -10
```

Expected: PASS — all 4 tests pass.

---

## Task 3: ArtifactSnapshotsStore

**Files:**
- Create: `src/state/artifact-snapshots.ts`
- Modify: `tests/unit/notifications-stores.test.ts` (add snapshot tests)

- [ ] **Step 3.1: Add snapshot tests to notifications-stores.test.ts**

Append to `tests/unit/notifications-stores.test.ts`:

```typescript
import { ArtifactSnapshotsStore } from "../../src/state/artifact-snapshots.ts";

describe("ArtifactSnapshotsStore", () => {
  let dir: string;
  let store: ArtifactSnapshotsStore;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "snap-test-"));
    store = new ArtifactSnapshotsStore(dir);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("getSnapshot returns empty set for unknown repo", async () => {
    const snap = await store.getSnapshot("r1");
    expect(snap.size).toBe(0);
  });

  it("initSnapshot seeds the snapshot if not present", async () => {
    await store.initSnapshot("r1", ["r1:foo", "r1:bar"]);
    const snap = await store.getSnapshot("r1");
    expect(snap.has("r1:foo")).toBe(true);
    expect(snap.has("r1:bar")).toBe(true);
  });

  it("initSnapshot does not overwrite existing snapshot", async () => {
    await store.initSnapshot("r1", ["r1:foo"]);
    await store.initSnapshot("r1", ["r1:bar"]);
    const snap = await store.getSnapshot("r1");
    expect(snap.has("r1:foo")).toBe(true);
    expect(snap.has("r1:bar")).toBe(false);
  });

  it("addToSnapshot adds keys to existing snapshot", async () => {
    await store.initSnapshot("r1", ["r1:foo"]);
    await store.addToSnapshot("r1", ["r1:bar"]);
    const snap = await store.getSnapshot("r1");
    expect(snap.has("r1:foo")).toBe(true);
    expect(snap.has("r1:bar")).toBe(true);
  });

  it("addToSnapshot creates snapshot if none exists", async () => {
    await store.addToSnapshot("r1", ["r1:baz"]);
    const snap = await store.getSnapshot("r1");
    expect(snap.has("r1:baz")).toBe(true);
  });

  it("getSnapshotOrInit seeds and returns wasInitialized=true on first call", async () => {
    const result = await store.getSnapshotOrInit("r1", ["r1:foo", "r1:bar"]);
    expect(result.wasInitialized).toBe(true);
    expect(result.snapshot.has("r1:foo")).toBe(true);
  });

  it("getSnapshotOrInit returns wasInitialized=false when snapshot exists", async () => {
    await store.initSnapshot("r1", ["r1:foo"]);
    const result = await store.getSnapshotOrInit("r1", ["r1:foo", "r1:bar"]);
    expect(result.wasInitialized).toBe(false);
    expect(result.snapshot.has("r1:foo")).toBe(true);
    expect(result.snapshot.has("r1:bar")).toBe(false);
  });
});
```

- [ ] **Step 3.2: Run tests to verify new tests fail**

```bash
cd /workspace && npx vitest run tests/unit/notifications-stores.test.ts 2>&1 | tail -10
```

Expected: FAIL — `ArtifactSnapshotsStore` not found.

- [ ] **Step 3.3: Implement ArtifactSnapshotsStore**

Create `src/state/artifact-snapshots.ts`:

```typescript
import path from "node:path";
import { JsonStore } from "./store.js";

export class ArtifactSnapshotsStore {
  private store: JsonStore<Record<string, string[]>>;

  constructor(stateDir: string) {
    this.store = new JsonStore<Record<string, string[]>>(
      path.join(stateDir, "artifact-snapshots.json"),
      {},
    );
  }

  async getSnapshot(sourceRepoId: string): Promise<Set<string>> {
    const all = await this.store.read();
    return new Set(all[sourceRepoId] ?? []);
  }

  async initSnapshot(sourceRepoId: string, keys: string[]): Promise<void> {
    const all = await this.store.read();
    if (all[sourceRepoId] === undefined) {
      all[sourceRepoId] = [...new Set(keys)];
      await this.store.write(all);
    }
  }

  async addToSnapshot(sourceRepoId: string, keys: string[]): Promise<void> {
    const all = await this.store.read();
    const existing = new Set(all[sourceRepoId] ?? []);
    for (const k of keys) existing.add(k);
    all[sourceRepoId] = [...existing];
    await this.store.write(all);
  }

  async getSnapshotOrInit(
    sourceRepoId: string,
    currentKeys: string[],
  ): Promise<{ snapshot: Set<string>; wasInitialized: boolean }> {
    const all = await this.store.read();
    if (all[sourceRepoId] === undefined) {
      all[sourceRepoId] = [...new Set(currentKeys)];
      await this.store.write(all);
      return { snapshot: new Set(currentKeys), wasInitialized: true };
    }
    return { snapshot: new Set(all[sourceRepoId]), wasInitialized: false };
  }
}
```

- [ ] **Step 3.4: Run all store tests**

```bash
cd /workspace && npx vitest run tests/unit/notifications-stores.test.ts 2>&1 | tail -10
```

Expected: PASS — all 11 tests pass.

- [ ] **Step 3.5: Commit**

```bash
cd /workspace && git add src/state/notifications.ts src/state/artifact-snapshots.ts tests/unit/notifications-stores.test.ts
git commit -m "feat(state): add DismissedNotificationsStore and ArtifactSnapshotsStore"
```

---

## Task 4: Wire new stores into ServerDeps

**Files:**
- Modify: `src/server.ts`
- Modify: `src/index.ts`

- [ ] **Step 4.1: Add stores to ServerDeps**

In `src/server.ts`, add imports and extend the interface:

```typescript
// add these imports near the top (after existing state imports):
import type { ArtifactSnapshotsStore } from './state/artifact-snapshots';
import type { DismissedNotificationsStore } from './state/notifications';

// extend ServerDeps:
export interface ServerDeps {
  stateDir: string;
  cacheDir: string;
  settings: SettingsStore;
  skillsRepos: SkillsRepoStore;
  workingRepos: WorkingRepoStore;
  installs: InstallsStore;
  registries: ReturnType<typeof buildRegistries>;
  snapshots: ArtifactSnapshotsStore;        // NEW
  dismissed: DismissedNotificationsStore;   // NEW
}
```

- [ ] **Step 4.2: Instantiate stores in src/index.ts**

In `src/index.ts`, add imports and instantiation before `buildServer`:

```typescript
// add these imports:
import { ArtifactSnapshotsStore } from './state/artifact-snapshots';
import { DismissedNotificationsStore } from './state/notifications';

// inside main(), after existing store instantiations:
const snapshots = new ArtifactSnapshotsStore(stateDir);
const dismissed = new DismissedNotificationsStore(stateDir);

// pass to buildServer:
const app = await buildServer({
  stateDir, cacheDir, settings, skillsRepos, workingRepos, installs, registries,
  snapshots, dismissed,
});
```

- [ ] **Step 4.3: Verify TypeScript compiles**

```bash
cd /workspace && npx tsc -p tsconfig.be.json --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 4.4: Commit**

```bash
cd /workspace && git add src/server.ts src/index.ts
git commit -m "feat(server): add snapshots and dismissed stores to ServerDeps"
```

---

## Task 5: Extend artifacts API — history endpoint + sha param

**Files:**
- Modify: `src/api/artifacts.ts`

- [ ] **Step 5.1: Add sha-param support and history endpoint**

Replace the file content of `src/api/artifacts.ts`. The key changes:
1. `/api/artifacts/:artifactKey/files/*` now accepts optional `?sha=` query param
2. New `GET /api/artifacts/:artifactKey/history?limit=N`

```typescript
import type { FastifyInstance } from "fastify";
import type { ServerDeps } from '../server';
import { discoverArtifacts } from '../discovery/discover';
import { readFileAtSha } from '../git/show';
import { recentShasTouching } from '../git/log';
import { GitClient } from '../git/client';
import { AppError } from '../util/errors';
import type { DiscoveredArtifact } from '../adapters/types';

export async function registerArtifactsRoutes(app: FastifyInstance, deps: ServerDeps): Promise<void> {
  app.get<{ Querystring: { q?: string; type?: string; sourceRepoId?: string } }>(
    "/api/artifacts",
    async (req) => {
      const all = await discoverAll(deps);
      const { q, type, sourceRepoId } = req.query ?? {};
      return all.filter((a) => {
        if (sourceRepoId && a.sourceRepoId !== sourceRepoId) return false;
        if (type && a.type !== type) return false;
        if (q) {
          const needle = q.toLowerCase();
          if (!a.name.toLowerCase().includes(needle) && !(a.description ?? "").toLowerCase().includes(needle)) {
            return false;
          }
        }
        return true;
      });
    },
  );

  app.get<{ Params: { artifactKey: string } }>("/api/artifacts/:artifactKey", async (req, reply) => {
    const a = (await discoverAll(deps)).find((x) => x.artifactKey === decodeURIComponent(req.params.artifactKey));
    if (!a) return reply.code(404).send({ code: "artifact_not_found" });
    return a;
  });

  app.get<{ Params: { artifactKey: string; "*": string }; Querystring: { sha?: string } }>(
    "/api/artifacts/:artifactKey/files/*",
    async (req, reply) => {
      const key = decodeURIComponent(req.params.artifactKey);
      const filePath = (req.params as Record<string, string>)["*"] as string;
      const artifact = (await discoverAll(deps)).find((a) => a.artifactKey === key);
      if (!artifact) return reply.code(404).send({ code: "artifact_not_found" });
      if (!artifact.files.includes(filePath)) {
        throw new AppError("bad_input", `file not in artifact: ${filePath}`);
      }
      const repo = await deps.skillsRepos.get(artifact.sourceRepoId);
      if (!repo) return reply.code(404).send({ code: "skills_repo_not_found" });
      const sha = req.query.sha ?? artifact.lastTouchedSha ?? await new GitClient().headSha(repo.localClonePath, repo.branch);
      const content = await readFileAtSha(repo.localClonePath, sha, filePath);
      reply.header("content-type", "text/plain; charset=utf-8");
      return content;
    },
  );

  app.get<{ Params: { artifactKey: string }; Querystring: { limit?: string } }>(
    "/api/artifacts/:artifactKey/history",
    async (req, reply) => {
      const key = decodeURIComponent(req.params.artifactKey);
      const artifact = (await discoverAll(deps)).find((a) => a.artifactKey === key);
      if (!artifact) return reply.code(404).send({ code: "artifact_not_found" });
      const repo = await deps.skillsRepos.get(artifact.sourceRepoId);
      if (!repo) return reply.code(404).send({ code: "skills_repo_not_found" });
      const limit = Math.min(parseInt(req.query.limit ?? "20", 10) || 20, 100);
      const history = await recentShasTouching(repo.localClonePath, repo.branch, artifact.files, limit);
      return history;
    },
  );
}

async function discoverAll(deps: ServerDeps): Promise<DiscoveredArtifact[]> {
  const sources = await deps.skillsRepos.list();
  const out: DiscoveredArtifact[]  = [];
  for (const s of sources) out.push(...(await discoverArtifacts(s, deps.registries.types)));
  return out;
}
```

- [ ] **Step 5.2: Verify TypeScript compiles**

```bash
cd /workspace && npx tsc -p tsconfig.be.json --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 5.3: Commit**

```bash
cd /workspace && git add src/api/artifacts.ts
git commit -m "feat(api): add artifact history endpoint and sha param to file reads"
```

---

## Task 6: Notifications API

**Files:**
- Create: `src/api/notifications.ts`
- Create: `tests/integration/notifications-api.test.ts`

- [ ] **Step 6.1: Write the failing integration test**

Create `tests/integration/notifications-api.test.ts`:

```typescript
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
import { makeTmpDir } from "../helpers/tmp-dir.ts";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let stateDir: string;
let cacheDir: string;
let snapshots: ArtifactSnapshotsStore;
let dismissed: DismissedNotificationsStore;

async function setup() {
  stateDir = await makeTmpDir("notif-api-state-");
  cacheDir = await makeTmpDir("notif-api-cache-");
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
    const { repoPath } = await buildFixtureRepo([
      { message: "init", files: { "skills/foo/SKILL.md": "# foo" } },
    ]);
    // Register repo
    const regRes = await app.inject({
      method: "POST", url: "/api/skills-repos",
      payload: { name: "test", gitUrl: `file://${repoPath}`, branch: "main", artifactPaths: { skills: ["skills"] } },
    });
    expect(regRes.statusCode).toBe(201);

    const res = await app.inject({ method: "GET", url: "/api/notifications" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // After registration, snapshot is seeded → no new artifacts
    expect(body.newArtifacts).toHaveLength(0);
  });

  it("surfaces new artifact when key appears after snapshot seeded", async () => {
    const { repoPath } = await buildFixtureRepo([
      { message: "init", files: { "skills/foo/SKILL.md": "# foo" } },
    ]);
    const regRes = await app.inject({
      method: "POST", url: "/api/skills-repos",
      payload: { name: "test", gitUrl: `file://${repoPath}`, branch: "main", artifactPaths: { skills: ["skills"] } },
    });
    const sourceRepoId = JSON.parse(regRes.body).id;

    // Manually clear the snapshot to simulate a new artifact appearing
    await snapshots.initSnapshot(sourceRepoId, []); // won't overwrite because it's already set
    // Force-clear it using the store internals would require direct file write.
    // Instead, we add a known key to the snapshot, then check a key NOT in snapshot appears as new.
    // Simulate: snapshot has "foo" but not "bar" — we add "bar" to discovered artifacts.
    // The easiest way: we know the source has "foo" in snapshot from registration.
    // Make snapshot NOT include one artifact by constructing a fresh store with only some keys.
    const { JsonStore } = await import("../../src/state/store.ts");
    const path = await import("node:path");
    const snapshotFile = path.join(stateDir, "artifact-snapshots.json");
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
    const { repoPath } = await buildFixtureRepo([
      { message: "init", files: { "skills/foo/SKILL.md": "# foo" } },
    ]);
    const regRes = await app.inject({
      method: "POST", url: "/api/skills-repos",
      payload: { name: "test", gitUrl: `file://${repoPath}`, branch: "main", artifactPaths: { skills: ["skills"] } },
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
```

- [ ] **Step 6.2: Run test to verify it fails**

```bash
cd /workspace && npx vitest run tests/integration/notifications-api.test.ts 2>&1 | tail -15
```

Expected: FAIL — `registerNotificationsRoutes` not found / route 404.

- [ ] **Step 6.3: Implement notifications API**

Create `src/api/notifications.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import type { ServerDeps } from "../server.js";
import { discoverArtifacts } from "../discovery/discover.js";
import { AppError } from "../util/errors.js";

interface DismissBody {
  key: string;
}

export async function registerNotificationsRoutes(
  app: FastifyInstance,
  deps: ServerDeps,
): Promise<void> {
  app.get("/api/notifications", async () => {
    const sources = await deps.skillsRepos.list();
    const dismissedSet = await deps.dismissed.listDismissed();
    const newArtifacts: Array<{
      kind: "new-artifact";
      key: string;
      artifactKey: string;
      sourceRepoId: string;
      sourceName: string;
      sha: string;
      name: string;
      description: string | null;
    }> = [];

    for (const source of sources) {
      const artifacts = await discoverArtifacts(source, deps.registries.types);
      const currentKeys = artifacts.map((a) => a.artifactKey);
      const { snapshot, wasInitialized } = await deps.snapshots.getSnapshotOrInit(
        source.id,
        currentKeys,
      );
      if (wasInitialized) continue; // first time for this repo — all "known"

      for (const artifact of artifacts) {
        if (snapshot.has(artifact.artifactKey)) continue;
        const sha = artifact.lastTouchedSha ?? "unknown";
        const key = `newArtifact:${source.id}:${artifact.artifactKey}:${sha}`;
        if (dismissedSet.has(key)) continue;
        newArtifacts.push({
          kind: "new-artifact",
          key,
          artifactKey: artifact.artifactKey,
          sourceRepoId: source.id,
          sourceName: source.name,
          sha,
          name: artifact.name,
          description: artifact.description,
        });
      }
    }

    return { newArtifacts };
  });

  app.post<{ Body: DismissBody }>("/api/notifications/dismiss", async (req, reply) => {
    const { key } = req.body ?? ({} as DismissBody);
    if (!key || typeof key !== "string") throw new AppError("bad_input", "key required");
    await deps.dismissed.dismiss(key);
    // Extract artifactKey from key and add to snapshot so it won't re-appear as new
    // key format: "newArtifact:<sourceRepoId>:<artifactKey-parts>:<sha>"
    // artifactKey has colons too (sourceRepoId:relPath), so we must parse carefully
    const parts = key.split(":");
    if (parts[0] === "newArtifact" && parts.length >= 4) {
      const sourceRepoId = parts[1]!;
      // artifactKey = parts[2] joined with ":" then ":" then parts[3]
      // but artifactKey = "<sourceRepoId>:<relPath>" so parts 2 onward minus last sha
      // key = "newArtifact:<sourceRepoId>:<sourceRepoId>:<relPath>:<sha>"
      // We need to reconstruct artifactKey = everything between second and last colon groups
      // Simpler: artifactKey is the part after "newArtifact:<sourceRepoId>:" and before the trailing ":<sha>"
      // Given: key = "newArtifact:" + sourceRepoId + ":" + artifactKey + ":" + sha
      // and artifactKey = sourceRepoId + ":" + relPath
      // sha is last 40-char hex or "unknown" — just take everything after first 2 colons minus last segment
      const withoutPrefix = key.slice("newArtifact:".length + sourceRepoId.length + 1);
      const lastColon = withoutPrefix.lastIndexOf(":");
      const artifactKey = lastColon > 0 ? withoutPrefix.slice(0, lastColon) : withoutPrefix;
      await deps.snapshots.addToSnapshot(sourceRepoId, [artifactKey]);
    }
    return reply.code(204).send();
  });
}
```

- [ ] **Step 6.4: Register notifications routes in routes.ts**

In `src/api/routes.ts`, add:

```typescript
// Add import at the top:
import { registerNotificationsRoutes } from './notifications';

// Add call inside registerRoutes:
await registerNotificationsRoutes(app, deps);
```

- [ ] **Step 6.5: Run integration test**

```bash
cd /workspace && npx vitest run tests/integration/notifications-api.test.ts 2>&1 | tail -15
```

Expected: PASS — all 4 tests pass.

- [ ] **Step 6.6: Commit**

```bash
cd /workspace && git add src/api/notifications.ts src/api/routes.ts tests/integration/notifications-api.test.ts
git commit -m "feat(api): add notifications endpoints (GET/POST)"
```

---

## Task 7: Seed snapshot on skills-repo register

**Files:**
- Modify: `src/api/skills-repos.ts`

- [ ] **Step 7.1: Add initSnapshot call after register**

In `src/api/skills-repos.ts`, modify the `POST /api/skills-repos` handler. After `created.localClonePath = newPath;`, add:

```typescript
// After successfully creating the repo and updating the clone path:
const { discoverArtifacts } = await import('../discovery/discover.js');
const artifacts = await discoverArtifacts(created, deps.registries.types);
await deps.snapshots.initSnapshot(created.id, artifacts.map((a) => a.artifactKey));
```

The full updated handler (inside `app.post<{ Body: RegisterBody }>("..."` handler):

```typescript
app.post<{ Body: RegisterBody }>("/api/skills-repos", async (req, reply) => {
    const { name, gitUrl, branch = "main", artifactPaths = {}, presetId = null } = req.body ?? ({} as RegisterBody);
    if (!name || !gitUrl) throw new AppError("bad_input", "name and gitUrl required");
    const tempId = newId();
    const localClonePath = await cloneIntoCache({ gitUrl, branch, cacheDir: deps.cacheDir, repoId: tempId });
    let created;
    try {
      created = await deps.skillsRepos.add({
        name, gitUrl, branch, artifactPaths, presetId, localClonePath,
        lastFetchedAt: new Date().toISOString(),
      });
      if (created.id !== tempId) {
        const { rename } = await import("node:fs/promises");
        const pathMod = await import("node:path");
        const newPath = pathMod.join(deps.cacheDir, created.id);
        await rename(localClonePath, newPath);
        await deps.skillsRepos.update(created.id, { localClonePath: newPath });
        created.localClonePath = newPath;
      }
      // Seed snapshot so existing artifacts don't appear as "new"
      const artifacts = await discoverArtifacts(created, deps.registries.types);
      await deps.snapshots.initSnapshot(created.id, artifacts.map((a) => a.artifactKey));
    } catch (err) {
      await removeClone(localClonePath).catch(() => {});
      throw err;
    }
    return reply.code(201).send(created);
  });
```

Also add `discoverArtifacts` import at the top of `src/api/skills-repos.ts`:

```typescript
import { discoverArtifacts } from '../discovery/discover';
```

- [ ] **Step 7.2: Verify TypeScript compiles**

```bash
cd /workspace && npx tsc -p tsconfig.be.json --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 7.3: Run all tests to confirm no regressions**

```bash
cd /workspace && npm test 2>&1 | tail -20
```

Expected: all tests pass (or pre-existing failures only, none new).

- [ ] **Step 7.4: Commit**

```bash
cd /workspace && git add src/api/skills-repos.ts
git commit -m "feat(api): seed artifact snapshot on skills-repo registration"
```

---

## Task 8: Diff API

**Files:**
- Create: `src/api/diff.ts`
- Create: `tests/integration/diff-api.test.ts`
- Modify: `src/api/routes.ts`
- Modify: `src/api/installs.ts` (add reapply endpoint)

- [ ] **Step 8.1: Write failing integration tests**

Create `tests/integration/diff-api.test.ts`:

```typescript
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
import { makeTmpDir } from "../helpers/tmp-dir.ts";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let stateDir: string;
let cacheDir: string;

async function setup() {
  stateDir = await makeTmpDir("diff-api-state-");
  cacheDir = await makeTmpDir("diff-api-cache-");
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
  it("returns per-file from/to content for two SHAs", async () => {
    const { repoPath, commits } = await buildFixtureRepo([
      { message: "v1", files: { "skills/foo/SKILL.md": "# Foo v1" } },
      { message: "v2", files: { "skills/foo/SKILL.md": "# Foo v2" } },
    ]);
    const regRes = await app.inject({
      method: "POST", url: "/api/skills-repos",
      payload: { name: "test", gitUrl: `file://${repoPath}`, branch: "main", artifactPaths: { skills: ["skills"] } },
    });
    const sourceRepoId = JSON.parse(regRes.body).id;
    const artifactKey = encodeURIComponent(`${sourceRepoId}:skills/foo`);
    const fromSha = commits[0]!;
    const toSha = commits[1]!;

    const res = await app.inject({
      method: "GET",
      url: `/api/diff?mode=version-vs-version&artifactKey=${artifactKey}&fromSha=${fromSha}&toSha=${toSha}`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.mode).toBe("version-vs-version");
    expect(body.fromSha).toBe(fromSha);
    expect(body.toSha).toBe(toSha);
    expect(body.primaryAction).toBeNull();
    expect(body.files.length).toBeGreaterThan(0);
    const skillFile = body.files.find((f: { path: string }) => f.path.includes("SKILL.md"));
    expect(skillFile).toBeTruthy();
    expect(skillFile.fromContent).toContain("v1");
    expect(skillFile.toContent).toContain("v2");
    expect(skillFile.changed).toBe(true);
  });
});

describe("GET /api/diff — installed-vs-latest", () => {
  it("returns installed vs latest content", async () => {
    const { repoPath, commits } = await buildFixtureRepo([
      { message: "v1", files: { "skills/foo/SKILL.md": "# Foo v1" } },
      { message: "v2", files: { "skills/foo/SKILL.md": "# Foo v2" } },
    ]);
    const regRes = await app.inject({
      method: "POST", url: "/api/skills-repos",
      payload: { name: "test", gitUrl: `file://${repoPath}`, branch: "main", artifactPaths: { skills: ["skills"] } },
    });
    const { id: sourceRepoId } = JSON.parse(regRes.body);
    const wrDir = await makeTmpDir("working-repo-");
    const { simpleGit } = await import("simple-git");
    await simpleGit().init(wrDir);
    await simpleGit(wrDir).raw(["commit", "--allow-empty", "-m", "init"]);
    const wrRes = await app.inject({
      method: "POST", url: "/api/working-repos",
      payload: { name: "wr", path: wrDir },
    });
    const { id: workingRepoId } = JSON.parse(wrRes.body);

    // Install at v1
    const artifactKey = `${sourceRepoId}:skills/foo`;
    const installRes = await app.inject({
      method: "POST", url: "/api/installs",
      payload: {
        artifactKey,
        target: { type: "working-repo", workingRepoId },
        agent: "claude-code",
        sha: commits[0]!,
      },
    });
    expect(installRes.statusCode).toBe(201);
    const installId = JSON.parse(installRes.body).id;

    const res = await app.inject({
      method: "GET",
      url: `/api/diff?mode=installed-vs-latest&installId=${installId}`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.mode).toBe("installed-vs-latest");
    expect(body.primaryAction).toBe("update");
    expect(body.installId).toBe(installId);
    const f = body.files.find((x: { path: string }) => x.path.includes("SKILL.md"));
    expect(f.fromContent).toContain("v1");
    expect(f.toContent).toContain("v2");
  });
});
```

- [ ] **Step 8.2: Run tests to verify they fail**

```bash
cd /workspace && npx vitest run tests/integration/diff-api.test.ts 2>&1 | tail -15
```

Expected: FAIL — route 404.

- [ ] **Step 8.3: Implement diff API**

Create `src/api/diff.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import type { ServerDeps } from "../server.js";
import { discoverArtifacts } from "../discovery/discover.js";
import { readFileAtSha, listFilesAtSha } from "../git/show.js";
import { lastSHATouching } from "../git/log.js";
import { AppError } from "../util/errors.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { checkForUpdates } from "../engine/update-check.js";

interface FileDiff {
  path: string;
  fromContent: string | null;
  toContent: string | null;
  changed: boolean;
}

interface DiffResponse {
  artifactKey: string;
  artifactName: string;
  fromSha: string;
  toSha: string;
  mode: "version-vs-version" | "installed-vs-latest" | "installed-vs-drifted";
  label: string;
  files: FileDiff[];
  primaryAction: "update" | "re-apply" | null;
  installId: string | null;
}

async function safeReadAtSha(clonePath: string, sha: string, filePath: string): Promise<string | null> {
  try {
    return await readFileAtSha(clonePath, sha, filePath);
  } catch {
    return null;
  }
}

async function safeReadFile(absPath: string): Promise<string | null> {
  try {
    return await readFile(absPath, "utf8");
  } catch {
    return null;
  }
}

export async function registerDiffRoutes(app: FastifyInstance, deps: ServerDeps): Promise<void> {
  app.get<{
    Querystring: {
      mode: string;
      installId?: string;
      artifactKey?: string;
      fromSha?: string;
      toSha?: string;
    };
  }>("/api/diff", async (req, reply) => {
    const { mode, installId, fromSha, toSha } = req.query;
    const artifactKeyParam = req.query.artifactKey ? decodeURIComponent(req.query.artifactKey) : undefined;

    if (mode === "version-vs-version") {
      if (!artifactKeyParam || !fromSha || !toSha) {
        throw new AppError("bad_input", "mode=version-vs-version requires artifactKey, fromSha, toSha");
      }
      const sources = await deps.skillsRepos.list();
      const allArtifacts = (await Promise.all(sources.map((s) => discoverArtifacts(s, deps.registries.types)))).flat();
      const artifact = allArtifacts.find((a) => a.artifactKey === artifactKeyParam);
      if (!artifact) return reply.code(404).send({ code: "artifact_not_found" });
      const repo = await deps.skillsRepos.get(artifact.sourceRepoId);
      if (!repo) return reply.code(404).send({ code: "skills_repo_not_found" });

      const filesFrom = await listFilesAtSha(repo.localClonePath, fromSha, artifact.rootRelativePath);
      const filesTo = await listFilesAtSha(repo.localClonePath, toSha, artifact.rootRelativePath);
      const allPaths = [...new Set([...filesFrom, ...filesTo])];

      const files: FileDiff[] = await Promise.all(
        allPaths.map(async (p) => {
          const fc = await safeReadAtSha(repo.localClonePath, fromSha, p);
          const tc = await safeReadAtSha(repo.localClonePath, toSha, p);
          return { path: p, fromContent: fc, toContent: tc, changed: fc !== tc };
        }),
      );

      const resp: DiffResponse = {
        artifactKey: artifact.artifactKey,
        artifactName: artifact.name,
        fromSha,
        toSha,
        mode: "version-vs-version",
        label: `${fromSha.slice(0, 7)} → ${toSha.slice(0, 7)}`,
        files,
        primaryAction: null,
        installId: null,
      };
      return resp;
    }

    if (mode === "installed-vs-latest") {
      if (!installId) throw new AppError("bad_input", "mode=installed-vs-latest requires installId");
      const install = await deps.installs.get(installId);
      if (!install) return reply.code(404).send({ code: "install_not_found" });
      const sr = await deps.skillsRepos.get(install.sourceRepoId);
      if (!sr) return reply.code(404).send({ code: "skills_repo_not_found" });

      const updateResult = await checkForUpdates(install, sr);
      const latestSha = updateResult.availableSha ?? await lastSHATouching(sr.localClonePath, sr.branch, install.installedFiles.map((f) => f.sourcePath)) ?? install.installedCommitSha;

      const files: FileDiff[] = await Promise.all(
        install.installedFiles.map(async (f) => {
          const fc = await safeReadAtSha(sr.localClonePath, install.installedCommitSha, f.sourcePath);
          const tc = await safeReadAtSha(sr.localClonePath, latestSha, f.sourcePath);
          return { path: f.sourcePath, fromContent: fc, toContent: tc, changed: fc !== tc };
        }),
      );

      const sources = await deps.skillsRepos.list();
      const allArtifacts = (await Promise.all(sources.map((s) => discoverArtifacts(s, deps.registries.types)))).flat();
      const artifact = allArtifacts.find((a) => a.artifactKey === install.artifactKey);

      const resp: DiffResponse = {
        artifactKey: install.artifactKey,
        artifactName: artifact?.name ?? install.artifactKey.split(":").pop() ?? install.artifactKey,
        fromSha: install.installedCommitSha,
        toSha: latestSha,
        mode: "installed-vs-latest",
        label: "installed vs latest",
        files,
        primaryAction: updateResult.hasUpdate ? "update" : null,
        installId,
      };
      return resp;
    }

    if (mode === "installed-vs-drifted") {
      if (!installId) throw new AppError("bad_input", "mode=installed-vs-drifted requires installId");
      const install = await deps.installs.get(installId);
      if (!install) return reply.code(404).send({ code: "install_not_found" });
      if (install.target.type !== "working-repo") {
        throw new AppError("bad_input", "installed-vs-drifted only supported for working-repo targets");
      }
      const sr = await deps.skillsRepos.get(install.sourceRepoId);
      if (!sr) return reply.code(404).send({ code: "skills_repo_not_found" });
      const wr = await deps.workingRepos.get(install.target.workingRepoId);
      if (!wr) return reply.code(404).send({ code: "working_repo_not_found" });

      const files: FileDiff[] = await Promise.all(
        install.installedFiles.map(async (f) => {
          const fc = await safeReadAtSha(sr.localClonePath, install.installedCommitSha, f.sourcePath);
          const tc = await safeReadFile(path.join(wr.path, f.targetPath));
          return { path: f.targetPath, fromContent: fc, toContent: tc, changed: fc !== tc };
        }),
      );

      const sources = await deps.skillsRepos.list();
      const allArtifacts = (await Promise.all(sources.map((s) => discoverArtifacts(s, deps.registries.types)))).flat();
      const artifact = allArtifacts.find((a) => a.artifactKey === install.artifactKey);

      const resp: DiffResponse = {
        artifactKey: install.artifactKey,
        artifactName: artifact?.name ?? install.artifactKey.split(":").pop() ?? install.artifactKey,
        fromSha: install.installedCommitSha,
        toSha: "working-repo",
        mode: "installed-vs-drifted",
        label: "installed vs current file",
        files,
        primaryAction: "re-apply",
        installId,
      };
      return resp;
    }

    throw new AppError("bad_input", "mode must be version-vs-version, installed-vs-latest, or installed-vs-drifted");
  });
}
```

- [ ] **Step 8.4: Register diff route in routes.ts**

In `src/api/routes.ts`, add:

```typescript
// Add import:
import { registerDiffRoutes } from './diff';

// Add call inside registerRoutes:
await registerDiffRoutes(app, deps);
```

- [ ] **Step 8.5: Add reapply endpoint to installs.ts**

In `src/api/installs.ts`, after the `app.delete` handler, add:

```typescript
  app.post<{ Params: { id: string } }>("/api/installs/:id/reapply", async (req, reply) => {
    const install = await deps.installs.get(req.params.id);
    if (!install) return reply.code(404).send({ code: "install_not_found" });
    if (install.target.type !== "working-repo") {
      throw new AppError("bad_input", "reapply only supported for working-repo targets");
    }
    const sr = await deps.skillsRepos.get(install.sourceRepoId);
    if (!sr) throw new AppError("skills_repo_not_found", install.sourceRepoId);
    const wr = await deps.workingRepos.get(install.target.workingRepoId);
    if (!wr) throw new AppError("working_repo_not_found", install.target.workingRepoId);
    const agent = deps.registries.agents.get(install.agent);
    const others = (await deps.installs.listByWorkingRepo(wr.id)).filter((i) => i.id !== install.id);
    const patch = await applyUpdate({
      install, skillsRepo: sr, workingRepo: wr,
      newSha: install.installedCommitSha, agent,
      otherInstallsInTarget: others,
    });
    const updated = await deps.installs.update(install.id, patch);
    return updated;
  });
```

- [ ] **Step 8.6: Run integration tests**

```bash
cd /workspace && npx vitest run tests/integration/diff-api.test.ts 2>&1 | tail -15
```

Expected: PASS — all 2 tests pass.

- [ ] **Step 8.7: Run full test suite**

```bash
cd /workspace && npm test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 8.8: Commit**

```bash
cd /workspace && git add src/api/diff.ts src/api/routes.ts src/api/installs.ts tests/integration/diff-api.test.ts
git commit -m "feat(api): add diff endpoint and install reapply endpoint"
```

---

## Task 9: Update web/api.ts with new methods

**Files:**
- Modify: `web/api.ts`

- [ ] **Step 9.1: Add new types and API methods**

Add these types and methods to `web/api.ts`. Insert the type declarations after the existing `InstallWithStatus` type, and add methods to the `api` object.

New types to add after `InstallWithStatus`:

```typescript
export type DiffMode = "version-vs-version" | "installed-vs-latest" | "installed-vs-drifted";

export interface NewArtifactNotification {
  kind: "new-artifact";
  key: string;
  artifactKey: string;
  sourceRepoId: string;
  sourceName: string;
  sha: string;
  name: string;
  description: string | null;
}

export interface NotificationsResponse {
  newArtifacts: NewArtifactNotification[];
}

export interface FileDiff {
  path: string;
  fromContent: string | null;
  toContent: string | null;
  changed: boolean;
}

export interface DiffResponse {
  artifactKey: string;
  artifactName: string;
  fromSha: string;
  toSha: string;
  mode: DiffMode;
  label: string;
  files: FileDiff[];
  primaryAction: "update" | "re-apply" | null;
  installId: string | null;
}

export interface CommitSummary {
  sha: string;
  date: string;
  subject: string;
}
```

New methods to add inside the `api` object (after `deleteInstall`):

```typescript
  reapplyInstall: (id: string) => req<Install>("POST", `/api/installs/${id}/reapply`),

  getNotifications: () => req<NotificationsResponse>("GET", "/api/notifications"),
  dismissNotification: (key: string) => req<void>("POST", "/api/notifications/dismiss", { key }),

  getDiff: (params:
    | { mode: "installed-vs-latest"; installId: string }
    | { mode: "installed-vs-drifted"; installId: string }
    | { mode: "version-vs-version"; artifactKey: string; fromSha: string; toSha: string }
  ) => {
    const qs = new URLSearchParams();
    qs.set("mode", params.mode);
    if (params.mode === "installed-vs-latest" || params.mode === "installed-vs-drifted") {
      qs.set("installId", params.installId);
    } else {
      qs.set("artifactKey", encodeURIComponent(params.artifactKey));
      qs.set("fromSha", params.fromSha);
      qs.set("toSha", params.toSha);
    }
    return req<DiffResponse>("GET", `/api/diff?${qs.toString()}`);
  },

  getArtifactHistory: (artifactKey: string, limit = 20) =>
    req<CommitSummary[]>("GET", `/api/artifacts/${encodeURIComponent(artifactKey)}/history?limit=${limit}`),
```

- [ ] **Step 9.2: Verify TypeScript compiles**

```bash
cd /workspace && npx tsc -p tsconfig.fe.json --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 9.3: Commit**

```bash
cd /workspace && git add web/api.ts
git commit -m "feat(web): add notifications, diff, and history API methods to api.ts"
```

---

## Task 10: Dashboard — new-skill notification cards

**Files:**
- Create: `tests/unit/dashboard.test.tsx`
- Modify: `web/pages/Dashboard.tsx`

- [ ] **Step 10.1: Write failing unit tests**

Create `tests/unit/dashboard.test.tsx`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";
import { Dashboard } from "../../web/pages/Dashboard.tsx";
import type { NewArtifactNotification, InstallWithStatus, WorkingRepo, SkillsRepo } from "../../web/api.ts";

afterEach(cleanup);

const mockNewArtifact: NewArtifactNotification = {
  kind: "new-artifact",
  key: "newArtifact:src1:src1:skills/foo:abc123",
  artifactKey: "src1:skills/foo",
  sourceRepoId: "src1",
  sourceName: "superpowers",
  sha: "abc123",
  name: "foo",
  description: "Does foo things.",
};

const mockWorkingRepo: WorkingRepo = {
  id: "w1", name: "my-app", path: "/home/dev/my-app", addedAt: "2024-01-01T00:00:00Z",
};

const mockInstall: InstallWithStatus = {
  id: "i1", artifactKey: "src1:skills/foo", sourceRepoId: "src1",
  target: { type: "working-repo", workingRepoId: "w1" },
  agent: "claude-code", artifactType: "skills",
  installedCommitSha: "abc123", autoUpdate: false,
  installedFiles: [], installedAt: "2024-01-01T00:00:00Z",
  status: "update-available", availableSha: "def456",
};

const mockSkillsRepo: SkillsRepo = {
  id: "src1", name: "superpowers",
  gitUrl: "https://github.com/example/superpowers",
  branch: "main",
  artifactPaths: { skills: ["skills"] },
  presetId: null,
  localClonePath: "/tmp/src1",
  lastFetchedAt: "2026-05-23T10:00:00Z",
};

function makeMockFetch(overrides: {
  newArtifacts?: NewArtifactNotification[];
  workingRepos?: WorkingRepo[];
  installs?: Record<string, InstallWithStatus[]>;
  skillsRepos?: SkillsRepo[];
  artifacts?: { artifactKey: string }[];
} = {}) {
  const {
    newArtifacts = [],
    workingRepos = [],
    installs = {},
    skillsRepos = [],
    artifacts = [],
  } = overrides;
  return vi.fn(async (url: string) => {
    if (url === "/api/notifications") return new Response(JSON.stringify({ newArtifacts }), { status: 200 });
    if (url === "/api/working-repos") return new Response(JSON.stringify(workingRepos), { status: 200 });
    if (url === "/api/skills-repos") return new Response(JSON.stringify(skillsRepos), { status: 200 });
    if (url.startsWith("/api/artifacts")) return new Response(JSON.stringify(artifacts), { status: 200 });
    const wrMatch = url.match(/\/api\/working-repos\/([^/]+)\/installs/);
    if (wrMatch) {
      const list = installs[wrMatch[1]!] ?? [];
      return new Response(JSON.stringify(list), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
}

function renderDashboard() {
  return render(<MemoryRouter><Dashboard /></MemoryRouter>);
}

describe("Dashboard — new-skill cards", () => {
  it("renders 'NEW SKILLS' section when there are new-artifact notifications", async () => {
    globalThis.fetch = makeMockFetch({ newArtifacts: [mockNewArtifact] });
    renderDashboard();
    expect(await screen.findByText("NEW SKILLS")).toBeTruthy();
    expect(await screen.findByText("foo")).toBeTruthy();
    expect(await screen.findByText("superpowers")).toBeTruthy();
    expect(await screen.findByText("Does foo things.")).toBeTruthy();
  });

  it("renders Install and Dismiss buttons for each card", async () => {
    globalThis.fetch = makeMockFetch({ newArtifacts: [mockNewArtifact] });
    renderDashboard();
    expect(await screen.findByRole("button", { name: "Install" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Dismiss" })).toBeTruthy();
  });

  it("does not render 'NEW SKILLS' section when there are no new notifications", async () => {
    globalThis.fetch = makeMockFetch({ newArtifacts: [] });
    renderDashboard();
    await screen.findByText("WORKING REPOS");
    expect(screen.queryByText("NEW SKILLS")).toBeNull();
  });

  it("calls dismiss API when Dismiss is clicked", async () => {
    const mockFetch = makeMockFetch({ newArtifacts: [mockNewArtifact] });
    globalThis.fetch = mockFetch;
    renderDashboard();
    const dismissBtn = await screen.findByRole("button", { name: "Dismiss" });
    fireEvent.click(dismissBtn);
    await screen.findByText("WORKING REPOS"); // wait for re-render
    // Dismiss was called
    const calls = mockFetch.mock.calls;
    const dismissCall = calls.find(([url, opts]: [string, RequestInit]) =>
      url === "/api/notifications/dismiss" && opts?.method === "POST"
    );
    expect(dismissCall).toBeTruthy();
  });
});

describe("Dashboard — working-repo cards", () => {
  it("renders working-repo card with name and path", async () => {
    globalThis.fetch = makeMockFetch({
      workingRepos: [mockWorkingRepo],
      installs: { w1: [mockInstall] },
    });
    renderDashboard();
    expect(await screen.findByText("my-app")).toBeTruthy();
    expect(await screen.findByText("/home/dev/my-app")).toBeTruthy();
  });

  it("renders notification dot when any install has non-up-to-date status", async () => {
    globalThis.fetch = makeMockFetch({
      workingRepos: [mockWorkingRepo],
      installs: { w1: [mockInstall] }, // status: update-available
    });
    renderDashboard();
    await screen.findByText("my-app");
    const dot = document.querySelector("[data-testid='notification-dot']");
    expect(dot).toBeTruthy();
  });

  it("does not render notification dot when all installs are up-to-date", async () => {
    globalThis.fetch = makeMockFetch({
      workingRepos: [mockWorkingRepo],
      installs: { w1: [{ ...mockInstall, status: "up-to-date", availableSha: null }] },
    });
    renderDashboard();
    await screen.findByText("my-app");
    const dot = document.querySelector("[data-testid='notification-dot']");
    expect(dot).toBeNull();
  });

  it("renders installed-skill chips", async () => {
    globalThis.fetch = makeMockFetch({
      workingRepos: [mockWorkingRepo],
      installs: { w1: [mockInstall] },
    });
    renderDashboard();
    // Chip shows last segment of artifactKey rel path
    expect(await screen.findByText("foo")).toBeTruthy();
  });
});

describe("Dashboard — skills-repo list", () => {
  it("renders SKILLS REPOS section with repo name", async () => {
    globalThis.fetch = makeMockFetch({ skillsRepos: [mockSkillsRepo] });
    renderDashboard();
    expect(await screen.findByText("SKILLS REPOS")).toBeTruthy();
    expect(await screen.findByText("superpowers")).toBeTruthy();
  });
});
```

- [ ] **Step 10.2: Run tests to verify they fail**

```bash
cd /workspace && npx vitest run tests/unit/dashboard.test.tsx 2>&1 | tail -15
```

Expected: FAIL — component doesn't have new-skill cards or notification dots.

- [ ] **Step 10.3: Rewrite Dashboard.tsx**

Replace `web/pages/Dashboard.tsx` with:

```tsx
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  api, NewArtifactNotification, WorkingRepo, SkillsRepo, InstallWithStatus, Artifact,
} from "../api.ts";
import { InstallModal } from "../components/InstallModal.tsx";

export function Dashboard() {
  const [newArtifacts, setNewArtifacts] = useState<NewArtifactNotification[]>([]);
  const [working, setWorking] = useState<WorkingRepo[]>([]);
  const [sources, setSources] = useState<SkillsRepo[]>([]);
  const [installsByWr, setInstallsByWr] = useState<Record<string, InstallWithStatus[]>>({});
  const [allArtifacts, setAllArtifacts] = useState<Artifact[]>([]);
  const [installTarget, setInstallTarget] = useState<string | null>(null); // artifactKey for InstallModal
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const load = async () => {
    try {
      const [notifs, wr, srcs, arts] = await Promise.all([
        api.getNotifications(),
        api.listWorkingRepos(),
        api.listSkillsRepos(),
        api.listArtifacts(),
      ]);
      setNewArtifacts(notifs.newArtifacts);
      setWorking(wr);
      setSources(srcs);
      setAllArtifacts(arts);
      const map: Record<string, InstallWithStatus[]> = {};
      await Promise.all(
        wr.map(async (w) => {
          map[w.id] = await api.listInstallsByWorkingRepo(w.id);
        }),
      );
      setInstallsByWr(map);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => { load(); }, []);

  const handleDismiss = async (key: string) => {
    try {
      await api.dismissNotification(key);
      setNewArtifacts((prev) => prev.filter((n) => n.key !== key));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const artifactCount = (sourceRepoId: string) =>
    allArtifacts.filter((a) => a.sourceRepoId === sourceRepoId).length;

  const hasNonUpToDate = (wrId: string) =>
    (installsByWr[wrId] ?? []).some((i) => i.status !== "up-to-date");

  return (
    <>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      <h2 style={{ marginTop: 0 }}>Dashboard</h2>

      {newArtifacts.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.05em" }}>NEW SKILLS</span>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>{newArtifacts.length} new · install or dismiss</span>
          </div>
          <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 }}>
            {newArtifacts.map((n) => (
              <div
                key={n.key}
                className="card"
                style={{ minWidth: 180, maxWidth: 180, padding: 10, fontSize: 11 }}
              >
                <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 2 }}>{n.name}</div>
                <div style={{ color: "var(--muted)", marginBottom: 8 }}>{n.sourceName}</div>
                {n.description && (
                  <div style={{ color: "var(--text)", lineHeight: 1.35, minHeight: 42, marginBottom: 8 }}>
                    {n.description}
                  </div>
                )}
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    className="btn"
                    style={{ fontSize: 10, padding: "3px 8px" }}
                    onClick={() => setInstallTarget(n.artifactKey)}
                  >
                    Install
                  </button>
                  <button
                    className="btn secondary"
                    style={{ fontSize: 10, padding: "3px 4px" }}
                    onClick={() => handleDismiss(n.key)}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section style={{ marginBottom: 28 }}>
        <span style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.05em" }}>WORKING REPOS</span>
        {working.length === 0 && (
          <p style={{ color: "var(--muted)" }}>No working repos yet — register one to get started.</p>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
          {working.map((w) => {
            const installs = installsByWr[w.id] ?? [];
            const hasAlert = hasNonUpToDate(w.id);
            return (
              <Link
                key={w.id}
                to={`/working-repos/${w.id}`}
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <div className="card" style={{ cursor: "pointer" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <strong style={{ fontSize: 13 }}>{w.name}</strong>
                    {hasAlert && (
                      <span
                        data-testid="notification-dot"
                        title="updates or drift to review"
                        style={{
                          width: 8, height: 8, borderRadius: "50%",
                          background: "var(--warn)",
                          boxShadow: "0 0 0 2px rgba(252,204,102,0.18)",
                          display: "inline-block",
                        }}
                      />
                    )}
                    <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: 11 }}>{w.path}</span>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, fontSize: 11, color: "var(--muted)" }}>
                    {installs.length === 0 && <em>no installs yet</em>}
                    {installs.slice(0, 5).map((i) => {
                      const [, rel] = i.artifactKey.split(":", 2);
                      const name = rel?.split("/").pop() ?? rel;
                      return (
                        <span
                          key={i.id}
                          style={{ background: "rgba(255,255,255,0.06)", padding: "3px 8px", borderRadius: 3 }}
                        >
                          {name}
                        </span>
                      );
                    })}
                    {installs.length > 5 && (
                      <span style={{ background: "rgba(255,255,255,0.06)", padding: "3px 8px", borderRadius: 3 }}>
                        +{installs.length - 5} more
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <section>
        <span style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.05em" }}>SKILLS REPOS</span>
        {sources.length === 0 && <p style={{ color: "var(--muted)", marginTop: 8 }}>No sources registered.</p>}
        <div
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            fontSize: 11,
            marginTop: 8,
          }}
        >
          {sources.map((s, idx) => (
            <Link
              key={s.id}
              to={`/skills-repos/${s.id}`}
              style={{
                display: "flex", alignItems: "center", padding: "10px 12px",
                borderBottom: idx < sources.length - 1 ? "1px solid var(--border)" : "none",
                textDecoration: "none", color: "inherit",
              }}
            >
              <strong>{s.name}</strong>
              <span style={{ marginLeft: "auto", color: "var(--muted)" }}>
                {artifactCount(s.id)} skills
                {s.lastFetchedAt && ` · fetched ${new Date(s.lastFetchedAt).toLocaleTimeString()}`}
              </span>
            </Link>
          ))}
        </div>
      </section>

      {installTarget && (
        <InstallModal
          artifactKey={installTarget}
          onClose={() => { setInstallTarget(null); load(); }}
        />
      )}
    </>
  );
}
```

- [ ] **Step 10.4: Run dashboard tests**

```bash
cd /workspace && npx vitest run tests/unit/dashboard.test.tsx 2>&1 | tail -20
```

Expected: PASS — all 9 tests pass.

- [ ] **Step 10.5: Commit**

```bash
cd /workspace && git add web/pages/Dashboard.tsx tests/unit/dashboard.test.tsx
git commit -m "feat(web): rewrite Dashboard with new-skill cards, notification dots, skills-repo list"
```

---

## Task 11: WorkingRepoDetail — View diff buttons

**Files:**
- Modify: `web/pages/WorkingRepoDetail.tsx`
- Modify: `tests/unit/working-repo-detail.test.tsx`

- [ ] **Step 11.1: Add failing test for diff buttons**

In `tests/unit/working-repo-detail.test.tsx`, add a new test to the existing `describe` block:

```typescript
  it("renders 'View diff' link for update-available install", async () => {
    renderDetail();
    // install i1 has status update-available+drifted — should have diff links
    await screen.findByRole("button", { name: "Disable auto-update" });
    // At least one "View diff" link should exist
    const diffLinks = await screen.findAllByText(/View diff/);
    expect(diffLinks.length).toBeGreaterThan(0);
  });
```

- [ ] **Step 11.2: Run test to verify it fails**

```bash
cd /workspace && npx vitest run tests/unit/working-repo-detail.test.tsx 2>&1 | tail -10
```

Expected: FAIL — "View diff" not found.

- [ ] **Step 11.3: Add View diff buttons to WorkingRepoDetail.tsx**

In `web/pages/WorkingRepoDetail.tsx`, add these imports:

```typescript
import { Link } from "react-router-dom";
```

Then inside the `<td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>` actions cell, add View diff links for the relevant statuses. Insert after the existing status checks:

For `update-available+drifted`:

```tsx
{i.status === "update-available+drifted" && (
  <>
    <Link
      to={`/diff?mode=installed-vs-latest&installId=${i.id}`}
      style={{ fontSize: 12, padding: "4px 8px", background: "transparent", color: "var(--muted)", textDecoration: "none", border: "1px solid var(--border)", borderRadius: 4 }}
    >
      View diff
    </Link>
    <Link
      to={`/diff?mode=installed-vs-drifted&installId=${i.id}`}
      style={{ fontSize: 12, padding: "4px 8px", background: "transparent", color: "var(--muted)", textDecoration: "none", border: "1px solid var(--border)", borderRadius: 4 }}
    >
      View drift
    </Link>
    <button ... /> {/* existing buttons */}
  </>
)}
```

For `update-available` (add a "View diff" link before the existing "Update" button):

```tsx
{i.status === "update-available" && (
  <>
    <Link
      to={`/diff?mode=installed-vs-latest&installId=${i.id}`}
      style={{ fontSize: 12, padding: "4px 8px", background: "transparent", color: "var(--muted)", textDecoration: "none", border: "1px solid var(--border)", borderRadius: 4 }}
    >
      View diff
    </Link>
    <button ... /> {/* existing Update button */}
  </>
)}
```

For `drifted`:

```tsx
{i.status === "drifted" && (
  <>
    <Link
      to={`/diff?mode=installed-vs-drifted&installId=${i.id}`}
      style={{ fontSize: 12, padding: "4px 8px", background: "transparent", color: "var(--muted)", textDecoration: "none", border: "1px solid var(--border)", borderRadius: 4 }}
    >
      View drift
    </Link>
    <button
      className="btn secondary"
      style={{ fontSize: 12 }}
      onClick={async () => {
        try {
          await api.reapplyInstall(i.id);
          reload();
        } catch (err) {
          alert((err as Error).message);
        }
      }}
    >
      Re-apply
    </button>
  </>
)}
```

Full updated actions column (replacing the existing `<td>` actions section):

```tsx
<td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
  {(i.status === "update-available+drifted") && (
    <>
      <Link
        to={`/diff?mode=installed-vs-latest&installId=${i.id}`}
        style={{ fontSize: 12, padding: "4px 8px", background: "transparent", color: "var(--muted)", textDecoration: "none", border: "1px solid var(--border)", borderRadius: 4 }}
      >
        View diff
      </Link>
      <Link
        to={`/diff?mode=installed-vs-drifted&installId=${i.id}`}
        style={{ fontSize: 12, padding: "4px 8px", background: "transparent", color: "var(--muted)", textDecoration: "none", border: "1px solid var(--border)", borderRadius: 4 }}
      >
        View drift
      </Link>
      <button
        className="btn secondary"
        style={{ fontSize: 12 }}
        onClick={async () => {
          try {
            await api.updateInstall(i.id, { autoUpdate: false });
            reload();
          } catch (err) {
            alert((err as Error).message);
          }
        }}
      >
        Disable auto-update
      </button>
      <button
        className="btn secondary"
        style={{ fontSize: 12 }}
        onClick={async () => {
          try {
            await api.applyInstallUpdate(i.id);
            reload();
          } catch (err) {
            alert((err as Error).message);
          }
        }}
      >
        Discard & update
      </button>
    </>
  )}
  {i.status === "update-available" && (
    <>
      <Link
        to={`/diff?mode=installed-vs-latest&installId=${i.id}`}
        style={{ fontSize: 12, padding: "4px 8px", background: "transparent", color: "var(--muted)", textDecoration: "none", border: "1px solid var(--border)", borderRadius: 4 }}
      >
        View diff
      </Link>
      <button
        className="btn secondary"
        style={{ fontSize: 12 }}
        onClick={async () => {
          try {
            await api.applyInstallUpdate(i.id);
            reload();
          } catch (err) {
            alert((err as Error).message);
          }
        }}
      >
        Update
      </button>
    </>
  )}
  {i.status === "drifted" && (
    <>
      <Link
        to={`/diff?mode=installed-vs-drifted&installId=${i.id}`}
        style={{ fontSize: 12, padding: "4px 8px", background: "transparent", color: "var(--muted)", textDecoration: "none", border: "1px solid var(--border)", borderRadius: 4 }}
      >
        View drift
      </Link>
      <button
        className="btn secondary"
        style={{ fontSize: 12 }}
        onClick={async () => {
          try {
            await api.reapplyInstall(i.id);
            reload();
          } catch (err) {
            alert((err as Error).message);
          }
        }}
      >
        Re-apply
      </button>
    </>
  )}
  <button
    className="btn secondary"
    onClick={async () => {
      try {
        await api.deleteInstall(i.id);
        reload();
      } catch (err) {
        alert((err as Error).message);
      }
    }}
  >
    Uninstall
  </button>
</td>
```

- [ ] **Step 11.4: Run updated tests**

```bash
cd /workspace && npx vitest run tests/unit/working-repo-detail.test.tsx 2>&1 | tail -15
```

Expected: PASS — all 6 tests pass.

- [ ] **Step 11.5: Commit**

```bash
cd /workspace && git add web/pages/WorkingRepoDetail.tsx tests/unit/working-repo-detail.test.tsx
git commit -m "feat(web): add View diff and Re-apply buttons to WorkingRepoDetail"
```

---

## Task 12: Diff page (Diff.tsx)

**Files:**
- Create: `web/pages/Diff.tsx`
- Create: `tests/unit/diff-view.test.tsx`

- [ ] **Step 12.1: Write failing unit tests**

Create `tests/unit/diff-view.test.tsx`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Diff } from "../../web/pages/Diff.tsx";
import type { DiffResponse } from "../../web/api.ts";

afterEach(cleanup);

const mockDiffResponse: DiffResponse = {
  artifactKey: "src1:skills/foo",
  artifactName: "foo",
  fromSha: "abc1234",
  toSha: "def5678",
  mode: "installed-vs-latest",
  label: "installed vs latest",
  files: [
    { path: "skills/foo/SKILL.md", fromContent: "# Old content", toContent: "# New content", changed: true },
    { path: "skills/foo/README.md", fromContent: "Same", toContent: "Same", changed: false },
  ],
  primaryAction: "update",
  installId: "install-1",
};

function makeMockFetch(diffResponse: DiffResponse = mockDiffResponse) {
  return vi.fn(async (url: string, opts?: RequestInit) => {
    if (url.startsWith("/api/diff")) return new Response(JSON.stringify(diffResponse), { status: 200 });
    if (url.includes("/update") && opts?.method === "POST") return new Response("{}", { status: 200 });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
}

function renderDiff(search = "?mode=installed-vs-latest&installId=install-1") {
  return render(
    <MemoryRouter initialEntries={[`/diff${search}`]}>
      <Routes>
        <Route path="/diff" element={<Diff />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Diff page", () => {
  it("renders artifact name in header", async () => {
    globalThis.fetch = makeMockFetch();
    renderDiff();
    expect(await screen.findByText("foo")).toBeTruthy();
  });

  it("renders label in header", async () => {
    globalThis.fetch = makeMockFetch();
    renderDiff();
    expect(await screen.findByText("installed vs latest")).toBeTruthy();
  });

  it("renders file list in left pane", async () => {
    globalThis.fetch = makeMockFetch();
    renderDiff();
    expect(await screen.findByText("SKILL.md")).toBeTruthy();
    expect(await screen.findByText("README.md")).toBeTruthy();
  });

  it("marks changed files with a ± indicator", async () => {
    globalThis.fetch = makeMockFetch();
    renderDiff();
    await screen.findByText("SKILL.md");
    const changedIndicators = document.querySelectorAll("[data-testid='file-changed']");
    expect(changedIndicators.length).toBe(1);
  });

  it("renders 'Update' footer button for installed-vs-latest mode", async () => {
    globalThis.fetch = makeMockFetch();
    renderDiff();
    expect(await screen.findByRole("button", { name: /Update/ })).toBeTruthy();
  });

  it("renders 'Re-apply' footer button for installed-vs-drifted mode", async () => {
    globalThis.fetch = makeMockFetch({
      ...mockDiffResponse,
      mode: "installed-vs-drifted",
      label: "installed vs current file",
      primaryAction: "re-apply",
    });
    renderDiff("?mode=installed-vs-drifted&installId=install-1");
    expect(await screen.findByRole("button", { name: /Re-apply/ })).toBeTruthy();
  });

  it("renders no primary action button for version-vs-version mode", async () => {
    globalThis.fetch = makeMockFetch({
      ...mockDiffResponse,
      mode: "version-vs-version",
      label: "abc1234 → def5678",
      primaryAction: null,
      installId: null,
    });
    renderDiff("?mode=version-vs-version&artifactKey=src1%3Askills%2Ffoo&fromSha=abc1234&toSha=def5678");
    await screen.findByText("abc1234 → def5678");
    expect(screen.queryByRole("button", { name: /Update|Re-apply/ })).toBeNull();
  });

  it("renders Side-by-side toggle button", async () => {
    globalThis.fetch = makeMockFetch();
    renderDiff();
    expect(await screen.findByRole("button", { name: "Side-by-side" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Unified" })).toBeTruthy();
  });
});
```

- [ ] **Step 12.2: Run tests to verify they fail**

```bash
cd /workspace && npx vitest run tests/unit/diff-view.test.tsx 2>&1 | tail -10
```

Expected: FAIL — `Diff` component not found.

- [ ] **Step 12.3: Create web/pages/Diff.tsx**

Create `web/pages/Diff.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import ReactDiffViewer from "react-diff-viewer-continued";
import { api, DiffResponse, FileDiff } from "../api.ts";

export function Diff() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [diffData, setDiffData] = useState<DiffResponse | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [splitView, setSplitView] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const mode = (params.get("mode") ?? "version-vs-version") as DiffResponse["mode"];
  const installId = params.get("installId") ?? undefined;
  const artifactKey = params.get("artifactKey") ?? undefined;
  const fromSha = params.get("fromSha") ?? undefined;
  const toSha = params.get("toSha") ?? undefined;

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        let data: DiffResponse;
        if (mode === "installed-vs-latest" && installId) {
          data = await api.getDiff({ mode: "installed-vs-latest", installId });
        } else if (mode === "installed-vs-drifted" && installId) {
          data = await api.getDiff({ mode: "installed-vs-drifted", installId });
        } else if (mode === "version-vs-version" && artifactKey && fromSha && toSha) {
          data = await api.getDiff({ mode: "version-vs-version", artifactKey, fromSha, toSha });
        } else {
          setError("Invalid diff parameters");
          setLoading(false);
          return;
        }
        setDiffData(data);
        const firstChanged = data.files.find((f) => f.changed);
        setSelectedFile(firstChanged?.path ?? data.files[0]?.path ?? null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handlePrimaryAction = async () => {
    if (!diffData?.installId) return;
    setApplying(true);
    try {
      if (diffData.primaryAction === "update") {
        await api.applyInstallUpdate(diffData.installId);
      } else if (diffData.primaryAction === "re-apply") {
        await api.reapplyInstall(diffData.installId);
      }
      navigate(-1);
    } catch (e) {
      setError((e as Error).message);
      setApplying(false);
    }
  };

  const currentFile: FileDiff | undefined =
    diffData?.files.find((f) => f.path === selectedFile) ?? diffData?.files[0];

  const shortPath = (p: string) => p.split("/").pop() ?? p;

  if (loading) return <p style={{ padding: 20 }}>Loading diff…</p>;
  if (error) return <p style={{ padding: 20, color: "var(--danger)" }}>{error}</p>;
  if (!diffData) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
        <strong style={{ fontSize: 14 }}>{diffData.artifactName}</strong>
        <span style={{ color: "var(--muted)", fontSize: 11 }}>
          {diffData.fromSha.slice(0, 7)} → {diffData.toSha === "working-repo" ? "working repo" : diffData.toSha.slice(0, 7)}
          {" · "}
          {diffData.label}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, fontSize: 11 }}>
          <button
            role="button"
            className={`btn ${splitView ? "primary" : "secondary"}`}
            style={{ fontSize: 11, padding: "3px 10px" }}
            onClick={() => setSplitView(true)}
          >
            Side-by-side
          </button>
          <button
            role="button"
            className={`btn ${!splitView ? "primary" : "secondary"}`}
            style={{ fontSize: 11, padding: "3px 10px" }}
            onClick={() => setSplitView(false)}
          >
            Unified
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* File list */}
        <div style={{ width: 200, background: "rgba(255,255,255,0.03)", borderRight: "1px solid var(--border)", padding: 8, overflowY: "auto", fontSize: 11 }}>
          <div style={{ color: "var(--muted)", fontSize: 10, letterSpacing: "0.05em", marginBottom: 6 }}>FILES</div>
          {diffData.files.map((f) => (
            <div
              key={f.path}
              style={{
                padding: "4px 6px",
                borderRadius: 3,
                background: f.path === selectedFile ? "rgba(255,255,255,0.08)" : "transparent",
                marginBottom: 1,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
              onClick={() => setSelectedFile(f.path)}
            >
              <span style={{ color: f.path === selectedFile ? "var(--text)" : "var(--muted)" }}>
                {shortPath(f.path)}
              </span>
              {f.changed && (
                <span data-testid="file-changed" style={{ color: "var(--warn)", marginLeft: "auto" }}>±</span>
              )}
            </div>
          ))}
        </div>

        {/* Diff pane */}
        <div style={{ flex: 1, overflow: "auto" }}>
          {currentFile ? (
            <div>
              <div style={{ padding: "6px 12px", borderBottom: "1px solid var(--border)", fontSize: 11, color: "var(--muted)", display: "flex", gap: 20 }}>
                <span>{diffData.fromSha.slice(0, 7)} — {mode === "installed-vs-drifted" ? "original" : "installed"}</span>
                <span>{diffData.toSha === "working-repo" ? "working repo" : diffData.toSha.slice(0, 7)} — {mode === "installed-vs-drifted" ? "current" : "latest"}</span>
              </div>
              <ReactDiffViewer
                oldValue={currentFile.fromContent ?? ""}
                newValue={currentFile.toContent ?? ""}
                splitView={splitView}
                useDarkTheme={true}
              />
            </div>
          ) : (
            <p style={{ padding: 20, color: "var(--muted)" }}>Select a file to view diff</p>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn secondary" onClick={() => navigate(-1)}>Close</button>
        {diffData.primaryAction === "update" && (
          <button className="btn" onClick={handlePrimaryAction} disabled={applying}>
            {applying ? "Updating…" : `Update to ${diffData.toSha.slice(0, 7)}`}
          </button>
        )}
        {diffData.primaryAction === "re-apply" && (
          <button className="btn" onClick={handlePrimaryAction} disabled={applying}>
            {applying ? "Re-applying…" : "Re-apply installed version"}
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 12.4: Run diff view tests**

```bash
cd /workspace && npx vitest run tests/unit/diff-view.test.tsx 2>&1 | tail -15
```

Expected: PASS — all 8 tests pass.

- [ ] **Step 12.5: Commit**

```bash
cd /workspace && git add web/pages/Diff.tsx tests/unit/diff-view.test.tsx
git commit -m "feat(web): add full-page Diff view (installed-vs-latest, installed-vs-drifted, version-vs-version)"
```

---

## Task 13: Add /diff route

**Files:**
- Modify: `web/routes.tsx`

- [ ] **Step 13.1: Add the /diff route**

In `web/routes.tsx`:

```typescript
import { Routes, Route } from "react-router-dom";
import { Dashboard } from "./pages/Dashboard.tsx";
import { Browse } from "./pages/Browse.tsx";
import { SkillsRepos } from "./pages/SkillsRepos.tsx";
import { SkillsRepoDetail } from "./pages/SkillsRepoDetail.tsx";
import { WorkingRepos } from "./pages/WorkingRepos.tsx";
import { WorkingRepoDetail } from "./pages/WorkingRepoDetail.tsx";
import { Settings } from "./pages/Settings.tsx";
import { Diff } from "./pages/Diff.tsx";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/browse" element={<Browse />} />
      <Route path="/skills-repos" element={<SkillsRepos />} />
      <Route path="/skills-repos/:id" element={<SkillsRepoDetail />} />
      <Route path="/working-repos" element={<WorkingRepos />} />
      <Route path="/working-repos/:id" element={<WorkingRepoDetail />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/diff" element={<Diff />} />
    </Routes>
  );
}
```

- [ ] **Step 13.2: Verify TypeScript compiles**

```bash
cd /workspace && npx tsc -p tsconfig.fe.json --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 13.3: Commit**

```bash
cd /workspace && git add web/routes.tsx
git commit -m "feat(web): register /diff route"
```

---

## Task 14: Full test run, tag, and final commit

**Files:** no new files

- [ ] **Step 14.1: Run the full test suite**

```bash
cd /workspace && npm test 2>&1 | tail -30
```

Expected: all tests pass (or only pre-existing failures).

- [ ] **Step 14.2: Verify TypeScript for both configs**

```bash
cd /workspace && npx tsc -p tsconfig.be.json --noEmit && npx tsc -p tsconfig.fe.json --noEmit
echo "TS OK"
```

Expected: `TS OK`.

- [ ] **Step 14.3: Tag slice-4**

```bash
cd /workspace && git tag slice-4
git log --oneline -15
```

Expected: recent commits show all slice-4 work; `slice-4` tag on the latest commit.

---

## Self-Review: Spec Coverage Check

| Spec requirement | Task covering it |
|-----------------|-----------------|
| New-skill cards with Install/Dismiss | Tasks 6, 10 |
| Working-repo cards with notification dot | Task 10 |
| Installed-skill chips on working-repo cards | Task 10 |
| Skills-repo thin list (name, count, last-fetched) | Task 10 |
| New-artifact detection via snapshot comparison | Tasks 3, 6, 7 |
| Dismissed notifications persist to dismissed-notifications.json | Tasks 2, 6 |
| Dismiss key format: `kind:sourceRepoId:artifactKey:sha` | Task 6 |
| Snapshot seeded on register (no flood of "new") | Task 7 |
| Diff view at /diff route | Tasks 12, 13 |
| Version-vs-version mode | Tasks 8, 12 |
| Installed-vs-latest mode | Tasks 8, 12 |
| Installed-vs-drifted mode | Tasks 8, 12 |
| File list left pane with ± change markers | Task 12 |
| Side-by-side diff using react-diff-viewer | Tasks 1, 12 |
| Toggle side-by-side / unified | Task 12 |
| Header shows artifact name + SHAs + label | Task 12 |
| Footer: Update action for installed-vs-latest | Task 12 |
| Footer: Re-apply action for installed-vs-drifted | Tasks 8, 12 |
| View diff buttons in WorkingRepoDetail | Task 11 |
| Reapply endpoint (POST /api/installs/:id/reapply) | Task 8 |
| Artifact version history endpoint | Task 5 |
| SHA param on file-read endpoint | Task 5 |
| Updated-artifact dot on working-repo cards | Task 10 |
| InstallModal trigger from new-skill card | Task 10 |

All requirements are covered. No gaps found.
