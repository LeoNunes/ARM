# Favorite Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users mark any artifact as a favorite so it sorts first wherever artifacts are listed (Browse, Skills-repo detail, MCP `search_artifacts`), per `docs/design.md` §8 "Favoriting artifacts".

**Architecture:** A new `FavoritesStore` (flat `artifactKey → true` map, same shape as `dismissed-notifications.json`) persists favorite state. A single shared `sortByFavorite` helper is applied server-side by every endpoint that returns a list of artifacts, so HTTP and MCP consumers never implement their own ordering. New `PUT`/`DELETE /api/artifacts/:artifactKey/favorite` endpoints toggle state; every artifact-shaped response gains an `isFavorite` field. A reusable `FavoriteStar` component renders the toggle on Browse, Skills-repo detail, and Artifact detail.

**Tech Stack:** TypeScript, Node.js, Fastify, React, Vitest, `@testing-library/react`, `simple-git`, MCP TypeScript SDK

## Global Constraints

- Test runner: `npm test` (vitest run — all tests in the project must pass at every commit)
- TypeScript strict mode; no `any` unless matching existing codebase patterns
- Follow the existing `JsonStore`-based store pattern for all state files (see `src/state/notifications.ts`, `src/state/artifact-sha-baseline.ts`)
- New state file `favorites.json` lives in `stateDir`, written via `JsonStore`
- Import style is inconsistent per-file in this codebase and is **not** a blanket rule: `src/state/*.ts` and `src/mcp/tools.ts` use `.js` extensions on relative imports (e.g. `from "./store.js"`); `src/api/artifacts.ts`, `src/server.ts`, and `src/index.ts` omit the extension (e.g. `from '../discovery/discover'`). Every code snippet in this plan already matches the convention of the specific file it edits — copy it as given rather than normalizing extensions. `tests/` and `web/` relative imports always use the full `.ts`/`.tsx` extension.
- `ServerDeps` (`src/server.ts`) is a single shared interface — every place that constructs a `ServerDeps`-shaped object literal (`src/index.ts` and every integration test's `makeDeps`/`setup` function) must be updated in lockstep or the build fails to typecheck. This plan enumerates every such call site explicitly.
- Sorting rule (from the design doc): favorited artifacts first, then the rest; alphabetical by name within each group.

---

### Task 1: FavoritesStore

**Files:**
- Create: `src/state/favorites.ts`
- Test: `tests/unit/favorites-store.test.ts`

**Interfaces:**
- Produces:
  ```ts
  class FavoritesStore {
    constructor(stateDir: string)
    isFavorite(artifactKey: string): Promise<boolean>
    setFavorite(artifactKey: string, favorited: boolean): Promise<void>
    listFavorites(): Promise<Set<string>>
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/favorites-store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FavoritesStore } from "../../src/state/favorites.ts";

describe("FavoritesStore", () => {
  let dir: string;
  let store: FavoritesStore;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "favorites-test-"));
    store = new FavoritesStore(dir);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("isFavorite returns false for unknown artifact", async () => {
    expect(await store.isFavorite("r1:skills/foo")).toBe(false);
  });

  it("setFavorite(true) marks an artifact favorited", async () => {
    await store.setFavorite("r1:skills/foo", true);
    expect(await store.isFavorite("r1:skills/foo")).toBe(true);
  });

  it("setFavorite(false) unmarks a favorited artifact", async () => {
    await store.setFavorite("r1:skills/foo", true);
    await store.setFavorite("r1:skills/foo", false);
    expect(await store.isFavorite("r1:skills/foo")).toBe(false);
  });

  it("setFavorite(true) is idempotent", async () => {
    await store.setFavorite("r1:skills/foo", true);
    await store.setFavorite("r1:skills/foo", true);
    const set = await store.listFavorites();
    expect(set.size).toBe(1);
  });

  it("setFavorite(false) on a never-favorited key is a no-op", async () => {
    await store.setFavorite("r1:skills/foo", false);
    expect(await store.isFavorite("r1:skills/foo")).toBe(false);
    expect((await store.listFavorites()).size).toBe(0);
  });

  it("listFavorites returns all favorited keys", async () => {
    await store.setFavorite("r1:skills/foo", true);
    await store.setFavorite("r1:skills/bar", true);
    const set = await store.listFavorites();
    expect(set.has("r1:skills/foo")).toBe(true);
    expect(set.has("r1:skills/bar")).toBe(true);
    expect(set.size).toBe(2);
  });

  it("persists across store instances backed by the same directory", async () => {
    await store.setFavorite("r1:skills/foo", true);
    const reopened = new FavoritesStore(dir);
    expect(await reopened.isFavorite("r1:skills/foo")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npx vitest run tests/unit/favorites-store.test.ts
```
Expected: FAIL with "Cannot find module '../../src/state/favorites.ts'" (or similar resolution error)

- [ ] **Step 3: Create `src/state/favorites.ts`**

```ts
import path from "node:path";
import { JsonStore } from "./store.js";

export class FavoritesStore {
  private store: JsonStore<Record<string, boolean>>;

  constructor(stateDir: string) {
    this.store = new JsonStore<Record<string, boolean>>(
      path.join(stateDir, "favorites.json"),
      {},
    );
  }

  async isFavorite(artifactKey: string): Promise<boolean> {
    const data = await this.store.read();
    return !!data[artifactKey];
  }

  async setFavorite(artifactKey: string, favorited: boolean): Promise<void> {
    const data = await this.store.read();
    if (favorited) {
      data[artifactKey] = true;
    } else {
      delete data[artifactKey];
    }
    await this.store.write(data);
  }

  async listFavorites(): Promise<Set<string>> {
    const data = await this.store.read();
    return new Set(Object.keys(data));
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npx vitest run tests/unit/favorites-store.test.ts
```
Expected: all 7 tests PASS

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```
Expected: all tests pass (purely additive, no regressions possible)

- [ ] **Step 6: Commit**

```bash
git add src/state/favorites.ts tests/unit/favorites-store.test.ts
git commit -m "feat: add FavoritesStore for persisting favorited artifacts"
```

---

### Task 2: `sortByFavorite` helper

**Files:**
- Create: `src/discovery/sort.ts`
- Test: `tests/unit/sort-by-favorite.test.ts`

**Interfaces:**
- Produces:
  ```ts
  function sortByFavorite<T extends { artifactKey: string; name: string }>(
    artifacts: T[],
    favoriteKeys: Set<string>,
  ): T[]
  ```
  Does not depend on `FavoritesStore` directly — takes a plain `Set<string>` so it stays a pure, easily-testable function.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/sort-by-favorite.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sortByFavorite } from "../../src/discovery/sort.ts";

interface Item { artifactKey: string; name: string; }

describe("sortByFavorite", () => {
  it("puts favorited artifacts before non-favorited ones", () => {
    const items: Item[] = [
      { artifactKey: "r1:a", name: "alpha" },
      { artifactKey: "r1:b", name: "bravo" },
      { artifactKey: "r1:c", name: "charlie" },
    ];
    const favorites = new Set(["r1:c"]);
    const sorted = sortByFavorite(items, favorites);
    expect(sorted.map((i) => i.artifactKey)).toEqual(["r1:c", "r1:a", "r1:b"]);
  });

  it("sorts alphabetically by name within the favorited group", () => {
    const items: Item[] = [
      { artifactKey: "r1:z", name: "zulu" },
      { artifactKey: "r1:a", name: "alpha" },
    ];
    const favorites = new Set(["r1:z", "r1:a"]);
    const sorted = sortByFavorite(items, favorites);
    expect(sorted.map((i) => i.name)).toEqual(["alpha", "zulu"]);
  });

  it("sorts alphabetically by name within the non-favorited group", () => {
    const items: Item[] = [
      { artifactKey: "r1:z", name: "zulu" },
      { artifactKey: "r1:a", name: "alpha" },
    ];
    const sorted = sortByFavorite(items, new Set());
    expect(sorted.map((i) => i.name)).toEqual(["alpha", "zulu"]);
  });

  it("sorts alphabetically when the favorites set is empty", () => {
    const items: Item[] = [
      { artifactKey: "r1:b", name: "bravo" },
      { artifactKey: "r1:a", name: "alpha" },
    ];
    const sorted = sortByFavorite(items, new Set());
    expect(sorted.map((i) => i.name)).toEqual(["alpha", "bravo"]);
  });

  it("ignores a favorite key that doesn't match any artifact (orphaned entry)", () => {
    const items: Item[] = [{ artifactKey: "r1:a", name: "alpha" }];
    const favorites = new Set(["r1:gone"]);
    const sorted = sortByFavorite(items, favorites);
    expect(sorted.map((i) => i.artifactKey)).toEqual(["r1:a"]);
  });

  it("does not mutate the input array", () => {
    const items: Item[] = [
      { artifactKey: "r1:b", name: "bravo" },
      { artifactKey: "r1:a", name: "alpha" },
    ];
    const original = [...items];
    sortByFavorite(items, new Set(["r1:b"]));
    expect(items).toEqual(original);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npx vitest run tests/unit/sort-by-favorite.test.ts
```
Expected: FAIL with "Cannot find module '../../src/discovery/sort.ts'"

- [ ] **Step 3: Create `src/discovery/sort.ts`**

```ts
export function sortByFavorite<T extends { artifactKey: string; name: string }>(
  artifacts: T[],
  favoriteKeys: Set<string>,
): T[] {
  return [...artifacts].sort((a, b) => {
    const aFav = favoriteKeys.has(a.artifactKey);
    const bFav = favoriteKeys.has(b.artifactKey);
    if (aFav !== bFav) return aFav ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npx vitest run tests/unit/sort-by-favorite.test.ts
```
Expected: all 6 tests PASS

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/discovery/sort.ts tests/unit/sort-by-favorite.test.ts
git commit -m "feat: add sortByFavorite helper for favorites-first artifact ordering"
```

---

### Task 3: Wire `FavoritesStore` into `ServerDeps` + favorite toggle API + `isFavorite`/sorting on `/api/artifacts`

**Files:**
- Modify: `src/server.ts` — add `favorites: FavoritesStore` to `ServerDeps`
- Modify: `src/index.ts` — instantiate `FavoritesStore`
- Modify: `tests/integration/api.test.ts` — add `favorites` to `makeDeps`; add new favorite-endpoint tests
- Modify: `tests/integration/mcp.test.ts` — add `favorites` to `makeDeps`
- Modify: `tests/integration/notifications-api.test.ts` — add `favorites` to `setup`
- Modify: `tests/integration/activity-log-api.test.ts` — add `favorites` to `makeDeps`
- Modify: `tests/integration/diff-api.test.ts` — add `favorites` to `setup`
- Modify: `src/api/artifacts.ts` — sort + `isFavorite` on list/get; new `PUT`/`DELETE` favorite routes

**Interfaces:**
- Consumes: `FavoritesStore` (Task 1) — `isFavorite`, `setFavorite`, `listFavorites`; `sortByFavorite` (Task 2)
- Produces:
  - `ServerDeps.favorites: FavoritesStore`
  - `GET /api/artifacts` → array of artifacts, favorites-first sorted, each with `isFavorite: boolean`
  - `GET /api/artifacts/:artifactKey` → artifact with `isFavorite: boolean`
  - `PUT /api/artifacts/:artifactKey/favorite` → 204, or 404 `artifact_not_found`
  - `DELETE /api/artifacts/:artifactKey/favorite` → 204, or 404 `artifact_not_found`

- [ ] **Step 1: Add `favorites` to `ServerDeps` in `src/server.ts`**

Add this import alongside the other `type` imports:

```ts
import type { FavoritesStore } from './state/favorites';
```

Add this field to the `ServerDeps` interface, after `shaBaseline: ArtifactShaBaselineStore;`:

```ts
  favorites: FavoritesStore;
```

- [ ] **Step 2: Instantiate `FavoritesStore` in `src/index.ts`**

Add this import alongside the other store imports:

```ts
import { FavoritesStore } from './state/favorites';
```

Add this line alongside the other store instantiations (after `const shaBaseline = new ArtifactShaBaselineStore(stateDir);`):

```ts
  const favorites = new FavoritesStore(stateDir);
```

Add `favorites` to the `buildServer(...)` call's argument object (alongside `shaBaseline`).

- [ ] **Step 3: Update `tests/integration/api.test.ts`**

Add this import after the `ArtifactShaBaselineStore` import:

```ts
import { FavoritesStore } from "../../src/state/favorites.ts";
```

Add this line to the object returned by `makeDeps()`, after `shaBaseline: new ArtifactShaBaselineStore(stateDir),`:

```ts
    favorites: new FavoritesStore(stateDir),
```

- [ ] **Step 4: Update `tests/integration/mcp.test.ts`**

Add this import after the `ArtifactShaBaselineStore` import:

```ts
import { FavoritesStore } from "../../src/state/favorites.ts";
```

Add this line to the object returned by `makeDeps()`, after `shaBaseline: new ArtifactShaBaselineStore(stateDir),`:

```ts
    favorites: new FavoritesStore(stateDir),
```

- [ ] **Step 5: Update `tests/integration/notifications-api.test.ts`**

Add this import after the `ArtifactShaBaselineStore` import:

```ts
import { FavoritesStore } from "../../src/state/favorites.ts";
```

Inside `setup()`, add this line after `shaBaseline = new ArtifactShaBaselineStore(stateDir);`:

```ts
  const favorites = new FavoritesStore(stateDir);
```

Add `favorites` to the `buildServer({...})` call's argument object (alongside `shaBaseline`).

- [ ] **Step 6: Update `tests/integration/activity-log-api.test.ts`**

Add this import after the `ArtifactShaBaselineStore` import:

```ts
import { FavoritesStore } from "../../src/state/favorites.ts";
```

Add this line to the object returned by `makeDeps()`, after `shaBaseline: new ArtifactShaBaselineStore(stateDir),`:

```ts
    favorites: new FavoritesStore(stateDir),
```

- [ ] **Step 7: Update `tests/integration/diff-api.test.ts`**

Add this import after the `ArtifactShaBaselineStore` import:

```ts
import { FavoritesStore } from "../../src/state/favorites.ts";
```

Inside `setup()`, add this line after `const shaBaseline = new ArtifactShaBaselineStore(stateDir);`:

```ts
  const favorites = new FavoritesStore(stateDir);
```

Add `favorites` to the `buildServer({...})` call's argument object (alongside `shaBaseline`).

- [ ] **Step 8: Run the full test suite to confirm the wiring compiles and nothing regressed**

```bash
npm test
```
Expected: all tests pass (this step is pure infrastructure wiring — no new behavior yet)

- [ ] **Step 9: Write the failing tests for favorite endpoints and sorting**

Append this block to the end of `tests/integration/api.test.ts`:

```ts
describe("API /artifacts — favorites", () => {
  async function seedTwoArtifacts() {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const fx = await buildFixtureRepo([
      { message: "init", files: {
        "ai/skills/zulu/SKILL.md": "# Zulu\n",
        "ai/skills/alpha/SKILL.md": "# Alpha\n",
      } },
    ]);
    await app.inject({
      method: "POST", url: "/api/skills-repos",
      payload: { name: "src", gitUrl: fx.fileUrl, branch: "main", artifactPaths: { skills: ["ai/skills"] } },
    });
    const arts = (await app.inject({ method: "GET", url: "/api/artifacts" })).json();
    const zulu = arts.find((a: { name: string }) => a.name === "zulu");
    const alpha = arts.find((a: { name: string }) => a.name === "alpha");
    return { app, zulu, alpha };
  }

  it("GET /api/artifacts includes isFavorite=false by default, alphabetically sorted", async () => {
    const { app } = await seedTwoArtifacts();
    const res = await app.inject({ method: "GET", url: "/api/artifacts" });
    const arts = res.json();
    expect(arts.map((a: { name: string }) => a.name)).toEqual(["alpha", "zulu"]);
    expect(arts.every((a: { isFavorite: boolean }) => a.isFavorite === false)).toBe(true);
  });

  it("PUT /api/artifacts/:artifactKey/favorite marks an artifact favorited and sorts it first", async () => {
    const { app, zulu } = await seedTwoArtifacts();
    const put = await app.inject({
      method: "PUT", url: `/api/artifacts/${encodeURIComponent(zulu.artifactKey)}/favorite`,
    });
    expect(put.statusCode).toBe(204);

    const res = await app.inject({ method: "GET", url: "/api/artifacts" });
    const arts = res.json();
    expect(arts.map((a: { name: string }) => a.name)).toEqual(["zulu", "alpha"]);
    expect(arts.find((a: { name: string }) => a.name === "zulu").isFavorite).toBe(true);
  });

  it("GET /api/artifacts/:artifactKey reflects favorited status", async () => {
    const { app, alpha } = await seedTwoArtifacts();
    await app.inject({ method: "PUT", url: `/api/artifacts/${encodeURIComponent(alpha.artifactKey)}/favorite` });
    const res = await app.inject({ method: "GET", url: `/api/artifacts/${encodeURIComponent(alpha.artifactKey)}` });
    expect(res.json().isFavorite).toBe(true);
  });

  it("DELETE /api/artifacts/:artifactKey/favorite unmarks a favorited artifact", async () => {
    const { app, zulu } = await seedTwoArtifacts();
    await app.inject({ method: "PUT", url: `/api/artifacts/${encodeURIComponent(zulu.artifactKey)}/favorite` });
    const del = await app.inject({
      method: "DELETE", url: `/api/artifacts/${encodeURIComponent(zulu.artifactKey)}/favorite`,
    });
    expect(del.statusCode).toBe(204);
    const res = await app.inject({ method: "GET", url: `/api/artifacts/${encodeURIComponent(zulu.artifactKey)}` });
    expect(res.json().isFavorite).toBe(false);
  });

  it("PUT on an unknown artifactKey returns 404 artifact_not_found", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const res = await app.inject({ method: "PUT", url: "/api/artifacts/nonexistent%3Afoo/favorite" });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("artifact_not_found");
  });

  it("DELETE on an unknown artifactKey returns 404 artifact_not_found", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const res = await app.inject({ method: "DELETE", url: "/api/artifacts/nonexistent%3Afoo/favorite" });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("artifact_not_found");
  });
});
```

- [ ] **Step 10: Run the new tests to confirm they fail**

```bash
npx vitest run tests/integration/api.test.ts -t "favorites"
```
Expected: FAIL — `isFavorite` is `undefined` in assertions, and `PUT`/`DELETE` return 404 "Not Found" from Fastify's default 404 handler (no such route registered yet)

- [ ] **Step 11: Replace `src/api/artifacts.ts` with the favorite-aware version**

```ts
import type { FastifyInstance } from "fastify";
import type { ServerDeps } from '../server';
import { discoverArtifacts } from '../discovery/discover';
import { sortByFavorite } from '../discovery/sort';
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
      const filtered = all.filter((a) => {
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
      const favorites = await deps.favorites.listFavorites();
      const sorted = sortByFavorite(filtered, favorites);
      return sorted.map((a) => ({ ...a, isFavorite: favorites.has(a.artifactKey) }));
    },
  );

  app.get<{ Params: { artifactKey: string } }>("/api/artifacts/:artifactKey", async (req, reply) => {
    const a = (await discoverAll(deps)).find((x) => x.artifactKey === decodeURIComponent(req.params.artifactKey));
    if (!a) return reply.code(404).send({ code: "artifact_not_found" });
    const isFavorite = await deps.favorites.isFavorite(a.artifactKey);
    return { ...a, isFavorite };
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

  app.put<{ Params: { artifactKey: string } }>("/api/artifacts/:artifactKey/favorite", async (req, reply) => {
    const key = decodeURIComponent(req.params.artifactKey);
    const a = (await discoverAll(deps)).find((x) => x.artifactKey === key);
    if (!a) throw new AppError("artifact_not_found", `artifact not found: ${key}`);
    await deps.favorites.setFavorite(key, true);
    return reply.code(204).send();
  });

  app.delete<{ Params: { artifactKey: string } }>("/api/artifacts/:artifactKey/favorite", async (req, reply) => {
    const key = decodeURIComponent(req.params.artifactKey);
    const a = (await discoverAll(deps)).find((x) => x.artifactKey === key);
    if (!a) throw new AppError("artifact_not_found", `artifact not found: ${key}`);
    await deps.favorites.setFavorite(key, false);
    return reply.code(204).send();
  });
}

async function discoverAll(deps: ServerDeps): Promise<DiscoveredArtifact[]> {
  const sources = await deps.skillsRepos.list();
  const out: DiscoveredArtifact[] = [];
  for (const s of sources) out.push(...(await discoverArtifacts(s, deps.registries.types)));
  return out;
}
```

- [ ] **Step 12: Run the new tests to confirm they pass**

```bash
npx vitest run tests/integration/api.test.ts -t "favorites"
```
Expected: all 6 new tests PASS

- [ ] **Step 13: Run the full test suite**

```bash
npm test
```
Expected: all tests pass (no regressions — existing `/api/artifacts` assertions only check `name`, unaffected by the new `isFavorite` field)

- [ ] **Step 14: Commit**

```bash
git add src/server.ts src/index.ts src/api/artifacts.ts \
  tests/integration/api.test.ts tests/integration/mcp.test.ts \
  tests/integration/notifications-api.test.ts tests/integration/activity-log-api.test.ts \
  tests/integration/diff-api.test.ts
git commit -m "feat: add favorite toggle API and favorites-first sorting to /api/artifacts"
```

---

### Task 4: MCP surface — `search_artifacts` sorting + `isFavorite` on `search_artifacts`/`get_artifact`

**Files:**
- Modify: `src/mcp/tools.ts`
- Modify: `tests/integration/mcp.test.ts` — new test cases

**Interfaces:**
- Consumes: `deps.favorites` (Task 3, already present on `ServerDeps`), `sortByFavorite` (Task 2)
- Produces: `search_artifacts` results sorted favorites-first, each with `isFavorite`; `get_artifact` result includes `isFavorite`

- [ ] **Step 1: Write the failing tests**

Append this test to the `describe("MCP search_artifacts", ...)` block in `tests/integration/mcp.test.ts` (inside the existing `describe`, after the last `it(...)`):

```ts
  it("sorts favorited artifacts first and includes isFavorite on each result", async () => {
    const deps = await makeDeps();
    await seedRepo(deps);
    const { client } = await makeMcpClient(deps);
    const before = parseResult(await client.callTool({ name: "search_artifacts", arguments: {} }));
    const bar = before.find((a: { name: string }) => a.name === "bar");
    await deps.favorites.setFavorite(bar.artifactKey, true);

    const result = await client.callTool({ name: "search_artifacts", arguments: {} });
    const artifacts = parseResult(result);
    expect(artifacts[0].name).toBe("bar");
    expect(artifacts[0].isFavorite).toBe(true);
    expect(artifacts[1].isFavorite).toBe(false);
  });
```

Append this test to the `describe("MCP get_artifact", ...)` block, after the last `it(...)`:

```ts
  it("includes isFavorite in the response", async () => {
    const deps = await makeDeps();
    const fx = await buildFixtureRepo([
      { message: "add foo", files: { "ai/skills/foo/SKILL.md": "# Foo\n" } },
    ]);
    const cloneDest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, cloneDest, "main");
    const repo = await deps.skillsRepos.add({
      name: "src", gitUrl: fx.fileUrl, branch: "main",
      artifactPaths: { skills: ["ai/skills"] }, presetId: null,
      localClonePath: cloneDest, lastFetchedAt: null,
    });
    const artifactKey = `${repo.id}:ai/skills/foo`;
    await deps.favorites.setFavorite(artifactKey, true);
    const { client } = await makeMcpClient(deps);
    const result = await client.callTool({ name: "get_artifact", arguments: { artifactKey } });
    expect(parseResult(result).isFavorite).toBe(true);
  });
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
npx vitest run tests/integration/mcp.test.ts -t "isFavorite"
```
Expected: FAIL — `isFavorite` is `undefined` on both results

- [ ] **Step 3: Update `src/mcp/tools.ts`**

Add this import alongside the existing imports at the top of the file:

```ts
import { sortByFavorite } from "../discovery/sort.js";
```

Replace the `search_artifacts` tool handler:

```ts
  server.tool(
    "search_artifacts",
    "Search artifacts across registered sources; optional q, type, sourceRepoId filters",
    {
      q: z.string().optional().describe("Case-insensitive search in name and description"),
      type: z.string().optional().describe("Filter by artifact type (e.g. skills)"),
      sourceRepoId: z.string().optional().describe("Filter by source repository id"),
    },
    async ({ q, type, sourceRepoId }) => {
      const all = await discoverAll(deps);
      const filtered = all.filter((a) => {
        if (sourceRepoId && a.sourceRepoId !== sourceRepoId) return false;
        if (type && a.type !== type) return false;
        if (q) {
          const needle = q.toLowerCase();
          if (
            !a.name.toLowerCase().includes(needle) &&
            !(a.description ?? "").toLowerCase().includes(needle)
          ) {
            return false;
          }
        }
        return true;
      });
      const favorites = await deps.favorites.listFavorites();
      const sorted = sortByFavorite(filtered, favorites);
      const withFavorites = sorted.map((a) => ({ ...a, isFavorite: favorites.has(a.artifactKey) }));
      return { content: [{ type: "text" as const, text: JSON.stringify(withFavorites) }] };
    },
  );
