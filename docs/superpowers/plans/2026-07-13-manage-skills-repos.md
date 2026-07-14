# Managing Registered Skills Repositories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users rename a registered skills repo, add/remove its artifact paths, and remove the whole repo — with removal guarded when artifacts are still installed and all related state purged on success.

**Architecture:** A new `PATCH /api/skills-repos/:id` route handles rename + path diffing (guard removed paths, seed added paths silently, purge state for successfully-removed paths). The existing `DELETE` route is tightened with an install guard + full purge. Guards return `409` with a `blockers` list. A new `EditSkillsRepoModal` and guarded Remove handlers wire the UI.

**Tech Stack:** Node.js 20 (ESM) + TypeScript, Fastify, React 18, Vite, Vitest, `@testing-library/react`.

## Global Constraints

- ESM TypeScript throughout; import paths in `src/` use no extension for local modules except state stores which import each other with `.js` (follow the neighbouring file's existing style).
- Tests import source with `.ts` extensions (e.g. `../../src/server.ts`) — match existing test files.
- `artifactKey` = `` `${sourceRepoId}:${rootRelativePath}` `` and `rootRelativePath` = `` `${configuredPath}/${name}` `` for both skills and rules adapters.
- An install originates from configured path `P` of repo `id` **iff** `install.sourceRepoId === id` **and** the install's rootRelativePath starts with `` `${P}/` ``.
- Blocking scope: **any** install counts (working-repo target **and** global target).
- Guards are all-or-nothing: a `409` mutates **zero** state.
- Run the full suite with `npm test` (Vitest). Run a single file with `npx vitest run <path>`.

---

### Task 1: Shared artifact-key helpers

**Files:**
- Create: `src/util/artifact-key.ts`
- Modify: `src/api/installs.ts` (replace the local `artifactDisplayName` with the shared import)
- Test: `tests/unit/artifact-key.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `artifactRootRelativePath(artifactKey: string): string` — everything after the first `:`.
  - `artifactDisplayName(artifactKey: string): string` — last `/`-segment of the rootRelativePath, falling back to the whole key.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/artifact-key.test.ts
import { describe, it, expect } from "vitest";
import { artifactRootRelativePath, artifactDisplayName } from "../../src/util/artifact-key.ts";

describe("artifactRootRelativePath", () => {
  it("strips the sourceRepoId prefix", () => {
    expect(artifactRootRelativePath("abc-123:ai/skills/foo")).toBe("ai/skills/foo");
  });
  it("keeps colons that appear after the first one", () => {
    expect(artifactRootRelativePath("abc:ai/rules/a:b.md")).toBe("ai/rules/a:b.md");
  });
});

describe("artifactDisplayName", () => {
  it("returns the last path segment", () => {
    expect(artifactDisplayName("abc-123:ai/skills/foo")).toBe("foo");
  });
  it("returns a rules filename as the display name", () => {
    expect(artifactDisplayName("abc-123:ai/rules/style.md")).toBe("style.md");
  });
  it("falls back to the whole key when there is no path", () => {
    expect(artifactDisplayName("weird-no-colon")).toBe("weird-no-colon");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/artifact-key.test.ts`
Expected: FAIL — cannot find module `src/util/artifact-key.ts`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/util/artifact-key.ts
export function artifactRootRelativePath(artifactKey: string): string {
  const idx = artifactKey.indexOf(":");
  return idx === -1 ? artifactKey : artifactKey.slice(idx + 1);
}

export function artifactDisplayName(artifactKey: string): string {
  const rel = artifactRootRelativePath(artifactKey);
  return rel.split("/").pop() || artifactKey;
}
```

- [ ] **Step 4: Point `src/api/installs.ts` at the shared helper**

In `src/api/installs.ts`, delete the local function:

```typescript
function artifactDisplayName(artifactKey: string): string {
  return artifactKey.split(":").slice(1).join(":").split("/").pop() || artifactKey;
}
```

and add near the other imports at the top:

```typescript
import { artifactDisplayName } from "../util/artifact-key";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/artifact-key.test.ts && npx vitest run tests/integration/install.test.ts`
Expected: PASS (install tests still green — behaviour of `artifactDisplayName` is unchanged for the existing cases).

- [ ] **Step 6: Commit**

```bash
git add src/util/artifact-key.ts src/api/installs.ts tests/unit/artifact-key.test.ts
git commit -m "refactor: extract shared artifact-key helpers"
```

---

### Task 2: State-store purge methods

**Files:**
- Modify: `src/state/favorites.ts`, `src/state/artifact-snapshots.ts`, `src/state/artifact-sha-baseline.ts`, `src/state/notifications.ts`
- Test: `tests/unit/purge-store-methods.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `FavoritesStore.removeByKeyPrefix(prefix: string): Promise<void>`
  - `ArtifactSnapshotsStore.removeRepo(sourceRepoId: string): Promise<void>`
  - `ArtifactSnapshotsStore.removeByKeyPrefix(sourceRepoId: string, keyPrefix: string): Promise<void>`
  - `ArtifactShaBaselineStore.removeByKeyPrefix(prefix: string): Promise<void>`
  - `DismissedNotificationsStore.removeBySubstring(substr: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/purge-store-methods.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FavoritesStore } from "../../src/state/favorites.ts";
import { ArtifactSnapshotsStore } from "../../src/state/artifact-snapshots.ts";
import { ArtifactShaBaselineStore } from "../../src/state/artifact-sha-baseline.ts";
import { DismissedNotificationsStore } from "../../src/state/notifications.ts";

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "purge-test-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("FavoritesStore.removeByKeyPrefix", () => {
  it("drops only keys starting with the prefix", async () => {
    const s = new FavoritesStore(dir);
    await s.setFavorite("r1:ai/skills/foo", true);
    await s.setFavorite("r1:ai/rules/bar.md", true);
    await s.setFavorite("r2:ai/skills/baz", true);
    await s.removeByKeyPrefix("r1:ai/skills/");
    const keys = await s.listFavorites();
    expect([...keys].sort()).toEqual(["r1:ai/rules/bar.md", "r2:ai/skills/baz"]);
  });
});

describe("ArtifactSnapshotsStore", () => {
  it("removeRepo deletes the whole repo entry", async () => {
    const s = new ArtifactSnapshotsStore(dir);
    await s.initSnapshot("r1", ["r1:ai/skills/foo"]);
    await s.removeRepo("r1");
    expect((await s.getSnapshot("r1")).size).toBe(0);
  });
  it("removeByKeyPrefix drops matching keys from the array", async () => {
    const s = new ArtifactSnapshotsStore(dir);
    await s.initSnapshot("r1", ["r1:ai/skills/foo", "r1:ai/rules/bar.md"]);
    await s.removeByKeyPrefix("r1", "r1:ai/skills/");
    expect([...(await s.getSnapshot("r1"))]).toEqual(["r1:ai/rules/bar.md"]);
  });
});

describe("ArtifactShaBaselineStore.removeByKeyPrefix", () => {
  it("drops only baseline keys starting with the prefix", async () => {
    const s = new ArtifactShaBaselineStore(dir);
    await s.setBaseline("r1", "r1:ai/skills/foo", "sha1");
    await s.setBaseline("r1", "r1:ai/rules/bar.md", "sha2");
    await s.removeByKeyPrefix("r1:r1:ai/skills/");
    expect(await s.getBaseline("r1", "r1:ai/skills/foo")).toBeNull();
    expect(await s.getBaseline("r1", "r1:ai/rules/bar.md")).toBe("sha2");
  });
});

describe("DismissedNotificationsStore.removeBySubstring", () => {
  it("drops only keys containing the substring", async () => {
    const s = new DismissedNotificationsStore(dir);
    await s.dismiss("newArtifact:r1:r1:ai/skills/foo:sha1");
    await s.dismiss("updatedArtifact:r2:r2:ai/skills/foo:sha2");
    await s.removeBySubstring(":r1:");
    const left = await s.listDismissed();
    expect([...left]).toEqual(["updatedArtifact:r2:r2:ai/skills/foo:sha2"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/purge-store-methods.test.ts`
Expected: FAIL — the `removeByKeyPrefix` / `removeRepo` / `removeBySubstring` methods do not exist.

- [ ] **Step 3: Implement `FavoritesStore.removeByKeyPrefix`**

Add to `src/state/favorites.ts` inside the class:

```typescript
  async removeByKeyPrefix(prefix: string): Promise<void> {
    const data = await this.store.read();
    let changed = false;
    for (const key of Object.keys(data)) {
      if (key.startsWith(prefix)) { delete data[key]; changed = true; }
    }
    if (changed) await this.store.write(data);
  }
```

- [ ] **Step 4: Implement the `ArtifactSnapshotsStore` methods**

Add to `src/state/artifact-snapshots.ts` inside the class:

```typescript
  async removeRepo(sourceRepoId: string): Promise<void> {
    const all = await this.store.read();
    if (all[sourceRepoId] !== undefined) {
      delete all[sourceRepoId];
      await this.store.write(all);
    }
  }

  async removeByKeyPrefix(sourceRepoId: string, keyPrefix: string): Promise<void> {
    const all = await this.store.read();
    const existing = all[sourceRepoId];
    if (existing === undefined) return;
    all[sourceRepoId] = existing.filter((k) => !k.startsWith(keyPrefix));
    await this.store.write(all);
  }
```

- [ ] **Step 5: Implement `ArtifactShaBaselineStore.removeByKeyPrefix`**

Add to `src/state/artifact-sha-baseline.ts` inside the class:

```typescript
  async removeByKeyPrefix(prefix: string): Promise<void> {
    const data = await this.store.read();
    let changed = false;
    for (const key of Object.keys(data)) {
      if (key.startsWith(prefix)) { delete data[key]; changed = true; }
    }
    if (changed) await this.store.write(data);
  }
```

- [ ] **Step 6: Implement `DismissedNotificationsStore.removeBySubstring`**

Add to `src/state/notifications.ts` inside the class:

```typescript
  async removeBySubstring(substr: string): Promise<void> {
    const data = await this.store.read();
    let changed = false;
    for (const key of Object.keys(data)) {
      if (key.includes(substr)) { delete data[key]; changed = true; }
    }
    if (changed) await this.store.write(data);
  }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/unit/purge-store-methods.test.ts`
Expected: PASS (all).

- [ ] **Step 8: Commit**

```bash
git add src/state/favorites.ts src/state/artifact-snapshots.ts src/state/artifact-sha-baseline.ts src/state/notifications.ts tests/unit/purge-store-methods.test.ts
git commit -m "feat: add prefix/substring purge methods to state stores"
```

---

### Task 3: Purge orchestrators

**Files:**
- Create: `src/engine/purge.ts`
- Test: `tests/integration/purge.test.ts`

**Interfaces:**
- Consumes: the store methods from Task 2; `ServerDeps` fields `favorites`, `snapshots`, `shaBaseline`, `dismissed`.
- Produces:
  - `purgeRepoState(deps: PurgeDeps, sourceRepoId: string): Promise<void>`
  - `purgePathState(deps: PurgeDeps, sourceRepoId: string, path: string): Promise<void>`
  - `interface PurgeDeps` = the four store instances (a structural subset of `ServerDeps`).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/purge.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FavoritesStore } from "../../src/state/favorites.ts";