```

Replace the `get_artifact` tool handler:

```ts
  server.tool(
    "get_artifact",
    "Get artifact metadata, file list, and version history (no file contents)",
    { artifactKey: z.string() },
    async ({ artifactKey }) => {
      const all = await discoverAll(deps);
      const artifact = all.find((a) => a.artifactKey === artifactKey);
      if (!artifact) return toolError("artifact_not_found", `artifact not found: ${artifactKey}`);
      const repo = await deps.skillsRepos.get(artifact.sourceRepoId);
      if (!repo) return toolError("artifact_not_found", `source repo not found: ${artifact.sourceRepoId}`);
      let versionHistory: Awaited<ReturnType<typeof recentShasTouching>> = [];
      try {
        versionHistory = await recentShasTouching(repo.localClonePath, repo.branch, artifact.files);
      } catch {
        // leave versionHistory empty if the clone is temporarily unreachable
      }
      const isFavorite = await deps.favorites.isFavorite(artifact.artifactKey);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ ...artifact, versionHistory, isFavorite }) }],
      };
    },
  );
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
npx vitest run tests/integration/mcp.test.ts -t "isFavorite"
```
Expected: both new tests PASS

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/mcp/tools.ts tests/integration/mcp.test.ts
git commit -m "feat: sort search_artifacts favorites-first and expose isFavorite over MCP"
```

---

### Task 5: `FavoriteStar` component

**Files:**
- Create: `web/components/FavoriteStar.tsx`
- Test: `tests/unit/favorite-star.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  function FavoriteStar(props: { favorited: boolean; onToggle: () => void }): JSX.Element
  ```
  Renders `★` (filled) when favorited, `☆` (outline) when not. Click calls `onToggle` and stops propagation, so it's safe to nest inside a clickable row.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/favorite-star.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { FavoriteStar } from "../../web/components/FavoriteStar.tsx";

describe("FavoriteStar", () => {
  it("renders a filled star when favorited", () => {
    render(<FavoriteStar favorited={true} onToggle={() => {}} />);
    expect(screen.getByRole("button").textContent).toBe("★");
  });

  it("renders an outline star when not favorited", () => {
    render(<FavoriteStar favorited={false} onToggle={() => {}} />);
    expect(screen.getByRole("button").textContent).toBe("☆");
  });

  it("calls onToggle when clicked", () => {
    const onToggle = vi.fn();
    render(<FavoriteStar favorited={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("does not propagate the click to an ancestor handler", () => {
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <FavoriteStar favorited={false} onToggle={() => {}} />
      </div>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(parentClick).not.toHaveBeenCalled();
  });

  it("has an accessible label reflecting current state", () => {
    render(<FavoriteStar favorited={true} onToggle={() => {}} />);
    expect(screen.getByRole("button", { name: "Unfavorite" })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npx vitest run tests/unit/favorite-star.test.tsx
```
Expected: FAIL with "Cannot find module '../../web/components/FavoriteStar.tsx'"

- [ ] **Step 3: Create `web/components/FavoriteStar.tsx`**

```tsx
export function FavoriteStar({ favorited, onToggle }: { favorited: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label={favorited ? "Unfavorite" : "Favorite"}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        color: favorited ? "#f5b400" : "var(--muted)",
        fontSize: 16,
        lineHeight: 1,
        padding: 2,
      }}
    >
      {favorited ? "★" : "☆"}
    </button>
  );
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npx vitest run tests/unit/favorite-star.test.tsx
```
Expected: all 5 tests PASS

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add web/components/FavoriteStar.tsx tests/unit/favorite-star.test.tsx
git commit -m "feat: add FavoriteStar toggle component"
```

---

### Task 6: `web/api.ts` client + wire into Browse

**Files:**
- Modify: `web/api.ts` — add `isFavorite` to `Artifact`, add `api.setFavorite`
- Modify: `tests/unit/install-modal.test.tsx` — add `isFavorite` to the literal `Artifact` fixture (required field, or the file fails to typecheck)
- Modify: `web/pages/Browse.tsx` — render `FavoriteStar` per row
- Create: `tests/unit/browse.test.tsx`

**Interfaces:**
- Consumes: `FavoriteStar` (Task 5); backend `PUT`/`DELETE /api/artifacts/:artifactKey/favorite` and `isFavorite` field on `GET /api/artifacts` (Task 3)
- Produces:
  ```ts
  interface Artifact { /* existing fields */ isFavorite: boolean; }
  api.setFavorite(artifactKey: string, favorited: boolean): Promise<void>
  ```

- [ ] **Step 1: Update the `Artifact` interface in `web/api.ts`**

Find:

```ts
export interface Artifact {
  artifactKey: string; sourceRepoId: string; type: "skills";
  name: string; description: string | null;
  rootRelativePath: string; files: string[]; lastTouchedSha: string | null;
}
```

Replace with:

```ts
export interface Artifact {
  artifactKey: string; sourceRepoId: string; type: "skills";
  name: string; description: string | null;
  rootRelativePath: string; files: string[]; lastTouchedSha: string | null;
  isFavorite: boolean;
}
```

- [ ] **Step 2: Fix the now-broken `Artifact` literal in `tests/unit/install-modal.test.tsx`**

Find:

```ts
const artifact: Artifact = {
  artifactKey: "src1:ai/skills/foo", sourceRepoId: "src1", type: "skills",
  name: "foo", description: null, rootRelativePath: "ai/skills/foo",
  files: ["ai/skills/foo/SKILL.md"], lastTouchedSha: "abc",
};
```

Replace with:

```ts
const artifact: Artifact = {
  artifactKey: "src1:ai/skills/foo", sourceRepoId: "src1", type: "skills",
  name: "foo", description: null, rootRelativePath: "ai/skills/foo",
  files: ["ai/skills/foo/SKILL.md"], lastTouchedSha: "abc", isFavorite: false,
};
```

- [ ] **Step 3: Add `api.setFavorite` in `web/api.ts`**

Find the `listArtifacts` entry in the `api` object:

```ts
  listArtifacts: (q?: { q?: string; type?: string; sourceRepoId?: string }, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (q?.q) params.set("q", q.q);
    if (q?.type) params.set("type", q.type);
    if (q?.sourceRepoId) params.set("sourceRepoId", q.sourceRepoId);
    const qs = params.toString();
    return req<Artifact[]>("GET", `/api/artifacts${qs ? `?${qs}` : ""}`, undefined, signal);
  },
```

Add this entry immediately after it:

```ts
  setFavorite: (artifactKey: string, favorited: boolean) =>
    req<void>(favorited ? "PUT" : "DELETE", `/api/artifacts/${encodeURIComponent(artifactKey)}/favorite`),
```

- [ ] **Step 4: Run the full suite to confirm it still compiles (no new behavior tested yet)**

```bash
npm test
```
Expected: all tests pass

- [ ] **Step 5: Write the failing test for Browse**

Create `tests/unit/browse.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";
import { Browse } from "../../web/pages/Browse.tsx";

afterEach(cleanup);

const mockArtifacts = [
  {
    artifactKey: "src1:skills/bravo", sourceRepoId: "src1", type: "skills" as const,
    name: "bravo", description: "Bravo skill.", rootRelativePath: "skills/bravo",
    files: [], lastTouchedSha: "sha1", isFavorite: false,
  },
  {
    artifactKey: "src1:skills/alpha", sourceRepoId: "src1", type: "skills" as const,
    name: "alpha", description: "Alpha skill.", rootRelativePath: "skills/alpha",
    files: [], lastTouchedSha: "sha2", isFavorite: true,
  },
];

vi.mock("../../web/api.ts", () => ({
  api: {
    listArtifacts: vi.fn(async () => mockArtifacts),
    setFavorite: vi.fn(async () => undefined),
  },
}));

function renderBrowse() {
  return render(<MemoryRouter><Browse /></MemoryRouter>);
}

describe("Browse — favorite star", () => {
  it("renders a filled star for a favorited artifact and an outline star for a non-favorited one", async () => {
    renderBrowse();
    await screen.findByText("alpha");
    expect(screen.getByRole("button", { name: "Unfavorite" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Favorite" })).toBeTruthy();
  });

  it("calls api.setFavorite with the toggled value when a star is clicked", async () => {
    const { api } = await import("../../web/api.ts");
    renderBrowse();
    await screen.findByText("alpha");
    fireEvent.click(screen.getByRole("button", { name: "Unfavorite" }));
    expect(api.setFavorite).toHaveBeenCalledWith("src1:skills/alpha", false);
  });
});
```

- [ ] **Step 6: Run the test to confirm it fails**

```bash
npx vitest run tests/unit/browse.test.tsx
```
Expected: FAIL — no button with accessible name "Favorite"/"Unfavorite" is rendered yet

- [ ] **Step 7: Replace `web/pages/Browse.tsx`**

```tsx
// web/pages/Browse.tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, Artifact } from "../api.ts";
import { InstallModal } from "../components/InstallModal.tsx";
import { FavoriteStar } from "../components/FavoriteStar.tsx";
import { useAutoRefresh } from "../hooks/useAutoRefresh.ts";

export function Browse() {
  const [q, setQ] = useState("");
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [installing, setInstalling] = useState<Artifact | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    api.listArtifacts({ q: q || undefined }, ac.signal)
      .then(setArtifacts)
      .catch(() => {});
    return () => ac.abort();
  }, [q]);

  useAutoRefresh(() => {
    const ac = new AbortController();
    api.listArtifacts({ q: q || undefined }, ac.signal)
      .then(setArtifacts)
      .catch(() => {});
  });

  const handleToggleFavorite = async (a: Artifact) => {
    const next = !a.isFavorite;
    setArtifacts((prev) => prev.map((x) => (x.artifactKey === a.artifactKey ? { ...x, isFavorite: next } : x)));
    try {
      await api.setFavorite(a.artifactKey, next);
      setArtifacts(await api.listArtifacts({ q: q || undefined }));
    } catch (e) {
      setArtifacts((prev) => prev.map((x) => (x.artifactKey === a.artifactKey ? { ...x, isFavorite: !next } : x)));
      alert((e as Error).message);
    }
  };

  return (
    <>
      <h2 style={{ marginTop: 0 }}>Browse</h2>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" style={{ width: 360, marginBottom: 14 }} />
      <table className="table">
        <thead><tr><th></th><th>Name</th><th>Source</th><th>Description</th><th></th></tr></thead>
        <tbody>
          {artifacts.map((a) => (
            <tr key={a.artifactKey}>
              <td>
                <FavoriteStar favorited={a.isFavorite} onToggle={() => handleToggleFavorite(a)} />
              </td>
              <td>
                <Link
                  to={`/artifacts?artifactKey=${encodeURIComponent(a.artifactKey)}`}
                  style={{ color: "inherit", textDecoration: "none", fontWeight: 500 }}
                >
                  {a.name}
                </Link>
              </td>
              <td style={{ color: "var(--muted)" }}>{a.sourceRepoId.slice(0, 8)}</td>
              <td style={{ color: "var(--muted)" }}>
                {a.description ? (
                  <div className="description-clamp" title={a.description} style={{ maxWidth: 320 }}>
                    {a.description}
                  </div>
                ) : (
                  "—"
                )}
              </td>
              <td><button className="btn" onClick={() => setInstalling(a)}>Install</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {installing && <InstallModal artifact={installing} onClose={() => setInstalling(null)} onDone={() => setInstalling(null)} />}
    </>
  );
}
```

- [ ] **Step 8: Run the test to confirm it passes**

```bash
npx vitest run tests/unit/browse.test.tsx
```
Expected: both tests PASS

- [ ] **Step 9: Run the full test suite**

```bash
npm test
```
Expected: all tests pass

- [ ] **Step 10: Commit**

```bash
git add web/api.ts web/pages/Browse.tsx tests/unit/browse.test.tsx tests/unit/install-modal.test.tsx
git commit -m "feat: wire favorite toggle into Browse"
```

---

### Task 7: Wire into Skills-repo detail

**Files:**
- Modify: `web/pages/SkillsRepoDetail.tsx`
- Create: `tests/unit/skills-repo-detail.test.tsx`

**Interfaces:**
- Consumes: `FavoriteStar` (Task 5), `api.setFavorite` (Task 6)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/skills-repo-detail.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SkillsRepoDetail } from "../../web/pages/SkillsRepoDetail.tsx";

afterEach(cleanup);

const mockRepo = {
  id: "src1", name: "superpowers",
  gitUrl: "https://github.com/example/superpowers",
  branch: "main",
  artifactPaths: { skills: ["skills"] },
  presetId: null,
  localClonePath: "/tmp/src1",
  lastFetchedAt: "2026-05-23T10:00:00Z",
};

const mockArtifacts = [
  {
    artifactKey: "src1:skills/bravo", sourceRepoId: "src1", type: "skills" as const,
    name: "bravo", description: "Bravo skill.", rootRelativePath: "skills/bravo",
    files: [], lastTouchedSha: "sha1", isFavorite: false,
  },
  {
    artifactKey: "src1:skills/alpha", sourceRepoId: "src1", type: "skills" as const,
    name: "alpha", description: "Alpha skill.", rootRelativePath: "skills/alpha",
    files: [], lastTouchedSha: "sha2", isFavorite: true,
  },
];

vi.mock("../../web/api.ts", () => ({
  api: {
    getSkillsRepo: vi.fn(async () => mockRepo),
    listArtifacts: vi.fn(async () => mockArtifacts),
    setFavorite: vi.fn(async () => undefined),
  },
}));

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={["/skills-repos/src1"]}>
      <Routes>
        <Route path="/skills-repos/:id" element={<SkillsRepoDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SkillsRepoDetail — favorite star", () => {
  it("renders a filled star for a favorited artifact and an outline star for a non-favorited one", async () => {
    renderDetail();
    await screen.findByText("alpha");
    expect(screen.getByRole("button", { name: "Unfavorite" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Favorite" })).toBeTruthy();
  });

  it("calls api.setFavorite with the toggled value when a star is clicked", async () => {
    const { api } = await import("../../web/api.ts");
    renderDetail();
    await screen.findByText("alpha");
    fireEvent.click(screen.getByRole("button", { name: "Favorite" }));
    expect(api.setFavorite).toHaveBeenCalledWith("src1:skills/bravo", true);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npx vitest run tests/unit/skills-repo-detail.test.tsx
```
Expected: FAIL — no button with accessible name "Favorite"/"Unfavorite" is rendered yet

- [ ] **Step 3: Replace `web/pages/SkillsRepoDetail.tsx`**

```tsx
// web/pages/SkillsRepoDetail.tsx
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, Artifact, SkillsRepo } from "../api.ts";
import { FavoriteStar } from "../components/FavoriteStar.tsx";

export function SkillsRepoDetail() {
  const { id = "" } = useParams();
  const [repo, setRepo] = useState<SkillsRepo | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getSkillsRepo(id).then(setRepo).catch((e: Error) => setError(e.message));
    api.listArtifacts({ sourceRepoId: id }).then(setArtifacts).catch(() => {});
  }, [id]);

  const handleToggleFavorite = async (a: Artifact) => {
    const next = !a.isFavorite;
    setArtifacts((prev) => prev.map((x) => (x.artifactKey === a.artifactKey ? { ...x, isFavorite: next } : x)));
    try {
      await api.setFavorite(a.artifactKey, next);
      setArtifacts(await api.listArtifacts({ sourceRepoId: id }));
    } catch (e) {
      setArtifacts((prev) => prev.map((x) => (x.artifactKey === a.artifactKey ? { ...x, isFavorite: !next } : x)));
      alert((e as Error).message);
    }
  };

  if (error) return <p style={{ color: "red" }}>Error: {error}</p>;
  if (!repo) return <p>Loading…</p>;

  return (
    <>
      <p style={{ color: "var(--muted)", fontSize: 12 }}><Link to="/skills-repos">Skills repos</Link> / {repo.name}</p>
      <h2 style={{ marginTop: 0 }}>{repo.name}</h2>
      <div className="card" style={{ marginBottom: 16, fontSize: 13 }}>
        <div><strong>Git URL:</strong> {repo.gitUrl}</div>
        <div><strong>Branch:</strong> {repo.branch}</div>
        <div><strong>Skills paths:</strong> {(repo.artifactPaths.skills ?? []).join(", ") || "(none)"}</div>
        <div style={{ color: "var(--muted)", marginTop: 6 }}>Last fetched: {repo.lastFetchedAt ?? "—"}</div>
        <button className="btn secondary" style={{ marginTop: 8 }} onClick={async () => {
          try {
            const updated = await api.refreshSkillsRepo(repo.id);
            setRepo(updated);
            setArtifacts(await api.listArtifacts({ sourceRepoId: repo.id }));
          } catch (err) {
            alert((err as Error).message);
          }
        }}>Refresh</button>
      </div>
      <h3>Discovered artifacts</h3>
      <table className="table">
        <thead><tr><th></th><th>Name</th><th>Type</th><th>Description</th><th>Path</th></tr></thead>
        <tbody>
          {artifacts.map((a) => (
            <tr key={a.artifactKey}>
              <td>
                <FavoriteStar favorited={a.isFavorite} onToggle={() => handleToggleFavorite(a)} />
              </td>
              <td>
                <Link
                  to={`/artifacts?artifactKey=${encodeURIComponent(a.artifactKey)}`}
                  style={{ color: "inherit", textDecoration: "none", fontWeight: 500 }}
                >
                  {a.name}
                </Link>
              </td>
              <td>{a.type}</td>
              <td style={{ color: "var(--muted)" }}>
                {a.description ? (
                  <div className="description-clamp" title={a.description} style={{ maxWidth: 320 }}>
                    {a.description}
                  </div>
                ) : (
                  "—"
                )}
              </td>
              <td style={{ color: "var(--muted)" }}>{a.rootRelativePath}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npx vitest run tests/unit/skills-repo-detail.test.tsx
```
Expected: both tests PASS

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add web/pages/SkillsRepoDetail.tsx tests/unit/skills-repo-detail.test.tsx
git commit -m "feat: wire favorite toggle into Skills-repo detail"
```

---

### Task 8: Wire into Artifact detail

**Files:**
- Modify: `web/pages/ArtifactDetail.tsx`
- Modify: `tests/unit/artifact-detail.test.tsx`

**Interfaces:**
- Consumes: `FavoriteStar` (Task 5), `api.setFavorite` (Task 6)

- [ ] **Step 1: Write the failing tests**

In `tests/unit/artifact-detail.test.tsx`, find the `mockArtifact` object:

```ts
const mockArtifact = {
  artifactKey: "src1:skills/foo",
  sourceRepoId: "src1",
  type: "skills" as const,
  name: "foo",
  description: "Does foo things.",
  rootRelativePath: "skills/foo",
  files: ["skills/foo/SKILL.md", "skills/foo/helper.sh"],
  lastTouchedSha: "abc1234567890123",
};
```

Replace with:

```ts
const mockArtifact = {
  artifactKey: "src1:skills/foo",
  sourceRepoId: "src1",
  type: "skills" as const,
  name: "foo",
  description: "Does foo things.",
  rootRelativePath: "skills/foo",
  files: ["skills/foo/SKILL.md", "skills/foo/helper.sh"],
  lastTouchedSha: "abc1234567890123",
  isFavorite: false,
};
```

Find the `vi.mock("../../web/api.ts", ...)` block:

```ts
vi.mock("../../web/api.ts", () => ({
  api: {
    getArtifact: vi.fn(async () => mockArtifact),
    getArtifactHistory: vi.fn(async () => mockHistory),
    getArtifactFile: vi.fn(async () => "# Foo\nskill content"),
    listInstallsByArtifact: vi.fn(async () => mockInstalls),
    listWorkingRepos: vi.fn(async () => [
      { id: "w1", name: "my-repo", path: "/home/dev/my-repo", addedAt: "2026-01-01T00:00:00Z" },
    ]),
    getSettings: vi.fn(async () => ({ favoriteAgent: "claude-code", mcpPort: 7747, autoRefreshEnabled: false, autoRefreshIntervalMinutes: 30 })),
    deleteInstall: vi.fn(async () => undefined),
    applyInstallUpdate: vi.fn(async () => ({ ...mockInstalls[0] })),
    reapplyInstall: vi.fn(async () => ({ ...mockInstalls[0] })),
    updateInstall: vi.fn(async () => ({ ...mockInstalls[0] })),
  },
}));
```

Replace with:

```ts
vi.mock("../../web/api.ts", () => ({
  api: {
    getArtifact: vi.fn(async () => mockArtifact),
    getArtifactHistory: vi.fn(async () => mockHistory),
    getArtifactFile: vi.fn(async () => "# Foo\nskill content"),
    listInstallsByArtifact: vi.fn(async () => mockInstalls),
    listWorkingRepos: vi.fn(async () => [
      { id: "w1", name: "my-repo", path: "/home/dev/my-repo", addedAt: "2026-01-01T00:00:00Z" },
    ]),
    getSettings: vi.fn(async () => ({ favoriteAgent: "claude-code", mcpPort: 7747, autoRefreshEnabled: false, autoRefreshIntervalMinutes: 30 })),
    deleteInstall: vi.fn(async () => undefined),
    applyInstallUpdate: vi.fn(async () => ({ ...mockInstalls[0] })),
    reapplyInstall: vi.fn(async () => ({ ...mockInstalls[0] })),
    updateInstall: vi.fn(async () => ({ ...mockInstalls[0] })),
    setFavorite: vi.fn(async () => undefined),
  },
}));
```

Append this new describe block at the end of the file:

```tsx
describe("ArtifactDetail — Favorite star", () => {
  it("renders an outline star when the artifact is not favorited", async () => {
    renderDetail();
    expect(await screen.findByRole("button", { name: "Favorite" })).toBeTruthy();
  });

  it("renders a filled star when the artifact is favorited", async () => {
    const { api } = await import("../../web/api.ts");
    vi.mocked(api.getArtifact).mockResolvedValueOnce({ ...mockArtifact, isFavorite: true });
    renderDetail();
    expect(await screen.findByRole("button", { name: "Unfavorite" })).toBeTruthy();
  });

  it("calls api.setFavorite when the star is clicked", async () => {
    const { api } = await import("../../web/api.ts");
    renderDetail();
    const star = await screen.findByRole("button", { name: "Favorite" });
    fireEvent.click(star);
    expect(api.setFavorite).toHaveBeenCalledWith("src1:skills/foo", true);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
npx vitest run tests/unit/artifact-detail.test.tsx -t "Favorite star"
```
Expected: FAIL — no button with accessible name "Favorite"/"Unfavorite" is rendered yet

- [ ] **Step 3: Add the import to `web/pages/ArtifactDetail.tsx`**

Find:

```tsx
import { InstallModal } from "../components/InstallModal.tsx";
import { StatusPill } from "../components/StatusPill.tsx";
```

Replace with:

```tsx
import { InstallModal } from "../components/InstallModal.tsx";
import { StatusPill } from "../components/StatusPill.tsx";
import { FavoriteStar } from "../components/FavoriteStar.tsx";
```

- [ ] **Step 4: Add the toggle handler**

Find:

```tsx
  const handleDisableAutoUpdate = async (id: string) => {
    try { await api.updateInstall(id, { autoUpdate: false }); reload(); } catch (e) { alert((e as Error).message); }
  };
```

Replace with:

```tsx
  const handleDisableAutoUpdate = async (id: string) => {
    try { await api.updateInstall(id, { autoUpdate: false }); reload(); } catch (e) { alert((e as Error).message); }
  };
  const handleToggleFavorite = async () => {
    if (!artifact) return;
    try {
      await api.setFavorite(artifact.artifactKey, !artifact.isFavorite);
      reload();
    } catch (e) {
      alert((e as Error).message);
    }
  };
```

- [ ] **Step 5: Render the star in the header**

Find:

```tsx
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>{artifactName}</h2>
        <span style={{
          fontSize: 11, padding: "2px 8px", borderRadius: 10,
          background: "rgba(255,255,255,0.08)", color: "var(--muted)",
        }}>
          {artifact.type === "skills" ? "skill" : artifact.type}
        </span>
        <button className="btn" style={{ marginLeft: "auto" }} onClick={() => setInstalling(true)}>
          Install
        </button>
      </div>
```

Replace with:

```tsx
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>{artifactName}</h2>
        <span style={{
          fontSize: 11, padding: "2px 8px", borderRadius: 10,
          background: "rgba(255,255,255,0.08)", color: "var(--muted)",
        }}>
          {artifact.type === "skills" ? "skill" : artifact.type}
        </span>
        <FavoriteStar favorited={artifact.isFavorite} onToggle={handleToggleFavorite} />
        <button className="btn" style={{ marginLeft: "auto" }} onClick={() => setInstalling(true)}>
          Install
        </button>
      </div>
```

- [ ] **Step 6: Run the tests to confirm they pass**

```bash
npx vitest run tests/unit/artifact-detail.test.tsx
```
Expected: all tests in the file PASS (existing tests + 3 new ones)

- [ ] **Step 7: Run the full test suite**

```bash
npm test
```
Expected: all tests pass

- [ ] **Step 8: Commit**

```bash
git add web/pages/ArtifactDetail.tsx tests/unit/artifact-detail.test.tsx
git commit -m "feat: wire favorite toggle into Artifact detail header"
```