import { ArtifactSnapshotsStore } from "../../src/state/artifact-snapshots.ts";
import { ArtifactShaBaselineStore } from "../../src/state/artifact-sha-baseline.ts";
import { DismissedNotificationsStore } from "../../src/state/notifications.ts";
import { purgeRepoState, purgePathState } from "../../src/engine/purge.ts";

let dir: string;
function stores() {
  return {
    favorites: new FavoritesStore(dir),
    snapshots: new ArtifactSnapshotsStore(dir),
    shaBaseline: new ArtifactShaBaselineStore(dir),
    dismissed: new DismissedNotificationsStore(dir),
  };
}
async function seed(s: ReturnType<typeof stores>) {
  await s.favorites.setFavorite("r1:ai/skills/foo", true);
  await s.favorites.setFavorite("r1:ai/rules/bar.md", true);
  await s.favorites.setFavorite("r2:ai/skills/keep", true);
  await s.snapshots.initSnapshot("r1", ["r1:ai/skills/foo", "r1:ai/rules/bar.md"]);
  await s.snapshots.initSnapshot("r2", ["r2:ai/skills/keep"]);
  await s.shaBaseline.setBaseline("r1", "r1:ai/skills/foo", "sha1");
  await s.shaBaseline.setBaseline("r1", "r1:ai/rules/bar.md", "sha2");
  await s.dismissed.dismiss("newArtifact:r1:r1:ai/skills/foo:sha1");
  await s.dismissed.dismiss("updatedArtifact:r2:r2:ai/skills/keep:sha9");
}

beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "purge-orch-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("purgeRepoState", () => {
  it("removes all state for the repo and leaves other repos intact", async () => {
    const s = stores();
    await seed(s);
    await purgeRepoState(s, "r1");
    expect([...(await s.favorites.listFavorites())]).toEqual(["r2:ai/skills/keep"]);
    expect((await s.snapshots.getSnapshot("r1")).size).toBe(0);
    expect((await s.snapshots.getSnapshot("r2")).size).toBe(1);
    expect(await s.shaBaseline.getBaseline("r1", "r1:ai/skills/foo")).toBeNull();
    expect([...(await s.dismissed.listDismissed())]).toEqual(["updatedArtifact:r2:r2:ai/skills/keep:sha9"]);
  });
});

describe("purgePathState", () => {
  it("removes only state under the given path", async () => {
    const s = stores();
    await seed(s);
    await purgePathState(s, "r1", "ai/skills");
    const favs = [...(await s.favorites.listFavorites())].sort();
    expect(favs).toEqual(["r1:ai/rules/bar.md", "r2:ai/skills/keep"]);
    expect([...(await s.snapshots.getSnapshot("r1"))]).toEqual(["r1:ai/rules/bar.md"]);
    expect(await s.shaBaseline.getBaseline("r1", "r1:ai/skills/foo")).toBeNull();
    expect(await s.shaBaseline.getBaseline("r1", "r1:ai/rules/bar.md")).toBe("sha2");
    expect(await s.dismissed.isDismissed("newArtifact:r1:r1:ai/skills/foo:sha1")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/purge.test.ts`
Expected: FAIL — cannot find module `src/engine/purge.ts`.

- [ ] **Step 3: Implement `src/engine/purge.ts`**

```typescript
// src/engine/purge.ts
import type { FavoritesStore } from "../state/favorites";
import type { ArtifactSnapshotsStore } from "../state/artifact-snapshots";
import type { ArtifactShaBaselineStore } from "../state/artifact-sha-baseline";
import type { DismissedNotificationsStore } from "../state/notifications";

export interface PurgeDeps {
  favorites: FavoritesStore;
  snapshots: ArtifactSnapshotsStore;
  shaBaseline: ArtifactShaBaselineStore;
  dismissed: DismissedNotificationsStore;
}

export async function purgeRepoState(deps: PurgeDeps, sourceRepoId: string): Promise<void> {
  await deps.favorites.removeByKeyPrefix(`${sourceRepoId}:`);
  await deps.snapshots.removeRepo(sourceRepoId);
  await deps.shaBaseline.removeByKeyPrefix(`${sourceRepoId}:`);
  await deps.dismissed.removeBySubstring(`:${sourceRepoId}:`);
}

export async function purgePathState(
  deps: PurgeDeps,
  sourceRepoId: string,
  configuredPath: string,
): Promise<void> {
  const keyPrefix = `${sourceRepoId}:${configuredPath}/`;
  await deps.favorites.removeByKeyPrefix(keyPrefix);
  await deps.snapshots.removeByKeyPrefix(sourceRepoId, keyPrefix);
  await deps.shaBaseline.removeByKeyPrefix(`${sourceRepoId}:${keyPrefix}`);
  await deps.dismissed.removeBySubstring(`:${keyPrefix}`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/purge.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/purge.ts tests/integration/purge.test.ts
git commit -m "feat: add repo and path state-purge orchestrators"
```

---

### Task 4: `PATCH /api/skills-repos/:id` — rename + path edits

**Files:**
- Modify: `src/api/skills-repos.ts`
- Test: `tests/integration/skills-repos-edit.test.ts`

**Interfaces:**
- Consumes: `artifactRootRelativePath` (Task 1); `purgePathState` (Task 3); `discoverArtifacts` (existing); `deps.installs`, `deps.skillsRepos`, `deps.snapshots`.
- Produces: `PATCH /api/skills-repos/:id`.
  - Body: `{ name?: string; artifactPaths?: { skills?: string[]; rules?: string[] } }`.
  - `200` → updated `SkillsRepo`.
  - `404 { code: "skills_repo_not_found" }`; `400 { code: "bad_input" }`.
  - `409 { code: "paths_in_use", blockers: Array<{ type: string; path: string; artifacts: Array<{ artifactKey: string; name: string }> }> }`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/skills-repos-edit.test.ts
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

async function makeDeps() {
  const stateDir = await tmpDir("arm-edit-");
  const cacheDir = await tmpDir("arm-edit-cache-");
  return {
    stateDir, cacheDir,
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

async function register(app: Awaited<ReturnType<typeof buildServer>>, gitUrl: string, artifactPaths: Record<string, string[]>) {
  const res = await app.inject({
    method: "POST", url: "/api/skills-repos",
    payload: { name: "src", gitUrl, branch: "main", artifactPaths },
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

describe("PATCH /api/skills-repos/:id — rename", () => {
  it("changes the display name only", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const fx = await buildFixtureRepo([{ message: "init", files: { "ai/skills/foo/SKILL.md": "# Foo\n" } }]);
    const repo = await register(app, fx.fileUrl, { skills: ["ai/skills"] });

    const res = await app.inject({ method: "PATCH", url: `/api/skills-repos/${repo.id}`, payload: { name: "renamed" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("renamed");
    // artifactPaths untouched by a rename-only patch.
    expect(res.json().artifactPaths).toEqual({ skills: ["ai/skills"] });
  });

  it("404s for an unknown repo", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const res = await app.inject({ method: "PATCH", url: "/api/skills-repos/nope", payload: { name: "x" } });
    expect(res.statusCode).toBe(404);
  });

  it("400s when the body has neither name nor artifactPaths", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const fx = await buildFixtureRepo([{ message: "init", files: { "ai/skills/foo/SKILL.md": "# Foo\n" } }]);
    const repo = await register(app, fx.fileUrl, { skills: ["ai/skills"] });
    const res = await app.inject({ method: "PATCH", url: `/api/skills-repos/${repo.id}`, payload: {} });
    expect(res.statusCode).toBe(400);
  });
});

describe("PATCH /api/skills-repos/:id — add path", () => {
  it("makes new artifacts discoverable and seeds them silently", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const fx = await buildFixtureRepo([{ message: "init", files: {
      "ai/skills/foo/SKILL.md": "# Foo\n",
      "extra/skills/bar/SKILL.md": "# Bar\n",
    } }]);
    const repo = await register(app, fx.fileUrl, { skills: ["ai/skills"] });

    const res = await app.inject({
      method: "PATCH", url: `/api/skills-repos/${repo.id}`,
      payload: { artifactPaths: { skills: ["ai/skills", "extra/skills"] } },
    });
    expect(res.statusCode).toBe(200);

    const arts = await app.inject({ method: "GET", url: `/api/artifacts?sourceRepoId=${repo.id}` });
    expect(arts.json().map((a: { name: string }) => a.name).sort()).toEqual(["bar", "foo"]);

    // Seeded silently: no new-artifact notifications for bar.
    const notes = await app.inject({ method: "GET", url: "/api/notifications" });
    expect(notes.json().newArtifacts).toHaveLength(0);
  });
});

describe("PATCH /api/skills-repos/:id — remove path guard", () => {
  it("removes an unused path", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const fx = await buildFixtureRepo([{ message: "init", files: {
      "ai/skills/foo/SKILL.md": "# Foo\n",
      "extra/skills/bar/SKILL.md": "# Bar\n",
    } }]);
    const repo = await register(app, fx.fileUrl, { skills: ["ai/skills", "extra/skills"] });

    const res = await app.inject({
      method: "PATCH", url: `/api/skills-repos/${repo.id}`,
      payload: { artifactPaths: { skills: ["ai/skills"] } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().artifactPaths.skills).toEqual(["ai/skills"]);
  });

  it("blocks removing a path with an installed artifact and lists the blocker", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const fx = await buildFixtureRepo([{ message: "init", files: { "ai/skills/foo/SKILL.md": "# Foo\n" } }]);
    const repo = await register(app, fx.fileUrl, { skills: ["ai/skills"] });

    // Seed a blocking install directly (global target keeps the test independent of the install engine).
    await deps.installs.add({
      artifactKey: `${repo.id}:ai/skills/foo`,
      sourceRepoId: repo.id,
      target: { type: "global" },
      agent: "claude-code",
      artifactType: "skills",
      installedCommitSha: "sha1",
      autoUpdate: false,
      installedFiles: [],
      installedAt: new Date().toISOString(),
    });

    const res = await app.inject({
      method: "PATCH", url: `/api/skills-repos/${repo.id}`,
      payload: { artifactPaths: { skills: [] } },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.code).toBe("paths_in_use");
    expect(body.blockers).toEqual([
      { type: "skills", path: "ai/skills", artifacts: [{ artifactKey: `${repo.id}:ai/skills/foo`, name: "foo" }] },
    ]);

    // Nothing changed.
    const after = await app.inject({ method: "GET", url: `/api/skills-repos/${repo.id}` });
    expect(after.json().artifactPaths.skills).toEqual(["ai/skills"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/skills-repos-edit.test.ts`
Expected: FAIL — `PATCH` route returns 404 (route not registered) / assertions fail.

- [ ] **Step 3: Add imports to `src/api/skills-repos.ts`**

At the top of `src/api/skills-repos.ts`, add:

```typescript
import { artifactRootRelativePath, artifactDisplayName } from "../util/artifact-key";
import { purgePathState } from "../engine/purge";
import type { ArtifactTypeId, SkillsRepo } from "../state/schema";
```

- [ ] **Step 4: Add the `PATCH` route implementation**

Insert this route inside `registerSkillsReposRoutes`, after the `POST` route and before the `DELETE` route:

```typescript
  app.patch<{
    Params: { id: string };
    Body: { name?: string; artifactPaths?: Partial<Record<ArtifactTypeId, string[]>> };
  }>("/api/skills-repos/:id", async (req, reply) => {
    const repo = await deps.skillsRepos.get(req.params.id);
    if (!repo) return reply.code(404).send({ code: "skills_repo_not_found" });

    const { name, artifactPaths } = req.body ?? {};
    if (name === undefined && artifactPaths === undefined) {
      throw new AppError("bad_input", "name or artifactPaths required");
    }

    // Diff paths per type.
    const removed: { type: ArtifactTypeId; path: string }[] = [];
    const added: { type: ArtifactTypeId; path: string }[] = [];
    if (artifactPaths) {
      const types = new Set<ArtifactTypeId>([
        ...Object.keys(repo.artifactPaths) as ArtifactTypeId[],
        ...Object.keys(artifactPaths) as ArtifactTypeId[],
      ]);
      for (const type of types) {
        const before = repo.artifactPaths[type] ?? [];
        const after = artifactPaths[type] ?? before; // omitted type = unchanged
        for (const p of before) if (!after.includes(p)) removed.push({ type, path: p });
        for (const p of after) if (!before.includes(p)) added.push({ type, path: p });
      }
    }

    // Guard removed paths.
    if (removed.length > 0) {
      const installs = await deps.installs.list();
      const mine = installs.filter((i) => i.sourceRepoId === repo.id);
      const blockers = removed
        .map(({ type, path }) => {
          const artifacts = mine
            .filter((i) => artifactRootRelativePath(i.artifactKey).startsWith(`${path}/`))
            .map((i) => ({ artifactKey: i.artifactKey, name: artifactDisplayName(i.artifactKey) }));
          return { type, path, artifacts };
        })
        .filter((b) => b.artifacts.length > 0);
      if (blockers.length > 0) {
        return reply.code(409).send({ code: "paths_in_use", blockers });
      }
    }

    // Build the patch. For artifactPaths, merge onto the existing object so
    // omitted types are preserved.
    const patch: { name?: string; artifactPaths?: SkillsRepo["artifactPaths"] } = {};
    if (name !== undefined) patch.name = name;
    let mergedPaths = repo.artifactPaths;
    if (artifactPaths) {
      mergedPaths = { ...repo.artifactPaths, ...artifactPaths };
      patch.artifactPaths = mergedPaths;
    }
    const updated = await deps.skillsRepos.update(repo.id, patch);

    // Seed added paths silently so they don't surface as new-artifact notifications.
    if (added.length > 0) {
      const artifacts = await discoverArtifacts(updated, deps.registries.types);
      const addedKeys = artifacts
        .filter((a) => added.some(({ path }) => a.rootRelativePath.startsWith(`${path}/`)))
        .map((a) => a.artifactKey);
      if (addedKeys.length > 0) await deps.snapshots.addToSnapshot(updated.id, addedKeys);
    }

    // Purge state for successfully-removed paths.
    for (const { path } of removed) {
      await purgePathState(deps, repo.id, path);
    }

    return updated;
  });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/integration/skills-repos-edit.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 6: Commit**

```bash
git add src/api/skills-repos.ts tests/integration/skills-repos-edit.test.ts
git commit -m "feat: PATCH route to rename skills repo and add/remove artifact paths"
```

---

### Task 5: Tighten `DELETE /api/skills-repos/:id` with an install guard + purge

**Files:**
- Modify: `src/api/skills-repos.ts`
- Test: `tests/integration/skills-repos-edit.test.ts` (add a new `describe` block)

**Interfaces:**
- Consumes: `artifactDisplayName` (Task 1); `purgeRepoState` (Task 3); `deps.installs`.
- Produces: updated `DELETE /api/skills-repos/:id`.
  - `204` on success (clone removed, entry removed, state purged).
  - `409 { code: "repo_in_use", blockers: Array<{ artifactKey: string; name: string }> }` when any install references the repo.

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/skills-repos-edit.test.ts`:

```typescript
import { purgeRepoState } from "../../src/engine/purge.ts";

describe("DELETE /api/skills-repos/:id — guard + purge", () => {
  it("blocks removal when an artifact is installed and lists the blocker", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const fx = await buildFixtureRepo([{ message: "init", files: { "ai/skills/foo/SKILL.md": "# Foo\n" } }]);
    const repo = await register(app, fx.fileUrl, { skills: ["ai/skills"] });
    await deps.installs.add({
      artifactKey: `${repo.id}:ai/skills/foo`, sourceRepoId: repo.id,
      target: { type: "working-repo", workingRepoId: "wr1" }, agent: "claude-code",
      artifactType: "skills", installedCommitSha: "sha1", autoUpdate: false,
      installedFiles: [], installedAt: new Date().toISOString(),
    });

    const res = await app.inject({ method: "DELETE", url: `/api/skills-repos/${repo.id}` });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      code: "repo_in_use",
      blockers: [{ artifactKey: `${repo.id}:ai/skills/foo`, name: "foo" }],
    });
    // Repo still present.
    const list = await app.inject({ method: "GET", url: "/api/skills-repos" });
    expect(list.json()).toHaveLength(1);
  });

  it("removes the repo and purges its state when nothing is installed", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const fx = await buildFixtureRepo([{ message: "init", files: { "ai/skills/foo/SKILL.md": "# Foo\n" } }]);
    const repo = await register(app, fx.fileUrl, { skills: ["ai/skills"] });
    await deps.favorites.setFavorite(`${repo.id}:ai/skills/foo`, true);

    const res = await app.inject({ method: "DELETE", url: `/api/skills-repos/${repo.id}` });
    expect(res.statusCode).toBe(204);
    const list = await app.inject({ method: "GET", url: "/api/skills-repos" });
    expect(list.json()).toHaveLength(0);
    expect((await deps.favorites.listFavorites()).size).toBe(0);
    expect((await deps.snapshots.getSnapshot(repo.id)).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/skills-repos-edit.test.ts`
Expected: FAIL — the current DELETE returns 204 even with an install (no guard yet), so the 409 test fails.

- [ ] **Step 3: Add the `purgeRepoState` import**

In `src/api/skills-repos.ts`, extend the purge import from Task 4:

```typescript
import { purgePathState, purgeRepoState } from "../engine/purge";
```

- [ ] **Step 4: Replace the DELETE route body**

Replace the existing DELETE handler in `src/api/skills-repos.ts`:

```typescript
  app.delete<{ Params: { id: string } }>("/api/skills-repos/:id", async (req, reply) => {
    const r = await deps.skillsRepos.get(req.params.id);
    if (!r) return reply.code(404).send({ code: "skills_repo_not_found" });
    await removeClone(r.localClonePath);
    await deps.skillsRepos.remove(req.params.id);
    return reply.code(204).send();
  });
```

with:

```typescript
  app.delete<{ Params: { id: string } }>("/api/skills-repos/:id", async (req, reply) => {
    const r = await deps.skillsRepos.get(req.params.id);
    if (!r) return reply.code(404).send({ code: "skills_repo_not_found" });

    const installs = await deps.installs.list();
    const blockers = installs
      .filter((i) => i.sourceRepoId === r.id)
      .map((i) => ({ artifactKey: i.artifactKey, name: artifactDisplayName(i.artifactKey) }));
    if (blockers.length > 0) {
      return reply.code(409).send({ code: "repo_in_use", blockers });
    }

    await purgeRepoState(deps, r.id);
    await removeClone(r.localClonePath);
    await deps.skillsRepos.remove(req.params.id);
    return reply.code(204).send();
  });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/integration/skills-repos-edit.test.ts`
Expected: PASS (all blocks, including the two new DELETE cases).

- [ ] **Step 6: Commit**

```bash
git add src/api/skills-repos.ts tests/integration/skills-repos-edit.test.ts
git commit -m "feat: guard skills-repo deletion on active installs and purge state"
```

---

### Task 6: Web API client — `updateSkillsRepo` + carry `blockers` on errors

**Files:**
- Modify: `web/api.ts`
- Test: none (thin client; covered by component tests in Tasks 7–8).

**Interfaces:**
- Consumes: the routes from Tasks 4–5.
- Produces:
  - `api.updateSkillsRepo(id, patch): Promise<SkillsRepo>`.
  - Errors thrown by `req` now also carry a `blockers` property when present in the response body.

- [ ] **Step 1: Attach `blockers` to thrown errors**

In `web/api.ts`, in the `req` helper, replace:

```typescript
    throw Object.assign(new Error(err.message ?? `HTTP ${res.status}`), { code: err.code, status: res.status });
```

with:

```typescript
    throw Object.assign(new Error(err.message ?? `HTTP ${res.status}`), {
      code: err.code, status: res.status, blockers: (err as { blockers?: unknown }).blockers,
    });
```

- [ ] **Step 2: Add the `updateSkillsRepo` client method**

In `web/api.ts`, in the `api` object, add directly after the `registerSkillsRepo` entry:

```typescript
  updateSkillsRepo: (id: string, patch: { name?: string; artifactPaths?: { skills?: string[]; rules?: string[] } }) =>
    req<SkillsRepo>("PATCH", `/api/skills-repos/${id}`, patch),
```

- [ ] **Step 3: Export blocker types for the UI**

In `web/api.ts`, add near the `SkillsRepo` interface:

```typescript
export interface ArtifactBlocker { artifactKey: string; name: string; }
export interface PathBlocker { type: "skills" | "rules"; path: string; artifacts: ArtifactBlocker[]; }
```

- [ ] **Step 4: Verify the frontend type-checks**

Run: `npx tsc -p tsconfig.fe.json --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add web/api.ts
git commit -m "feat: web client updateSkillsRepo and blocker types"
```

---

### Task 7: `EditSkillsRepoModal` + Edit buttons

**Files:**
- Create: `web/components/EditSkillsRepoModal.tsx`
- Modify: `web/pages/SkillsRepos.tsx`, `web/pages/SkillsRepoDetail.tsx`
- Test: `tests/unit/edit-skills-repo-modal.test.tsx`

**Interfaces:**
- Consumes: `api.updateSkillsRepo`, `PathBlocker` (Task 6); `SkillsRepo` (existing).
- Produces: `EditSkillsRepoModal({ repo, onClose, onDone })` — a modal editing name + skills/rules paths, rendering `paths_in_use` blockers inline with links to `/artifacts?artifactKey=…`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/edit-skills-repo-modal.test.tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";
import { EditSkillsRepoModal } from "../../web/components/EditSkillsRepoModal.tsx";

afterEach(cleanup);

const repo = {
  id: "r1", name: "superpowers", gitUrl: "https://x/y", branch: "main",
  artifactPaths: { skills: ["ai/skills"], rules: [] },
  presetId: null, localClonePath: "/tmp/r1", lastFetchedAt: null,
};

vi.mock("../../web/api.ts", () => ({
  api: { updateSkillsRepo: vi.fn() },
}));

function renderModal(onDone = vi.fn(), onClose = vi.fn()) {
  return render(
    <MemoryRouter>
      <EditSkillsRepoModal repo={repo} onClose={onClose} onDone={onDone} />
    </MemoryRouter>,
  );
}

describe("EditSkillsRepoModal", () => {
  it("pre-fills name and paths and saves the edited values", async () => {
    const { api } = await import("../../web/api.ts");
    (api.updateSkillsRepo as ReturnType<typeof vi.fn>).mockResolvedValue({ ...repo, name: "renamed" });
    const onDone = vi.fn();
    renderModal(onDone);

    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    expect(nameInput.value).toBe("superpowers");
    fireEvent.change(nameInput, { target: { value: "renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.updateSkillsRepo).toHaveBeenCalledWith("r1", {
      name: "renamed",
      artifactPaths: { skills: ["ai/skills"], rules: [] },
    }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("renders path blockers on a 409 and keeps the modal open", async () => {
    const { api } = await import("../../web/api.ts");
    (api.updateSkillsRepo as ReturnType<typeof vi.fn>).mockRejectedValue(Object.assign(new Error("paths in use"), {
      code: "paths_in_use",
      blockers: [{ type: "skills", path: "ai/skills", artifacts: [{ artifactKey: "r1:ai/skills/foo", name: "foo" }] }],
    }));
    const onDone = vi.fn();
    renderModal(onDone);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText(/Can't remove/);
    expect(screen.getByRole("link", { name: "foo" })).toHaveAttribute(
      "href", expect.stringContaining("artifactKey=r1%3Aai%2Fskills%2Ffoo"),
    );
    expect(onDone).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/edit-skills-repo-modal.test.tsx`
Expected: FAIL — cannot find module `web/components/EditSkillsRepoModal.tsx`.

- [ ] **Step 3: Implement the modal**

```tsx
// web/components/EditSkillsRepoModal.tsx
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, SkillsRepo, PathBlocker } from "../api.ts";

export function EditSkillsRepoModal({ repo, onClose, onDone }: { repo: SkillsRepo; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(repo.name);
  const [skillsPaths, setSkillsPaths] = useState((repo.artifactPaths.skills ?? []).join(", "));
  const [rulesPaths, setRulesPaths] = useState((repo.artifactPaths.rules ?? []).join(", "));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<PathBlocker[]>([]);

  const parse = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

  const submit = async () => {
    setError(null);
    setBlockers([]);
    setSubmitting(true);
    try {
      await api.updateSkillsRepo(repo.id, {
        name,
        artifactPaths: { skills: parse(skillsPaths), rules: parse(rulesPaths) },
      });
      onDone();
    } catch (e) {
      const err = e as Error & { code?: string; blockers?: PathBlocker[] };
      if (err.code === "paths_in_use" && err.blockers) setBlockers(err.blockers);
      else setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Edit skills repository</h3>
        <div className="field">
          <label htmlFor="edit-repo-name">Name</label>
          <input id="edit-repo-name" value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%" }} />
        </div>
        <div className="field">
          <label>Git URL</label>
          <input value={repo.gitUrl} disabled style={{ width: "100%" }} />
        </div>
        <div className="field">
          <label>Branch</label>
          <input value={repo.branch} disabled style={{ width: "100%" }} />
        </div>
        <div className="field">
          <label htmlFor="edit-repo-skills">Skills paths (comma-separated)</label>
          <input id="edit-repo-skills" value={skillsPaths} onChange={(e) => setSkillsPaths(e.target.value)} style={{ width: "100%" }} />
        </div>
        <div className="field">
          <label htmlFor="edit-repo-rules">Rules paths (comma-separated)</label>
          <input id="edit-repo-rules" value={rulesPaths} onChange={(e) => setRulesPaths(e.target.value)} style={{ width: "100%" }} />
        </div>
        {blockers.map((b) => (
          <div key={`${b.type}:${b.path}`} style={{ color: "var(--danger)", fontSize: 12, marginBottom: 8 }}>
            Can't remove <code>{b.path}</code> — still installed:{" "}
            {b.artifacts.map((a, i) => (
              <span key={a.artifactKey}>
                {i > 0 && ", "}
                <Link to={`/artifacts?artifactKey=${encodeURIComponent(a.artifactKey)}`}>{a.name}</Link>
              </span>
            ))}
          </div>
        ))}
        {error && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 8 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn secondary" onClick={onClose} disabled={submitting}>Cancel</button>
          <button className="btn" onClick={submit} disabled={submitting || !name}>Save</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/edit-skills-repo-modal.test.tsx`
Expected: PASS (both cases).

- [ ] **Step 5: Wire the Edit button into `SkillsRepoDetail.tsx`**

In `web/pages/SkillsRepoDetail.tsx`, add the import:

```typescript
import { EditSkillsRepoModal } from "../components/EditSkillsRepoModal.tsx";
```

Add editing state next to the existing state hooks:

```typescript
  const [editing, setEditing] = useState(false);
```

Add an Edit button beside the existing Refresh button (inside the same card `<div>`, right after the Refresh `<button>`):

```tsx
        <button className="btn secondary" style={{ marginTop: 8, marginLeft: 8 }} onClick={() => setEditing(true)}>Edit</button>
```

And render the modal just before the closing `</>` of the component's return:

```tsx
      {editing && (
        <EditSkillsRepoModal
          repo={repo}
          onClose={() => setEditing(false)}
          onDone={async () => { setEditing(false); setRepo(await api.getSkillsRepo(id)); setArtifacts(await api.listArtifacts({ sourceRepoId: id })); }}
        />
      )}
```

- [ ] **Step 6: Wire the Edit button into `SkillsRepos.tsx`**

In `web/pages/SkillsRepos.tsx`, add the import:

```typescript
import { EditSkillsRepoModal } from "../components/EditSkillsRepoModal.tsx";
```

Add editing state after the existing hooks:

```typescript
  const [editRepo, setEditRepo] = useState<SkillsRepo | null>(null);
```

In the actions cell, add an Edit button before the existing Remove button:

```tsx
              <td>
                <button className="btn secondary" onClick={() => setEditRepo(r)}>Edit</button>{" "}
                <button className="btn secondary" onClick={async () => { await api.deleteSkillsRepo(r.id); reload(); }}>Remove</button>
              </td>
```

And render the modal just before the register modal near the end of the return:

```tsx
      {editRepo && <EditSkillsRepoModal repo={editRepo} onClose={() => setEditRepo(null)} onDone={() => { setEditRepo(null); reload(); }} />}
```

- [ ] **Step 7: Type-check and run the affected component tests**

Run: `npx tsc -p tsconfig.fe.json --noEmit && npx vitest run tests/unit/edit-skills-repo-modal.test.tsx tests/unit/skills-repo-detail.test.tsx`
Expected: no type errors; tests PASS.

- [ ] **Step 8: Commit**

```bash
git add web/components/EditSkillsRepoModal.tsx web/pages/SkillsRepos.tsx web/pages/SkillsRepoDetail.tsx tests/unit/edit-skills-repo-modal.test.tsx
git commit -m "feat: edit-skills-repo modal with inline path-blocker feedback"
```

---

### Task 8: Guarded Remove in list + detail pages

**Files:**
- Modify: `web/pages/SkillsRepos.tsx`, `web/pages/SkillsRepoDetail.tsx`
- Test: `tests/unit/skills-repos-remove-guard.test.tsx`

**Interfaces:**
- Consumes: `api.deleteSkillsRepo` (now may reject with `code: "repo_in_use"` and `blockers: ArtifactBlocker[]`); `ArtifactBlocker` (Task 6).
- Produces: Remove handlers that, on a `repo_in_use` 409, show the blocking artifacts as links instead of a bare failure.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/skills-repos-remove-guard.test.tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";
import { SkillsRepos } from "../../web/pages/SkillsRepos.tsx";

afterEach(cleanup);

const repo = {
  id: "r1", name: "superpowers", gitUrl: "https://x/y", branch: "main",
  artifactPaths: { skills: ["ai/skills"], rules: [] },
  presetId: null, localClonePath: "/tmp/r1", lastFetchedAt: null,
};

vi.mock("../../web/api.ts", () => ({
  api: {
    listSkillsRepos: vi.fn(async () => [repo]),
    deleteSkillsRepo: vi.fn(),
  },
}));

describe("SkillsRepos — guarded remove", () => {
  it("shows blocker links when removal is refused", async () => {
    const { api } = await import("../../web/api.ts");
    (api.deleteSkillsRepo as ReturnType<typeof vi.fn>).mockRejectedValue(Object.assign(new Error("in use"), {
      code: "repo_in_use",
      blockers: [{ artifactKey: "r1:ai/skills/foo", name: "foo" }],
    }));
    render(<MemoryRouter><SkillsRepos /></MemoryRouter>);
    await screen.findByText("superpowers");
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await screen.findByText(/still installed/i);
    expect(screen.getByRole("link", { name: "foo" })).toHaveAttribute(
      "href", expect.stringContaining("artifactKey=r1%3Aai%2Fskills%2Ffoo"),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/skills-repos-remove-guard.test.tsx`
Expected: FAIL — no "still installed" text; the current handler just awaits `deleteSkillsRepo` and ignores the rejection.

- [ ] **Step 3: Add blocker state + guarded handler to `SkillsRepos.tsx`**

In `web/pages/SkillsRepos.tsx`, extend the existing api import to add `ArtifactBlocker`:

```typescript
import { api, SkillsRepo, ArtifactBlocker } from "../api.ts";
```

(`Link` from `react-router-dom` is already imported in this file — reuse it; do not add a second import.)

Add state after the existing hooks:

```typescript
  const [removeBlockers, setRemoveBlockers] = useState<{ repoName: string; blockers: ArtifactBlocker[] } | null>(null);

  const remove = async (r: SkillsRepo) => {
    setRemoveBlockers(null);
    try {
      await api.deleteSkillsRepo(r.id);
      reload();
    } catch (e) {
      const err = e as Error & { code?: string; blockers?: ArtifactBlocker[] };
      if (err.code === "repo_in_use" && err.blockers) setRemoveBlockers({ repoName: r.name, blockers: err.blockers });
      else alert(err.message);
    }
  };
```

Change the Remove button (from Task 7 step 6) to call `remove(r)`:

```tsx
                <button className="btn secondary" onClick={() => remove(r)}>Remove</button>
```

Render the blocker panel just below the `<h2>`/header row (before the `<table>`):

```tsx
      {removeBlockers && (
        <div className="card" style={{ marginBottom: 16, color: "var(--danger)", fontSize: 13 }}>
          Can't remove <strong>{removeBlockers.repoName}</strong> — still installed:{" "}
          {removeBlockers.blockers.map((a, i) => (
            <span key={a.artifactKey}>
              {i > 0 && ", "}
              <Link to={`/artifacts?artifactKey=${encodeURIComponent(a.artifactKey)}`}>{a.name}</Link>
            </span>
          ))}
        </div>
      )}
```

- [ ] **Step 4: Add the same guarded remove to `SkillsRepoDetail.tsx`**

In `web/pages/SkillsRepoDetail.tsx`, add state:

```typescript
  const [removeBlockers, setRemoveBlockers] = useState<ArtifactBlocker[] | null>(null);
```

Import `ArtifactBlocker` (extend the existing `../api.ts` import) and `useNavigate` from `react-router-dom` (extend the existing import):

```typescript
import { Link, useParams, useNavigate } from "react-router-dom";
import { api, Artifact, SkillsRepo, ArtifactBlocker } from "../api.ts";
```

Add `const navigate = useNavigate();` next to the other hooks, then add a Remove button beside the Edit button (from Task 7 step 5):

```tsx
        <button className="btn secondary" style={{ marginTop: 8, marginLeft: 8 }} onClick={async () => {
          setRemoveBlockers(null);
          try { await api.deleteSkillsRepo(repo.id); navigate("/skills-repos"); }
          catch (e) {
            const err = e as Error & { code?: string; blockers?: ArtifactBlocker[] };
            if (err.code === "repo_in_use" && err.blockers) setRemoveBlockers(err.blockers);
            else alert(err.message);
          }
        }}>Remove</button>
```

Render the blocker panel inside the card, after the Remove button:

```tsx
        {removeBlockers && (
          <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 8 }}>
            Can't remove this repository — still installed:{" "}
            {removeBlockers.map((a, i) => (
              <span key={a.artifactKey}>
                {i > 0 && ", "}
                <Link to={`/artifacts?artifactKey=${encodeURIComponent(a.artifactKey)}`}>{a.name}</Link>
              </span>
            ))}
          </div>
        )}
```

- [ ] **Step 5: Type-check and run the tests**

Run: `npx tsc -p tsconfig.fe.json --noEmit && npx vitest run tests/unit/skills-repos-remove-guard.test.tsx tests/unit/skills-repo-detail.test.tsx`
Expected: no type errors; tests PASS.

- [ ] **Step 6: Commit**

```bash
git add web/pages/SkillsRepos.tsx web/pages/SkillsRepoDetail.tsx tests/unit/skills-repos-remove-guard.test.tsx
git commit -m "feat: surface blocking artifacts when skills-repo removal is refused"
```

---

### Task 9: Full suite + product-spec note

**Files:**
- Modify: `docs/product-specification.md` (mark the edit capability as delivered, if it tracks status)
- Test: full suite.

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: all tests PASS (no regressions in existing suites).

- [ ] **Step 2: Build to confirm no type errors across BE + FE**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 3: Update the product spec wording (if applicable)**

In `docs/product-specification.md`, confirm the line "Edit, refresh (fetch latest), and remove registered skills repositories." accurately reflects the new edit capability (rename + add/remove paths). Adjust only if the current wording is now inaccurate; otherwise leave as-is.

- [ ] **Step 4: Commit any doc change**

```bash
git add docs/product-specification.md
git commit -m "docs: confirm skills-repo edit capability in product spec"
```

(Skip this commit if no doc change was needed.)

---

## Self-Review Notes

- **Spec coverage:** rename (Task 4), add paths + silent seeding (Task 4), remove path with guard + blockers + purge (Tasks 3–4), remove repo with guard + blockers + purge (Tasks 3, 5), global installs block (tested in Tasks 4–5), blocker links to artifact page (Tasks 7–8), edit modal (Task 7), web client + blocker types (Task 6). All § sections of the design map to a task.
- **All-or-nothing guards:** the PATCH handler computes blockers before any `update`/`purge` call; DELETE checks blockers before `purgeRepoState`/`removeClone`/`remove`. Verified in the "nothing changed" assertions.
- **Type consistency:** `artifactRootRelativePath`/`artifactDisplayName` (Task 1) are used verbatim in Task 4/5. `PathBlocker`/`ArtifactBlocker` (Task 6) are consumed unchanged in Tasks 7–8. `purgeRepoState`/`purgePathState` signatures (Task 3) match their call sites (Tasks 4–5). `updateSkillsRepo` shape matches the modal's call (Task 7).
