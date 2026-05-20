# Skills Manager — Slice 1 (Walking Skeleton) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working end-to-end Skills Manager that can register a skills repository (via git URL + per-type paths), register a working repository, browse discovered skills, and install a skill into a working repository for either Claude Code or Cursor — with all installed files tracked locally and ignored by git via `.git/info/exclude`. No updates, no drift, no MCP, no diff viewer — those land in later slices.

**Architecture:** A single Node.js + TypeScript backend (Fastify) serves a React + Vite SPA over HTTP on localhost and persists state as JSON files in an OS-appropriate user-data directory. Agent and artifact-type behavior live behind small, registry-based adapter interfaces so adding Cursor + Claude Code does not bake those names into the engine. All git operations shell out to the user's `git` binary via `simple-git`.

**Tech Stack:** Node.js 20+ (ESM), TypeScript, Fastify, simple-git, env-paths, uuid, Vitest, React 18, Vite, react-router-dom, `open` (cross-platform browser launcher).

**Reference:** This plan implements Slice 1 of the design described in `docs/design.md` against the product capabilities in `docs/product-specification.md`. Read those before starting.

---

## File structure

The full slice-1 codebase. Each file has one responsibility; tasks group by file/component.

```
/                                       (repo root)
├── package.json                         npm scripts, deps, "type": "module"
├── tsconfig.json                        base TS config
├── tsconfig.be.json                     BE-only TS config (outputs dist/be)
├── tsconfig.fe.json                     FE TS config (used by Vite)
├── vitest.config.ts                     test runner config
├── vite.config.ts                       FE bundler config (outputs dist/web)
├── bin/skillmgr.js                      thin launcher: boots BE, opens browser
├── src/                                 BE source
│   ├── index.ts                         BE entry: parses args, starts server, prints URL
│   ├── server.ts                        Fastify server: registers routes, serves dist/web
│   ├── ports.ts                         pickFreePort(default) helper
│   ├── state/
│   │   ├── paths.ts                     state dir resolution via env-paths
│   │   ├── schema.ts                    TS types: SettingsFile, SkillsRepo, WorkingRepo, Install
│   │   ├── store.ts                     generic JSON file store
│   │   ├── settings.ts                  SettingsStore (favorite agent, mcp port)
│   │   ├── skills-repos.ts              SkillsRepoStore (CRUD)
│   │   ├── working-repos.ts             WorkingRepoStore (CRUD)
│   │   ├── installs.ts                  InstallsStore (CRUD)
│   │   └── presets.ts                   PresetsStore (read-only, bundled)
│   ├── git/
│   │   ├── client.ts                    simple-git wrapper
│   │   ├── clone.ts                     clone-into-cache helper
│   │   ├── show.ts                      read file at <sha>:<path>
│   │   └── log.ts                       commit-touches-files helper
│   ├── adapters/
│   │   ├── types.ts                     AgentAdapter, ArtifactTypeAdapter interfaces
│   │   ├── registry.ts                  AgentRegistry, ArtifactTypeRegistry
│   │   ├── agents/claude-code.ts        Claude Code agent adapter
│   │   ├── agents/cursor.ts             Cursor agent adapter
│   │   └── artifact-types/skills.ts     skills artifact-type adapter
│   ├── discovery/
│   │   └── discover.ts                  source repo + path → artifacts with SHAs
│   ├── engine/
│   │   ├── install.ts                   install engine
│   │   ├── uninstall.ts                 uninstall engine
│   │   └── exclude-block.ts             .git/info/exclude block manager
│   ├── api/
│   │   ├── routes.ts                    register all routes
│   │   ├── skills-repos.ts              /api/skills-repos
│   │   ├── working-repos.ts             /api/working-repos
│   │   ├── artifacts.ts                 /api/artifacts (browse + detail + content)
│   │   ├── installs.ts                  /api/installs (create + list + delete)
│   │   └── settings.ts                  /api/settings
│   └── util/
│       ├── errors.ts                    typed AppError + http-mapper
│       └── ids.ts                       uuid wrapper
├── web/                                 FE source
│   ├── index.html
│   ├── main.tsx
│   ├── App.tsx
│   ├── api.ts                           fetch wrappers
│   ├── routes.tsx
│   ├── components/Sidebar.tsx
│   ├── components/InstallModal.tsx
│   ├── components/RegisterSkillsRepoModal.tsx
│   ├── components/RegisterWorkingRepoModal.tsx
│   ├── pages/Dashboard.tsx
│   ├── pages/Browse.tsx
│   ├── pages/SkillsRepos.tsx
│   ├── pages/SkillsRepoDetail.tsx
│   ├── pages/WorkingRepos.tsx
│   ├── pages/WorkingRepoDetail.tsx
│   └── pages/Settings.tsx
└── tests/
    ├── helpers/
    │   ├── tmp-dir.ts                   per-test tmpdir + cleanup
    │   └── build-fixture-repo.ts        manifest → real git repo on disk
    ├── unit/
    │   ├── exclude-block.test.ts
    │   ├── agents.claude-code.test.ts
    │   ├── agents.cursor.test.ts
    │   └── artifact-types.skills.test.ts
    └── integration/
        ├── state.test.ts
        ├── git.test.ts
        ├── discover.test.ts
        ├── install.test.ts
        ├── uninstall.test.ts
        └── api.test.ts
```

---

## Phases at a glance

1. **Project scaffolding** — Tasks 1–3
2. **State layer** — Tasks 4–9
3. **Git wrapper** — Tasks 10–11
4. **Adapters** — Tasks 12–16
5. **Discovery** — Task 17
6. **Install engine** — Tasks 18–21
7. **HTTP API** — Tasks 22–27
8. **FE shell + API client** — Tasks 28–29
9. **FE pages + modals** — Tasks 30–35
10. **Launcher + smoke** — Tasks 36–37

## Phase 1 — Project scaffolding

### Task 1: Initialize project + base TS config

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.be.json`
- Create: `.gitignore`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "skills-manager",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "skillmgr": "bin/skillmgr.js" },
  "scripts": {
    "dev:be": "tsx watch src/index.ts",
    "dev:fe": "vite",
    "build:fe": "vite build",
    "build:be": "tsc -p tsconfig.be.json",
    "build": "npm run build:fe && npm run build:be",
    "start": "node bin/skillmgr.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "fastify": "^4.28.0",
    "@fastify/static": "^7.0.4",
    "simple-git": "^3.25.0",
    "env-paths": "^3.0.0",
    "uuid": "^10.0.0",
    "open": "^10.1.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "tsx": "^4.16.0",
    "@types/node": "^20.14.0",
    "@types/uuid": "^10.0.0",
    "vitest": "^2.0.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.25.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "vite": "^5.3.0",
    "@vitejs/plugin-react": "^4.3.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`** (base)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 3: Create `tsconfig.be.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "dist/be",
    "rootDir": "src",
    "declaration": false
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
.superpowers/
*.log
.vite/
```

- [ ] **Step 5: Install deps**

Run: `npm install`
Expected: lockfile created, `node_modules/` populated, no errors.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.be.json .gitignore
git commit -m "chore: initialize project scaffolding and base TS config"
```

---

### Task 2: Vitest config + smoke test

**Files:**
- Create: `vitest.config.ts`
- Create: `tests/smoke.test.ts`

- [ ] **Step 1: Create `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "node",
    testTimeout: 30000,
  },
});
```

- [ ] **Step 2: Write smoke test**

```typescript
// tests/smoke.test.ts
import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: 1 passed.

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts tests/smoke.test.ts
git commit -m "chore: add vitest config and smoke test"
```

---

### Task 3: Vite config + minimal FE entry

**Files:**
- Create: `tsconfig.fe.json`
- Create: `vite.config.ts`
- Create: `web/index.html`
- Create: `web/main.tsx`
- Create: `web/App.tsx`

- [ ] **Step 1: Create `tsconfig.fe.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "noEmit": true
  },
  "include": ["web/**/*"]
}
```

- [ ] **Step 2: Create `vite.config.ts`**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "../dist/web", emptyOutDir: true },
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:7747" } },
});
```

- [ ] **Step 3: Create `web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Skills Manager</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Create `web/App.tsx`**

```tsx
export function App() {
  return <div>Skills Manager — slice 1</div>;
}
```

- [ ] **Step 5: Create `web/main.tsx`**

```tsx
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

createRoot(document.getElementById("root")!).render(<App />);
```

- [ ] **Step 6: Verify FE builds**

Run: `npm run build:fe`
Expected: `dist/web/index.html` exists, no errors.

- [ ] **Step 7: Commit**

```bash
git add tsconfig.fe.json vite.config.ts web/
git commit -m "feat(fe): scaffold React + Vite FE entry"
```

---

## Phase 2 — State layer

### Task 4: State directory resolution

**Files:**
- Create: `src/state/paths.ts`
- Create: `tests/integration/state.test.ts`

- [ ] **Step 1: Write failing test for `resolveStateDir`**

```typescript
// tests/integration/state.test.ts
import { describe, it, expect } from "vitest";
import { resolveStateDir } from "../../src/state/paths.ts";

describe("resolveStateDir", () => {
  it("returns an absolute path under the OS user-data dir for 'skillmanager'", () => {
    const dir = resolveStateDir();
    expect(dir).toBeTypeOf("string");
    expect(dir.length).toBeGreaterThan(0);
    expect(dir).toMatch(/skillmanager/i);
  });
});
```

- [ ] **Step 2: Run test (should fail — module missing)**

Run: `npm test -- tests/integration/state.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `resolveStateDir`**

```typescript
// src/state/paths.ts
import envPaths from "env-paths";
import { mkdirSync } from "node:fs";
import path from "node:path";

const PATHS = envPaths("skillmanager", { suffix: "" });

export function resolveStateDir(): string {
  return PATHS.data;
}

export function resolveCacheDir(): string {
  return path.join(PATHS.data, "cache");
}

export function resolveLogDir(): string {
  return path.join(PATHS.data, "logs");
}

export function ensureStateDirs(): void {
  mkdirSync(resolveStateDir(), { recursive: true });
  mkdirSync(resolveCacheDir(), { recursive: true });
  mkdirSync(resolveLogDir(), { recursive: true });
}
```

- [ ] **Step 4: Run test (should pass)**

Run: `npm test -- tests/integration/state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state/paths.ts tests/integration/state.test.ts
git commit -m "feat(state): resolve OS user-data dir via env-paths"
```

---

### Task 5: TypeScript schema for state files

**Files:**
- Create: `src/state/schema.ts`

This file is types-only; no test (TS itself is the test). Tasks 6+ will exercise it.

- [ ] **Step 1: Write `schema.ts`**

```typescript
// src/state/schema.ts
export type AgentId = "claude-code" | "cursor";
export type ArtifactTypeId = "skills"; // expanded in later slices

export interface SettingsFile {
  favoriteAgent: AgentId;
  mcpPort: number;
}

export interface SkillsRepo {
  id: string;
  name: string;
  gitUrl: string;
  branch: string;
  artifactPaths: Partial<Record<ArtifactTypeId, string[]>>;
  presetId: string | null;
  localClonePath: string;
  lastFetchedAt: string | null;
}

export interface WorkingRepo {
  id: string;
  name: string;
  path: string;
  addedAt: string;
}

export type InstallTarget =
  | { type: "working-repo"; workingRepoId: string }
  | { type: "global" };

export interface InstalledFile {
  sourcePath: string;
  targetPath: string;
}

export interface Install {
  id: string;
  artifactKey: string;       // "<sourceRepoId>:<relativePath>"
  sourceRepoId: string;
  target: InstallTarget;
  agent: AgentId;
  installedCommitSha: string;
  autoUpdate: boolean;
  installedFiles: InstalledFile[];
  installedAt: string;
}

export interface Preset {
  id: string;
  name: string;
  gitUrl: string;
  branch: string;
  artifactPaths: Partial<Record<ArtifactTypeId, string[]>>;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc -p tsconfig.be.json --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/state/schema.ts
git commit -m "feat(state): add TS schema for state files"
```

---

### Task 6: Generic JSON store

**Files:**
- Create: `src/state/store.ts`
- Modify: `tests/integration/state.test.ts`

The store handles atomic read/write of a single JSON file with a default value. Writes go through a tmp-file + rename to avoid corrupting on crash.

- [ ] **Step 1: Add failing test for `JsonStore`**

Append to `tests/integration/state.test.ts`:

```typescript
import { JsonStore } from "../../src/state/store.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";
import path from "node:path";

describe("JsonStore", () => {
  it("returns the default when file is missing, then persists writes", async () => {
    const dir = await tmpDir();
    const store = new JsonStore<{ count: number }>(path.join(dir, "x.json"), { count: 0 });
    expect(await store.read()).toEqual({ count: 0 });
    await store.write({ count: 7 });
    expect(await store.read()).toEqual({ count: 7 });
    const fresh = new JsonStore<{ count: number }>(path.join(dir, "x.json"), { count: 0 });
    expect(await fresh.read()).toEqual({ count: 7 });
  });
});
```

- [ ] **Step 2: Add tmp-dir helper**

```typescript
// tests/helpers/tmp-dir.ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const created: string[] = [];

export async function tmpDir(prefix = "skillmgr-test-"): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

export async function cleanupTmpDirs(): Promise<void> {
  for (const d of created.splice(0)) {
    await rm(d, { recursive: true, force: true });
  }
}
```

- [ ] **Step 3: Wire cleanup into vitest**

Append to `vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "node",
    testTimeout: 30000,
    globalSetup: [],
    setupFiles: ["tests/helpers/setup.ts"],
  },
});
```

Create `tests/helpers/setup.ts`:

```typescript
import { afterEach } from "vitest";
import { cleanupTmpDirs } from "./tmp-dir.ts";

afterEach(async () => {
  await cleanupTmpDirs();
});
```

- [ ] **Step 4: Run test (should fail — module missing)**

Run: `npm test -- tests/integration/state.test.ts`
Expected: FAIL with "Cannot find module ../../src/state/store.ts".

- [ ] **Step 5: Implement `JsonStore`**

```typescript
// src/state/store.ts
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export class JsonStore<T> {
  constructor(private filePath: string, private defaultValue: T) {}

  async read(): Promise<T> {
    if (!existsSync(this.filePath)) return structuredClone(this.defaultValue);
    const raw = await readFile(this.filePath, "utf8");
    return JSON.parse(raw) as T;
  }

  async write(value: T): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
    await rename(tmp, this.filePath);
  }
}
```

- [ ] **Step 6: Run test (should pass)**

Run: `npm test -- tests/integration/state.test.ts`
Expected: 2 passed (resolveStateDir + JsonStore).

- [ ] **Step 7: Commit**

```bash
git add src/state/store.ts tests/helpers/ tests/integration/state.test.ts vitest.config.ts
git commit -m "feat(state): generic JsonStore with atomic writes"
```

---

### Task 7: SettingsStore

**Files:**
- Create: `src/state/settings.ts`
- Modify: `tests/integration/state.test.ts`

- [ ] **Step 1: Write failing test**

Append to `tests/integration/state.test.ts`:

```typescript
import { SettingsStore } from "../../src/state/settings.ts";

describe("SettingsStore", () => {
  it("defaults favoriteAgent to claude-code and mcpPort to 7747", async () => {
    const dir = await tmpDir();
    const store = new SettingsStore(dir);
    const s = await store.read();
    expect(s.favoriteAgent).toBe("claude-code");
    expect(s.mcpPort).toBe(7747);
  });

  it("persists updates", async () => {
    const dir = await tmpDir();
    const store = new SettingsStore(dir);
    await store.update({ favoriteAgent: "cursor" });
    const s = await new SettingsStore(dir).read();
    expect(s.favoriteAgent).toBe("cursor");
    expect(s.mcpPort).toBe(7747);
  });
});
```

- [ ] **Step 2: Run test (should fail)**

Run: `npm test -- tests/integration/state.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `SettingsStore`**

```typescript
// src/state/settings.ts
import path from "node:path";
import { JsonStore } from "./store.ts";
import type { SettingsFile } from "./schema.ts";

const DEFAULTS: SettingsFile = { favoriteAgent: "claude-code", mcpPort: 7747 };

export class SettingsStore {
  private store: JsonStore<SettingsFile>;
  constructor(stateDir: string) {
    this.store = new JsonStore<SettingsFile>(path.join(stateDir, "settings.json"), DEFAULTS);
  }
  read(): Promise<SettingsFile> {
    return this.store.read();
  }
  async update(patch: Partial<SettingsFile>): Promise<SettingsFile> {
    const current = await this.store.read();
    const next = { ...current, ...patch };
    await this.store.write(next);
    return next;
  }
}
```

- [ ] **Step 4: Run test (should pass)**

Run: `npm test -- tests/integration/state.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/state/settings.ts tests/integration/state.test.ts
git commit -m "feat(state): SettingsStore with defaults + update"
```

---

### Task 8: SkillsRepoStore (CRUD on skills-repos.json)

**Files:**
- Create: `src/state/skills-repos.ts`
- Create: `src/util/ids.ts`
- Modify: `tests/integration/state.test.ts`

- [ ] **Step 1: Add `ids.ts`**

```typescript
// src/util/ids.ts
import { v4 } from "uuid";
export const newId = (): string => v4();
```

- [ ] **Step 2: Write failing test**

Append to `tests/integration/state.test.ts`:

```typescript
import { SkillsRepoStore } from "../../src/state/skills-repos.ts";

describe("SkillsRepoStore", () => {
  it("adds, lists, gets, and removes a skills repo", async () => {
    const dir = await tmpDir();
    const store = new SkillsRepoStore(dir);
    expect(await store.list()).toEqual([]);

    const repo = await store.add({
      name: "test",
      gitUrl: "https://example.com/x.git",
      branch: "main",
      artifactPaths: { skills: ["ai/skills"] },
      presetId: null,
      localClonePath: "/tmp/clone",
      lastFetchedAt: null,
    });
    expect(repo.id).toMatch(/[0-9a-f-]{36}/);

    const list = await store.list();
    expect(list).toHaveLength(1);

    const got = await store.get(repo.id);
    expect(got?.name).toBe("test");

    await store.remove(repo.id);
    expect(await store.list()).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test (should fail)**

Run: `npm test -- tests/integration/state.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 4: Implement `SkillsRepoStore`**

```typescript
// src/state/skills-repos.ts
import path from "node:path";
import { JsonStore } from "./store.ts";
import type { SkillsRepo } from "./schema.ts";
import { newId } from "../util/ids.ts";

export class SkillsRepoStore {
  private store: JsonStore<SkillsRepo[]>;
  constructor(stateDir: string) {
    this.store = new JsonStore<SkillsRepo[]>(path.join(stateDir, "skills-repos.json"), []);
  }
  list(): Promise<SkillsRepo[]> {
    return this.store.read();
  }
  async get(id: string): Promise<SkillsRepo | undefined> {
    return (await this.list()).find((r) => r.id === id);
  }
  async add(input: Omit<SkillsRepo, "id">): Promise<SkillsRepo> {
    const list = await this.list();
    const repo: SkillsRepo = { id: newId(), ...input };
    list.push(repo);
    await this.store.write(list);
    return repo;
  }
  async update(id: string, patch: Partial<Omit<SkillsRepo, "id">>): Promise<SkillsRepo> {
    const list = await this.list();
    const idx = list.findIndex((r) => r.id === id);
    if (idx === -1) throw new Error(`skills repo not found: ${id}`);
    list[idx] = { ...list[idx]!, ...patch };
    await this.store.write(list);
    return list[idx]!;
  }
  async remove(id: string): Promise<void> {
    const list = await this.list();
    await this.store.write(list.filter((r) => r.id !== id));
  }
}
```

- [ ] **Step 5: Run test (should pass)**

Run: `npm test -- tests/integration/state.test.ts`
Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add src/state/skills-repos.ts src/util/ids.ts tests/integration/state.test.ts
git commit -m "feat(state): SkillsRepoStore CRUD"
```

---

### Task 9: WorkingRepoStore + InstallsStore

**Files:**
- Create: `src/state/working-repos.ts`
- Create: `src/state/installs.ts`
- Modify: `tests/integration/state.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/integration/state.test.ts`:

```typescript
import { WorkingRepoStore } from "../../src/state/working-repos.ts";
import { InstallsStore } from "../../src/state/installs.ts";

describe("WorkingRepoStore", () => {
  it("CRUDs working repos", async () => {
    const dir = await tmpDir();
    const store = new WorkingRepoStore(dir);
    const r = await store.add({ name: "alpha", path: "/x/alpha", addedAt: new Date().toISOString() });
    expect((await store.list())[0]?.id).toBe(r.id);
    await store.remove(r.id);
    expect(await store.list()).toEqual([]);
  });
});

describe("InstallsStore", () => {
  it("CRUDs installs and filters by working repo", async () => {
    const dir = await tmpDir();
    const store = new InstallsStore(dir);
    const i = await store.add({
      artifactKey: "src1:foo/bar",
      sourceRepoId: "src1",
      target: { type: "working-repo", workingRepoId: "w1" },
      agent: "claude-code",
      installedCommitSha: "abc",
      autoUpdate: false,
      installedFiles: [{ sourcePath: "foo/bar", targetPath: ".claude/skills/bar/SKILL.md" }],
      installedAt: new Date().toISOString(),
    });
    expect(i.id).toMatch(/[0-9a-f-]{36}/);
    expect((await store.listByWorkingRepo("w1")).length).toBe(1);
    expect((await store.listByWorkingRepo("w2")).length).toBe(0);
    await store.remove(i.id);
    expect(await store.list()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests (should fail)**

Run: `npm test -- tests/integration/state.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `WorkingRepoStore`**

```typescript
// src/state/working-repos.ts
import path from "node:path";
import { JsonStore } from "./store.ts";
import type { WorkingRepo } from "./schema.ts";
import { newId } from "../util/ids.ts";

export class WorkingRepoStore {
  private store: JsonStore<WorkingRepo[]>;
  constructor(stateDir: string) {
    this.store = new JsonStore<WorkingRepo[]>(path.join(stateDir, "working-repos.json"), []);
  }
  list(): Promise<WorkingRepo[]> {
    return this.store.read();
  }
  async get(id: string): Promise<WorkingRepo | undefined> {
    return (await this.list()).find((r) => r.id === id);
  }
  async add(input: Omit<WorkingRepo, "id">): Promise<WorkingRepo> {
    const list = await this.list();
    const r: WorkingRepo = { id: newId(), ...input };
    list.push(r);
    await this.store.write(list);
    return r;
  }
  async remove(id: string): Promise<void> {
    const list = await this.list();
    await this.store.write(list.filter((r) => r.id !== id));
  }
}
```

- [ ] **Step 4: Implement `InstallsStore`**

```typescript
// src/state/installs.ts
import path from "node:path";
import { JsonStore } from "./store.ts";
import type { Install } from "./schema.ts";
import { newId } from "../util/ids.ts";

export class InstallsStore {
  private store: JsonStore<Install[]>;
  constructor(stateDir: string) {
    this.store = new JsonStore<Install[]>(path.join(stateDir, "installs.json"), []);
  }
  list(): Promise<Install[]> {
    return this.store.read();
  }
  async get(id: string): Promise<Install | undefined> {
    return (await this.list()).find((i) => i.id === id);
  }
  async listByWorkingRepo(workingRepoId: string): Promise<Install[]> {
    return (await this.list()).filter(
      (i) => i.target.type === "working-repo" && i.target.workingRepoId === workingRepoId,
    );
  }
  async findExisting(artifactKey: string, target: Install["target"], agent: Install["agent"]): Promise<Install | undefined> {
    return (await this.list()).find(
      (i) =>
        i.artifactKey === artifactKey &&
        i.agent === agent &&
        JSON.stringify(i.target) === JSON.stringify(target),
    );
  }
  async add(input: Omit<Install, "id">): Promise<Install> {
    const list = await this.list();
    const i: Install = { id: newId(), ...input };
    list.push(i);
    await this.store.write(list);
    return i;
  }
  async remove(id: string): Promise<void> {
    const list = await this.list();
    await this.store.write(list.filter((i) => i.id !== id));
  }
}
```

- [ ] **Step 5: Run tests (should pass)**

Run: `npm test -- tests/integration/state.test.ts`
Expected: 7 passed total.

- [ ] **Step 6: Commit**

```bash
git add src/state/working-repos.ts src/state/installs.ts tests/integration/state.test.ts
git commit -m "feat(state): WorkingRepoStore + InstallsStore"
```

---

## Phase 3 — Git wrapper

### Task 10: Fixture-repo helper + Git client wrapper

**Files:**
- Create: `tests/helpers/build-fixture-repo.ts`
- Create: `src/git/client.ts`
- Create: `tests/integration/git.test.ts`

The fixture helper takes a manifest of commits-and-files and produces a real git repo on disk that we can clone via `file://` URLs in tests.

- [ ] **Step 1: Implement fixture helper**

```typescript
// tests/helpers/build-fixture-repo.ts
import { simpleGit } from "simple-git";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpDir } from "./tmp-dir.ts";

export interface FixtureCommit {
  message: string;
  files: Record<string, string>; // relative path → content
  deletes?: string[];
}

export interface FixtureResult {
  path: string;       // absolute path to the repo
  fileUrl: string;    // file:// URL suitable for cloning
  shas: string[];     // SHAs of each commit in order
}

export async function buildFixtureRepo(commits: FixtureCommit[]): Promise<FixtureResult> {
  const dir = await tmpDir("skillmgr-fixture-");
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig("user.email", "fixture@example.com");
  await git.addConfig("user.name", "Fixture");
  await git.checkoutLocalBranch("main");
  const shas: string[] = [];
  for (const c of commits) {
    for (const [rel, content] of Object.entries(c.files)) {
      const abs = path.join(dir, rel);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content, "utf8");
      await git.add(rel);
    }
    for (const rel of c.deletes ?? []) {
      await git.rm(rel);
    }
    const r = await git.commit(c.message, ["--allow-empty"]);
    shas.push(r.commit);
  }
  return {
    path: dir,
    fileUrl: `file://${dir.replace(/\\/g, "/")}`,
    shas,
  };
}
```

- [ ] **Step 2: Write failing test for Git client**

```typescript
// tests/integration/git.test.ts
import { describe, it, expect } from "vitest";
import { buildFixtureRepo } from "../helpers/build-fixture-repo.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";
import { GitClient } from "../../src/git/client.ts";
import path from "node:path";
import { readFile } from "node:fs/promises";

describe("GitClient", () => {
  it("clones a fixture repo by file URL to a target dir", async () => {
    const fixture = await buildFixtureRepo([
      { message: "init", files: { "README.md": "hello\n" } },
    ]);
    const dest = path.join(await tmpDir(), "clone");
    const client = new GitClient();
    await client.clone(fixture.fileUrl, dest, "main");
    const content = await readFile(path.join(dest, "README.md"), "utf8");
    expect(content).toBe("hello\n");
  });

  it("fetches updates from origin", async () => {
    const fixture = await buildFixtureRepo([
      { message: "init", files: { "a.txt": "1\n" } },
    ]);
    const dest = path.join(await tmpDir(), "clone");
    const client = new GitClient();
    await client.clone(fixture.fileUrl, dest, "main");
    const fixture2 = await buildFixtureRepo([
      { message: "init", files: { "a.txt": "1\n" } },
      { message: "second", files: { "a.txt": "2\n" } },
    ]);
    // Point origin at the new fixture (overwrites file content)
    const { simpleGit } = await import("simple-git");
    await simpleGit(dest).remote(["set-url", "origin", fixture2.fileUrl]);
    await client.fetch(dest);
    const headSha = await client.headSha(dest, "origin/main");
    expect(headSha).toBe(fixture2.shas[1]);
  });
});
```

- [ ] **Step 3: Run test (should fail — module missing)**

Run: `npm test -- tests/integration/git.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 4: Implement Git client**

```typescript
// src/git/client.ts
import { simpleGit, SimpleGit } from "simple-git";

export class GitClient {
  async clone(url: string, dest: string, branch: string): Promise<void> {
    await simpleGit().clone(url, dest, ["--branch", branch]);
  }
  async fetch(repoPath: string): Promise<void> {
    await simpleGit(repoPath).fetch();
  }
  async headSha(repoPath: string, ref = "HEAD"): Promise<string> {
    return (await simpleGit(repoPath).revparse([ref])).trim();
  }
  git(repoPath: string): SimpleGit {
    return simpleGit(repoPath);
  }
}
```

- [ ] **Step 5: Run tests (should pass)**

Run: `npm test -- tests/integration/git.test.ts`
Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add tests/helpers/build-fixture-repo.ts src/git/client.ts tests/integration/git.test.ts
git commit -m "feat(git): fixture-repo helper + Git client wrapper"
```

---

### Task 11: `git show` and commit-walk helpers

**Files:**
- Create: `src/git/show.ts`
- Create: `src/git/log.ts`
- Modify: `tests/integration/git.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/integration/git.test.ts`:

```typescript
import { readFileAtSha } from "../../src/git/show.ts";
import { lastSHATouching } from "../../src/git/log.ts";

describe("readFileAtSha", () => {
  it("reads file content as of a specific SHA", async () => {
    const fixture = await buildFixtureRepo([
      { message: "v1", files: { "a.md": "one\n" } },
      { message: "v2", files: { "a.md": "two\n" } },
    ]);
    const dest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fixture.fileUrl, dest, "main");
    expect(await readFileAtSha(dest, fixture.shas[0]!, "a.md")).toBe("one\n");
    expect(await readFileAtSha(dest, fixture.shas[1]!, "a.md")).toBe("two\n");
  });
});

describe("lastSHATouching", () => {
  it("returns the most recent SHA on a ref that touched any of the given paths", async () => {
    const fixture = await buildFixtureRepo([
      { message: "v1", files: { "a.md": "1\n", "b.md": "1\n" } },
      { message: "touch b only", files: { "b.md": "2\n" } },
      { message: "touch a", files: { "a.md": "2\n" } },
    ]);
    const dest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fixture.fileUrl, dest, "main");
    expect(await lastSHATouching(dest, "main", ["a.md"])).toBe(fixture.shas[2]);
    expect(await lastSHATouching(dest, "main", ["b.md"])).toBe(fixture.shas[1]);
    expect(await lastSHATouching(dest, "main", ["a.md", "b.md"])).toBe(fixture.shas[2]);
  });
});
```

- [ ] **Step 2: Run tests (should fail)**

Run: `npm test -- tests/integration/git.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `show.ts`**

```typescript
// src/git/show.ts
import { simpleGit } from "simple-git";

export async function readFileAtSha(repoPath: string, sha: string, filePath: string): Promise<string> {
  return await simpleGit(repoPath).raw(["show", `${sha}:${filePath}`]);
}

export async function listFilesAtSha(repoPath: string, sha: string, prefix: string): Promise<string[]> {
  const out = await simpleGit(repoPath).raw(["ls-tree", "-r", "--name-only", sha, "--", prefix]);
  return out.split(/\r?\n/).filter(Boolean);
}
```

- [ ] **Step 4: Implement `log.ts`**

```typescript
// src/git/log.ts
import { simpleGit } from "simple-git";

export async function lastSHATouching(
  repoPath: string,
  ref: string,
  paths: string[],
): Promise<string | null> {
  const args = ["log", ref, "-n", "1", "--format=%H", "--"];
  for (const p of paths) args.push(p);
  const out = (await simpleGit(repoPath).raw(args)).trim();
  return out.length ? out : null;
}
```

- [ ] **Step 5: Run tests (should pass)**

Run: `npm test -- tests/integration/git.test.ts`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add src/git/show.ts src/git/log.ts tests/integration/git.test.ts
git commit -m "feat(git): file-at-sha + last-touching-sha helpers"
```

---

## Phase 4 — Adapters

### Task 12: Adapter interfaces + registries

**Files:**
- Create: `src/adapters/types.ts`
- Create: `src/adapters/registry.ts`

Types-only + a tiny registry. No standalone tests; downstream tasks exercise them.

- [ ] **Step 1: Define interfaces**

```typescript
// src/adapters/types.ts
import type { AgentId, ArtifactTypeId } from "../state/schema.ts";

export type Scope = "working-repo" | "global";

export interface DiscoveredArtifact {
  artifactKey: string;          // "<sourceRepoId>:<relativePath>"
  sourceRepoId: string;
  type: ArtifactTypeId;
  name: string;                 // display name
  description: string | null;
  rootRelativePath: string;     // path within the source repo
  files: string[];              // paths within the source repo (relative)
  lastTouchedSha: string | null;
}

export interface AgentAdapter {
  id: AgentId;
  displayName: string;
  supports(type: ArtifactTypeId, scope: Scope): boolean;
  targetRoot(args: { scope: Scope; workingRepoPath?: string; type: ArtifactTypeId; name: string }): string;
  mapFileName(fileName: string): string;
}

export interface ArtifactTypeAdapter {
  id: ArtifactTypeId;
  displayName: string;
  /**
   * For one configured path inside a source repo (relative), produce DiscoveredArtifact entries.
   * The implementation may include filtering rules (e.g., only .mdc files).
   */
  discoverAt(args: {
    sourceRepoId: string;
    sourceRepoPath: string;
    configuredPath: string;
    ref: string;
  }): Promise<DiscoveredArtifact[]>;
}
```

- [ ] **Step 2: Implement the registries**

```typescript
// src/adapters/registry.ts
import type { AgentId, ArtifactTypeId } from "../state/schema.ts";
import type { AgentAdapter, ArtifactTypeAdapter } from "./types.ts";

export class AgentRegistry {
  private map = new Map<AgentId, AgentAdapter>();
  register(a: AgentAdapter): void {
    this.map.set(a.id, a);
  }
  get(id: AgentId): AgentAdapter {
    const a = this.map.get(id);
    if (!a) throw new Error(`unknown agent: ${id}`);
    return a;
  }
  list(): AgentAdapter[] {
    return [...this.map.values()];
  }
}

export class ArtifactTypeRegistry {
  private map = new Map<ArtifactTypeId, ArtifactTypeAdapter>();
  register(a: ArtifactTypeAdapter): void {
    this.map.set(a.id, a);
  }
  get(id: ArtifactTypeId): ArtifactTypeAdapter {
    const a = this.map.get(id);
    if (!a) throw new Error(`unknown artifact type: ${id}`);
    return a;
  }
  list(): ArtifactTypeAdapter[] {
    return [...this.map.values()];
  }
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc -p tsconfig.be.json --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/adapters/types.ts src/adapters/registry.ts
git commit -m "feat(adapters): interfaces + registry"
```

---

### Task 13: Skills artifact-type adapter

**Files:**
- Create: `src/adapters/artifact-types/skills.ts`
- Create: `tests/unit/artifact-types.skills.test.ts`

Discovery rule: each immediate subdirectory of a configured path is one skill. Name = directory basename. Files = all files under that directory (recursive). Description = first H1 of `SKILL.md` if present, else null.

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/artifact-types.skills.test.ts
import { describe, it, expect } from "vitest";
import { buildFixtureRepo } from "../helpers/build-fixture-repo.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";
import { GitClient } from "../../src/git/client.ts";
import { skillsAdapter } from "../../src/adapters/artifact-types/skills.ts";
import path from "node:path";

describe("skillsAdapter.discoverAt", () => {
  it("discovers each immediate subdir under configured path, reads SKILL.md heading", async () => {
    const fx = await buildFixtureRepo([
      {
        message: "init",
        files: {
          "ai/skills/alpha/SKILL.md": "# Alpha\nDoes alpha.\n",
          "ai/skills/alpha/notes.md": "notes\n",
          "ai/skills/beta/SKILL.md": "# Beta\n",
          "ai/skills/README.md": "ignored",
        },
      },
    ]);
    const dest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, dest, "main");
    const out = await skillsAdapter.discoverAt({
      sourceRepoId: "src1",
      sourceRepoPath: dest,
      configuredPath: "ai/skills",
      ref: "main",
    });
    const names = out.map((a) => a.name).sort();
    expect(names).toEqual(["alpha", "beta"]);
    const alpha = out.find((a) => a.name === "alpha")!;
    expect(alpha.description).toBe("Alpha");
    expect(alpha.files.sort()).toEqual(["ai/skills/alpha/SKILL.md", "ai/skills/alpha/notes.md"]);
    expect(alpha.artifactKey).toBe("src1:ai/skills/alpha");
  });

  it("returns empty when configured path does not exist", async () => {
    const fx = await buildFixtureRepo([{ message: "init", files: { "README.md": "x\n" } }]);
    const dest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, dest, "main");
    const out = await skillsAdapter.discoverAt({
      sourceRepoId: "src1",
      sourceRepoPath: dest,
      configuredPath: "ai/skills",
      ref: "main",
    });
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test (should fail)**

Run: `npm test -- tests/unit/artifact-types.skills.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement the adapter**

```typescript
// src/adapters/artifact-types/skills.ts
import { simpleGit } from "simple-git";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { ArtifactTypeAdapter, DiscoveredArtifact } from "../types.ts";
import { lastSHATouching } from "../../git/log.ts";

export const skillsAdapter: ArtifactTypeAdapter = {
  id: "skills",
  displayName: "Skills",
  async discoverAt({ sourceRepoId, sourceRepoPath, configuredPath, ref }) {
    const absRoot = path.join(sourceRepoPath, configuredPath);
    if (!existsSync(absRoot)) return [];
    const entries = await listImmediateDirs(absRoot);
    const out: DiscoveredArtifact[] = [];
    for (const name of entries) {
      const rootRelativePath = `${configuredPath}/${name}`;
      const files = await listFilesRecursive(path.join(sourceRepoPath, rootRelativePath), rootRelativePath);
      const skillMd = path.join(sourceRepoPath, rootRelativePath, "SKILL.md");
      const description = existsSync(skillMd) ? firstHeading(await readFile(skillMd, "utf8")) : null;
      const lastTouchedSha = await lastSHATouching(sourceRepoPath, ref, files);
      out.push({
        artifactKey: `${sourceRepoId}:${rootRelativePath}`,
        sourceRepoId,
        type: "skills",
        name,
        description,
        rootRelativePath,
        files,
        lastTouchedSha,
      });
    }
    return out;
  },
};

async function listImmediateDirs(dir: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const items = await readdir(dir, { withFileTypes: true });
  return items.filter((d) => d.isDirectory()).map((d) => d.name).sort();
}

async function listFilesRecursive(absDir: string, relPrefix: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const out: string[] = [];
  const items = await readdir(absDir, { withFileTypes: true });
  for (const item of items) {
    const abs = path.join(absDir, item.name);
    const rel = `${relPrefix}/${item.name}`;
    if (item.isDirectory()) out.push(...(await listFilesRecursive(abs, rel)));
    else if (item.isFile()) out.push(rel);
  }
  return out;
}

function firstHeading(md: string): string | null {
  const m = md.match(/^#\s+(.+)\s*$/m);
  return m ? m[1]!.trim() : null;
}
```

- [ ] **Step 4: Run test (should pass)**

Run: `npm test -- tests/unit/artifact-types.skills.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/artifact-types/skills.ts tests/unit/artifact-types.skills.test.ts
git commit -m "feat(adapters): skills artifact-type adapter with discovery"
```

---

### Task 14: Claude Code agent adapter

**Files:**
- Create: `src/adapters/agents/claude-code.ts`
- Create: `tests/unit/agents.claude-code.test.ts`

Target paths (per design matrix): working-repo skills → `.claude/skills/<name>/`; global skills → `<home>/.claude/skills/<name>/`. No filename mapping.

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/agents.claude-code.test.ts
import { describe, it, expect } from "vitest";
import { claudeCodeAdapter } from "../../src/adapters/agents/claude-code.ts";
import os from "node:os";
import path from "node:path";

describe("claudeCodeAdapter", () => {
  it("supports skills at working-repo and global", () => {
    expect(claudeCodeAdapter.supports("skills", "working-repo")).toBe(true);
    expect(claudeCodeAdapter.supports("skills", "global")).toBe(true);
  });

  it("targetRoot resolves working-repo skills under .claude/skills/<name>/", () => {
    const root = claudeCodeAdapter.targetRoot({
      scope: "working-repo",
      workingRepoPath: "/repos/alpha",
      type: "skills",
      name: "foo",
    });
    expect(root.replace(/\\/g, "/")).toBe("/repos/alpha/.claude/skills/foo");
  });

  it("targetRoot resolves global skills under <home>/.claude/skills/<name>/", () => {
    const root = claudeCodeAdapter.targetRoot({
      scope: "global",
      type: "skills",
      name: "foo",
    });
    expect(root).toBe(path.join(os.homedir(), ".claude", "skills", "foo"));
  });

  it("mapFileName is identity", () => {
    expect(claudeCodeAdapter.mapFileName("CLAUDE.md")).toBe("CLAUDE.md");
    expect(claudeCodeAdapter.mapFileName("anything.txt")).toBe("anything.txt");
  });
});
```

- [ ] **Step 2: Run test (should fail)**

Run: `npm test -- tests/unit/agents.claude-code.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement the adapter**

```typescript
// src/adapters/agents/claude-code.ts
import os from "node:os";
import path from "node:path";
import type { AgentAdapter, Scope } from "../types.ts";
import type { ArtifactTypeId } from "../../state/schema.ts";

const SUPPORTED: Record<ArtifactTypeId, Scope[]> = {
  skills: ["working-repo", "global"],
};

export const claudeCodeAdapter: AgentAdapter = {
  id: "claude-code",
  displayName: "Claude Code",
  supports(type, scope) {
    return SUPPORTED[type]?.includes(scope) ?? false;
  },
  targetRoot({ scope, workingRepoPath, type, name }) {
    if (type !== "skills") throw new Error(`claude-code: artifact type not supported in slice 1: ${type}`);
    if (scope === "working-repo") {
      if (!workingRepoPath) throw new Error("workingRepoPath required for working-repo scope");
      return path.join(workingRepoPath, ".claude", "skills", name);
    }
    return path.join(os.homedir(), ".claude", "skills", name);
  },
  mapFileName(name) {
    return name;
  },
};
```

- [ ] **Step 4: Run test (should pass)**

Run: `npm test -- tests/unit/agents.claude-code.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/agents/claude-code.ts tests/unit/agents.claude-code.test.ts
git commit -m "feat(adapters): Claude Code agent adapter"
```

---

### Task 15: Cursor agent adapter

**Files:**
- Create: `src/adapters/agents/cursor.ts`
- Create: `tests/unit/agents.cursor.test.ts`

Target paths: working-repo skills → `.cursor/skills/<name>/`; global skills → `<home>/.cursor/skills/<name>/`. Filename mapping: `CLAUDE.md` → `AGENTS.md`.

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/agents.cursor.test.ts
import { describe, it, expect } from "vitest";
import { cursorAdapter } from "../../src/adapters/agents/cursor.ts";
import os from "node:os";
import path from "node:path";

describe("cursorAdapter", () => {
  it("supports skills at both scopes", () => {
    expect(cursorAdapter.supports("skills", "working-repo")).toBe(true);
    expect(cursorAdapter.supports("skills", "global")).toBe(true);
  });

  it("targetRoot under .cursor/skills/<name>/", () => {
    const root = cursorAdapter.targetRoot({
      scope: "working-repo",
      workingRepoPath: "/r/a",
      type: "skills",
      name: "foo",
    });
    expect(root.replace(/\\/g, "/")).toBe("/r/a/.cursor/skills/foo");
  });

  it("global targetRoot under <home>/.cursor/skills/<name>/", () => {
    const root = cursorAdapter.targetRoot({ scope: "global", type: "skills", name: "foo" });
    expect(root).toBe(path.join(os.homedir(), ".cursor", "skills", "foo"));
  });

  it("mapFileName rewrites CLAUDE.md to AGENTS.md, otherwise identity", () => {
    expect(cursorAdapter.mapFileName("CLAUDE.md")).toBe("AGENTS.md");
    expect(cursorAdapter.mapFileName("SKILL.md")).toBe("SKILL.md");
    expect(cursorAdapter.mapFileName("examples/CLAUDE.md")).toBe("examples/AGENTS.md");
  });
});
```

- [ ] **Step 2: Run test (should fail)**

Run: `npm test -- tests/unit/agents.cursor.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement the adapter**

```typescript
// src/adapters/agents/cursor.ts
import os from "node:os";
import path from "node:path";
import type { AgentAdapter, Scope } from "../types.ts";
import type { ArtifactTypeId } from "../../state/schema.ts";

const SUPPORTED: Record<ArtifactTypeId, Scope[]> = {
  skills: ["working-repo", "global"],
};

export const cursorAdapter: AgentAdapter = {
  id: "cursor",
  displayName: "Cursor",
  supports(type, scope) {
    return SUPPORTED[type]?.includes(scope) ?? false;
  },
  targetRoot({ scope, workingRepoPath, type, name }) {
    if (type !== "skills") throw new Error(`cursor: artifact type not supported in slice 1: ${type}`);
    if (scope === "working-repo") {
      if (!workingRepoPath) throw new Error("workingRepoPath required for working-repo scope");
      return path.join(workingRepoPath, ".cursor", "skills", name);
    }
    return path.join(os.homedir(), ".cursor", "skills", name);
  },
  mapFileName(name) {
    const parts = name.split("/");
    const last = parts[parts.length - 1]!;
    if (last === "CLAUDE.md") parts[parts.length - 1] = "AGENTS.md";
    return parts.join("/");
  },
};
```

- [ ] **Step 4: Run test (should pass)**

Run: `npm test -- tests/unit/agents.cursor.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/agents/cursor.ts tests/unit/agents.cursor.test.ts
git commit -m "feat(adapters): Cursor agent adapter with CLAUDE.md→AGENTS.md mapping"
```

---

### Task 16: Wire registries with the two agents + skills type

**Files:**
- Create: `src/adapters/index.ts`

Bootstrap point that other modules import to get registries with the slice-1 adapters pre-registered.

- [ ] **Step 1: Implement bootstrap**

```typescript
// src/adapters/index.ts
import { AgentRegistry, ArtifactTypeRegistry } from "./registry.ts";
import { claudeCodeAdapter } from "./agents/claude-code.ts";
import { cursorAdapter } from "./agents/cursor.ts";
import { skillsAdapter } from "./artifact-types/skills.ts";

export function buildRegistries(): { agents: AgentRegistry; types: ArtifactTypeRegistry } {
  const agents = new AgentRegistry();
  agents.register(claudeCodeAdapter);
  agents.register(cursorAdapter);
  const types = new ArtifactTypeRegistry();
  types.register(skillsAdapter);
  return { agents, types };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc -p tsconfig.be.json --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/adapters/index.ts
git commit -m "feat(adapters): bootstrap registries with slice-1 adapters"
```

---

## Phase 5 — Discovery

### Task 17: `discoverArtifacts` orchestrator

**Files:**
- Create: `src/discovery/discover.ts`
- Create: `tests/integration/discover.test.ts`

Walks a `SkillsRepo` configuration: for each known artifact type, for each configured path, calls the adapter's `discoverAt`. Returns a flat list.

- [ ] **Step 1: Write failing test**

```typescript
// tests/integration/discover.test.ts
import { describe, it, expect } from "vitest";
import { buildFixtureRepo } from "../helpers/build-fixture-repo.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";
import { GitClient } from "../../src/git/client.ts";
import { buildRegistries } from "../../src/adapters/index.ts";
import { discoverArtifacts } from "../../src/discovery/discover.ts";
import path from "node:path";
import type { SkillsRepo } from "../../src/state/schema.ts";

describe("discoverArtifacts", () => {
  it("merges discoveries across all configured per-type paths", async () => {
    const fx = await buildFixtureRepo([
      {
        message: "init",
        files: {
          "ai/skills/alpha/SKILL.md": "# Alpha\n",
          "ai/skills/beta/SKILL.md": "# Beta\n",
          "other-skills/gamma/SKILL.md": "# Gamma\n",
        },
      },
    ]);
    const dest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, dest, "main");
    const { types } = buildRegistries();
    const repo: SkillsRepo = {
      id: "src1",
      name: "test",
      gitUrl: fx.fileUrl,
      branch: "main",
      artifactPaths: { skills: ["ai/skills", "other-skills"] },
      presetId: null,
      localClonePath: dest,
      lastFetchedAt: null,
    };
    const result = await discoverArtifacts(repo, types);
    expect(result.map((a) => a.name).sort()).toEqual(["alpha", "beta", "gamma"]);
  });

  it("ignores undeclared artifact type keys", async () => {
    const fx = await buildFixtureRepo([
      { message: "init", files: { "ai/skills/alpha/SKILL.md": "# Alpha\n" } },
    ]);
    const dest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, dest, "main");
    const { types } = buildRegistries();
    const repo: SkillsRepo = {
      id: "src1", name: "t", gitUrl: fx.fileUrl, branch: "main",
      artifactPaths: { skills: ["ai/skills"] },
      presetId: null, localClonePath: dest, lastFetchedAt: null,
    };
    const result = await discoverArtifacts(repo, types);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("skills");
  });
});
```

- [ ] **Step 2: Run test (should fail)**

Run: `npm test -- tests/integration/discover.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement orchestrator**

```typescript
// src/discovery/discover.ts
import type { SkillsRepo, ArtifactTypeId } from "../state/schema.ts";
import type { ArtifactTypeRegistry } from "../adapters/registry.ts";
import type { DiscoveredArtifact } from "../adapters/types.ts";

export async function discoverArtifacts(
  repo: SkillsRepo,
  types: ArtifactTypeRegistry,
): Promise<DiscoveredArtifact[]> {
  const out: DiscoveredArtifact[] = [];
  for (const t of types.list()) {
    const typeId = t.id as ArtifactTypeId;
    const paths = repo.artifactPaths[typeId] ?? [];
    for (const p of paths) {
      const found = await t.discoverAt({
        sourceRepoId: repo.id,
        sourceRepoPath: repo.localClonePath,
        configuredPath: p,
        ref: repo.branch,
      });
      out.push(...found);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run tests (should pass)**

Run: `npm test -- tests/integration/discover.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/discovery/discover.ts tests/integration/discover.test.ts
git commit -m "feat(discovery): orchestrator over artifact-type adapters"
```

---

## Phase 6 — Install engine

### Task 18: Exclude-block manager

**Files:**
- Create: `src/engine/exclude-block.ts`
- Create: `tests/unit/exclude-block.test.ts`

Manages a fenced block in `.git/info/exclude`. Pure I/O over a file path passed in — no git knowledge.

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/exclude-block.test.ts
import { describe, it, expect } from "vitest";
import { writeExcludeBlock, readExcludeBlock } from "../../src/engine/exclude-block.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import path from "node:path";

const BEGIN = "# BEGIN skills-manager (auto-managed, do not edit)";
const END = "# END skills-manager";

async function makeExclude(initial = "") {
  const dir = await tmpDir();
  const file = path.join(dir, ".git", "info", "exclude");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, initial, "utf8");
  return file;
}

describe("exclude-block", () => {
  it("writes a fresh block when none exists", async () => {
    const file = await makeExclude("# user content\n");
    await writeExcludeBlock(file, [".claude/skills/foo/", ".cursor/skills/bar/"]);
    const out = await readFile(file, "utf8");
    expect(out).toContain("# user content");
    expect(out).toContain(BEGIN);
    expect(out).toContain(".claude/skills/foo/");
    expect(out).toContain(".cursor/skills/bar/");
    expect(out).toContain(END);
  });

  it("replaces an existing block in place without touching surrounding content", async () => {
    const initial = `# top\n${BEGIN}\n.old/path/\n${END}\n# bottom\n`;
    const file = await makeExclude(initial);
    await writeExcludeBlock(file, [".new/path/"]);
    const out = await readFile(file, "utf8");
    expect(out.startsWith("# top\n")).toBe(true);
    expect(out.endsWith("# bottom\n")).toBe(true);
    expect(out).not.toContain(".old/path/");
    expect(out).toContain(".new/path/");
  });

  it("empty patterns removes the block entirely if present", async () => {
    const initial = `${BEGIN}\n.x/\n${END}\n`;
    const file = await makeExclude(initial);
    await writeExcludeBlock(file, []);
    const out = await readFile(file, "utf8");
    expect(out).not.toContain(BEGIN);
    expect(out).not.toContain(END);
  });

  it("readExcludeBlock returns current patterns", async () => {
    const file = await makeExclude(`${BEGIN}\n.a/\n.b/\n${END}\n`);
    expect(await readExcludeBlock(file)).toEqual([".a/", ".b/"]);
  });
});
```

- [ ] **Step 2: Run tests (should fail)**

Run: `npm test -- tests/unit/exclude-block.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement the manager**

```typescript
// src/engine/exclude-block.ts
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const BEGIN = "# BEGIN skills-manager (auto-managed, do not edit)";
const END = "# END skills-manager";

export async function writeExcludeBlock(filePath: string, patterns: string[]): Promise<void> {
  const existing = existsSync(filePath) ? await readFile(filePath, "utf8") : "";
  const stripped = stripBlock(existing);
  if (patterns.length === 0) {
    await ensureDir(filePath);
    await writeFile(filePath, stripped, "utf8");
    return;
  }
  const block = `${BEGIN}\n${patterns.join("\n")}\n${END}\n`;
  const prefix = stripped.length && !stripped.endsWith("\n") ? `${stripped}\n` : stripped;
  await ensureDir(filePath);
  await writeFile(filePath, `${prefix}${block}`, "utf8");
}

export async function readExcludeBlock(filePath: string): Promise<string[]> {
  if (!existsSync(filePath)) return [];
  const raw = await readFile(filePath, "utf8");
  const m = raw.match(new RegExp(`${escape(BEGIN)}\\n([\\s\\S]*?)\\n${escape(END)}`));
  if (!m) return [];
  return m[1]!.split(/\r?\n/).filter(Boolean);
}

function stripBlock(raw: string): string {
  const re = new RegExp(`${escape(BEGIN)}\\n[\\s\\S]*?\\n${escape(END)}\\n?`, "g");
  return raw.replace(re, "");
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function ensureDir(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
}
```

- [ ] **Step 4: Run tests (should pass)**

Run: `npm test -- tests/unit/exclude-block.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/engine/exclude-block.ts tests/unit/exclude-block.test.ts
git commit -m "feat(engine): .git/info/exclude block manager"
```

---

### Task 19: Install engine

**Files:**
- Create: `src/util/errors.ts`
- Create: `src/engine/install.ts`
- Create: `tests/integration/install.test.ts`

The install engine: read files at SHA → resolve target paths via the agent adapter → write files → recompute and write the exclude block from all current installs in the target working repo → write install record.

- [ ] **Step 1: Add `errors.ts`**

```typescript
// src/util/errors.ts
export type AppErrorCode =
  | "artifact_not_found"
  | "working_repo_not_found"
  | "skills_repo_not_found"
  | "unsupported_combination"
  | "already_installed"
  | "agent_not_specified"
  | "bad_input"
  | "io_error";

export class AppError extends Error {
  constructor(public code: AppErrorCode, message: string) {
    super(message);
    this.name = "AppError";
  }
}
```

- [ ] **Step 2: Write failing test**

```typescript
// tests/integration/install.test.ts
import { describe, it, expect } from "vitest";
import { buildFixtureRepo } from "../helpers/build-fixture-repo.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";
import { GitClient } from "../../src/git/client.ts";
import { buildRegistries } from "../../src/adapters/index.ts";
import { discoverArtifacts } from "../../src/discovery/discover.ts";
import { installArtifact } from "../../src/engine/install.ts";
import { simpleGit } from "simple-git";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { SkillsRepo, WorkingRepo } from "../../src/state/schema.ts";

async function makeWorkingRepo(): Promise<WorkingRepo> {
  const dir = await tmpDir("skillmgr-wr-");
  await simpleGit(dir).init();
  await simpleGit(dir).addConfig("user.email", "a@b").addConfig("user.name", "t");
  await simpleGit(dir).commit("seed", [], { "--allow-empty": null });
  return { id: "w1", name: "alpha", path: dir, addedAt: new Date().toISOString() };
}

describe("installArtifact (working-repo, Claude Code)", () => {
  it("writes files to .claude/skills/<name>/ and updates .git/info/exclude", async () => {
    const fx = await buildFixtureRepo([
      {
        message: "init",
        files: {
          "ai/skills/foo/SKILL.md": "# Foo\nbody\n",
          "ai/skills/foo/extra.md": "extra\n",
        },
      },
    ]);
    const cloneDest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, cloneDest, "main");
    const { agents, types } = buildRegistries();
    const skillsRepo: SkillsRepo = {
      id: "src1", name: "src", gitUrl: fx.fileUrl, branch: "main",
      artifactPaths: { skills: ["ai/skills"] },
      presetId: null, localClonePath: cloneDest, lastFetchedAt: null,
    };
    const artifacts = await discoverArtifacts(skillsRepo, types);
    const foo = artifacts.find((a) => a.name === "foo")!;
    const workingRepo = await makeWorkingRepo();

    const result = await installArtifact({
      artifact: foo,
      skillsRepo,
      target: { type: "working-repo", workingRepoId: workingRepo.id },
      workingRepo,
      agent: agents.get("claude-code"),
      sha: fx.shas[0]!,
      autoUpdate: false,
      existingInstallsInTarget: [],
    });

    expect(existsSync(path.join(workingRepo.path, ".claude/skills/foo/SKILL.md"))).toBe(true);
    expect(existsSync(path.join(workingRepo.path, ".claude/skills/foo/extra.md"))).toBe(true);
    expect(await readFile(path.join(workingRepo.path, ".claude/skills/foo/SKILL.md"), "utf8"))
      .toBe("# Foo\nbody\n");
    const excl = await readFile(path.join(workingRepo.path, ".git/info/exclude"), "utf8");
    expect(excl).toContain(".claude/skills/foo/");
    expect(result.installedFiles.length).toBe(2);
    expect(result.installedCommitSha).toBe(fx.shas[0]);
  });

  it("Cursor target applies CLAUDE.md→AGENTS.md", async () => {
    const fx = await buildFixtureRepo([
      { message: "init", files: { "ai/skills/foo/CLAUDE.md": "x\n", "ai/skills/foo/SKILL.md": "# F\n" } },
    ]);
    const cloneDest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, cloneDest, "main");
    const { agents, types } = buildRegistries();
    const skillsRepo: SkillsRepo = {
      id: "src1", name: "s", gitUrl: fx.fileUrl, branch: "main",
      artifactPaths: { skills: ["ai/skills"] },
      presetId: null, localClonePath: cloneDest, lastFetchedAt: null,
    };
    const foo = (await discoverArtifacts(skillsRepo, types)).find((a) => a.name === "foo")!;
    const wr = await makeWorkingRepo();
    await installArtifact({
      artifact: foo, skillsRepo,
      target: { type: "working-repo", workingRepoId: wr.id }, workingRepo: wr,
      agent: agents.get("cursor"), sha: fx.shas[0]!, autoUpdate: false,
      existingInstallsInTarget: [],
    });
    expect(existsSync(path.join(wr.path, ".cursor/skills/foo/AGENTS.md"))).toBe(true);
    expect(existsSync(path.join(wr.path, ".cursor/skills/foo/CLAUDE.md"))).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests (should fail)**

Run: `npm test -- tests/integration/install.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 4: Implement install engine**

```typescript
// src/engine/install.ts
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { readFileAtSha } from "../git/show.ts";
import { writeExcludeBlock } from "./exclude-block.ts";
import { AppError } from "../util/errors.ts";
import type { DiscoveredArtifact, AgentAdapter } from "../adapters/types.ts";
import type { Install, InstalledFile, InstallTarget, SkillsRepo, WorkingRepo } from "../state/schema.ts";

export interface InstallArgs {
  artifact: DiscoveredArtifact;
  skillsRepo: SkillsRepo;
  target: InstallTarget;
  workingRepo?: WorkingRepo; // required if target.type === "working-repo"
  agent: AgentAdapter;
  sha: string;
  autoUpdate: boolean;
  /** All installs already in the same working repo (for exclude-block recompute). Empty for global. Only `installedFiles` is read. */
  existingInstallsInTarget: Array<Pick<Install, "installedFiles">>;
}

/** Returns a draft install record (without `id`). The caller persists it via `InstallsStore.add`, which assigns the id. */
export async function installArtifact(args: InstallArgs): Promise<Omit<Install, "id">> {
  const { artifact, skillsRepo, target, workingRepo, agent, sha, autoUpdate, existingInstallsInTarget } = args;
  if (!agent.supports(artifact.type, target.type)) {
    throw new AppError("unsupported_combination", `${agent.id} does not support ${artifact.type} at ${target.type}`);
  }
  if (target.type === "working-repo" && !workingRepo) {
    throw new AppError("bad_input", "workingRepo required for working-repo target");
  }
  const targetRoot = agent.targetRoot({
    scope: target.type,
    workingRepoPath: workingRepo?.path,
    type: artifact.type,
    name: artifact.name,
  });
  const installedFiles: InstalledFile[] = [];
  const writtenAbsPaths: string[] = [];
  try {
    for (const sourcePath of artifact.files) {
      const relativeToArtifact = sourcePath.slice(artifact.rootRelativePath.length + 1);
      const mapped = agent.mapFileName(relativeToArtifact);
      const targetAbs = path.join(targetRoot, mapped);
      const targetRel = workingRepo
        ? path.relative(workingRepo.path, targetAbs).replace(/\\/g, "/")
        : targetAbs;
      const content = await readFileAtSha(skillsRepo.localClonePath, sha, sourcePath);
      await mkdir(path.dirname(targetAbs), { recursive: true });
      await writeFile(targetAbs, content, "utf8");
      writtenAbsPaths.push(targetAbs);
      installedFiles.push({ sourcePath, targetPath: targetRel });
    }
    if (target.type === "working-repo" && workingRepo) {
      const patterns = computeExcludePatterns(
        [...existingInstallsInTarget, { installedFiles }],
      );
      const excludePath = path.join(workingRepo.path, ".git", "info", "exclude");
      await writeExcludeBlock(excludePath, patterns);
    }
  } catch (err) {
    // rollback: delete any files we wrote
    for (const p of writtenAbsPaths) {
      await rm(p, { force: true });
    }
    throw new AppError("io_error", `install failed: ${(err as Error).message}`);
  }
  const record: Omit<Install, "id"> = {
    artifactKey: artifact.artifactKey,
    sourceRepoId: skillsRepo.id,
    target,
    agent: agent.id,
    installedCommitSha: sha,
    autoUpdate,
    installedFiles,
    installedAt: new Date().toISOString(),
  };
  return record;
}

export function computeExcludePatterns(installs: Array<Pick<Install, "installedFiles">>): string[] {
  const set = new Set<string>();
  for (const inst of installs) {
    for (const f of inst.installedFiles) set.add(f.targetPath);
  }
  return [...set].sort();
}
```

- [ ] **Step 5: Run tests (should pass)**

Run: `npm test -- tests/integration/install.test.ts`
Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add src/util/errors.ts src/engine/install.ts tests/integration/install.test.ts
git commit -m "feat(engine): install with target-path resolution + exclude block + rollback"
```

---

### Task 20: Uninstall engine

**Files:**
- Create: `src/engine/uninstall.ts`
- Create: `tests/integration/uninstall.test.ts`

Uninstall deletes the files listed in the install record from the working repo and recomputes the exclude block from the *remaining* installs in that working repo.

- [ ] **Step 1: Write failing test**

```typescript
// tests/integration/uninstall.test.ts
import { describe, it, expect } from "vitest";
import { buildFixtureRepo } from "../helpers/build-fixture-repo.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";
import { GitClient } from "../../src/git/client.ts";
import { buildRegistries } from "../../src/adapters/index.ts";
import { discoverArtifacts } from "../../src/discovery/discover.ts";
import { installArtifact } from "../../src/engine/install.ts";
import { uninstallArtifact } from "../../src/engine/uninstall.ts";
import { simpleGit } from "simple-git";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { SkillsRepo, WorkingRepo } from "../../src/state/schema.ts";

async function makeWorkingRepo(): Promise<WorkingRepo> {
  const dir = await tmpDir("skillmgr-wr-");
  const g = simpleGit(dir);
  await g.init();
  await g.addConfig("user.email", "a@b").addConfig("user.name", "t");
  await g.commit("seed", [], { "--allow-empty": null });
  return { id: "w1", name: "alpha", path: dir, addedAt: new Date().toISOString() };
}

describe("uninstallArtifact", () => {
  it("removes files and updates the exclude block (leaving block for remaining installs)", async () => {
    const fx = await buildFixtureRepo([
      {
        message: "init",
        files: {
          "ai/skills/foo/SKILL.md": "# F\n",
          "ai/skills/bar/SKILL.md": "# B\n",
        },
      },
    ]);
    const dest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, dest, "main");
    const { agents, types } = buildRegistries();
    const skillsRepo: SkillsRepo = {
      id: "src1", name: "s", gitUrl: fx.fileUrl, branch: "main",
      artifactPaths: { skills: ["ai/skills"] },
      presetId: null, localClonePath: dest, lastFetchedAt: null,
    };
    const arts = await discoverArtifacts(skillsRepo, types);
    const foo = arts.find((a) => a.name === "foo")!;
    const bar = arts.find((a) => a.name === "bar")!;
    const wr = await makeWorkingRepo();

    const recFoo = await installArtifact({
      artifact: foo, skillsRepo, target: { type: "working-repo", workingRepoId: wr.id },
      workingRepo: wr, agent: agents.get("claude-code"), sha: fx.shas[0]!, autoUpdate: false,
      existingInstallsInTarget: [],
    });
    const recBar = await installArtifact({
      artifact: bar, skillsRepo, target: { type: "working-repo", workingRepoId: wr.id },
      workingRepo: wr, agent: agents.get("claude-code"), sha: fx.shas[0]!, autoUpdate: false,
      existingInstallsInTarget: [recFoo],
    });

    await uninstallArtifact({
      install: recFoo,
      workingRepo: wr,
      remainingInstallsInTarget: [recBar],
    });

    expect(existsSync(path.join(wr.path, ".claude/skills/foo/SKILL.md"))).toBe(false);
    expect(existsSync(path.join(wr.path, ".claude/skills/bar/SKILL.md"))).toBe(true);
    const excl = await readFile(path.join(wr.path, ".git/info/exclude"), "utf8");
    expect(excl).not.toContain(".claude/skills/foo/");
    expect(excl).toContain(".claude/skills/bar/");
  });
});
```

- [ ] **Step 2: Run test (should fail)**

Run: `npm test -- tests/integration/uninstall.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `uninstall.ts`**

```typescript
// src/engine/uninstall.ts
import { rm } from "node:fs/promises";
import path from "node:path";
import { writeExcludeBlock } from "./exclude-block.ts";
import { computeExcludePatterns } from "./install.ts";
import type { Install, WorkingRepo } from "../state/schema.ts";

export interface UninstallArgs {
  /** Only needs installedFiles + target; accepts both persisted Install records and engine drafts (Omit<Install,"id">). */
  install: Pick<Install, "installedFiles" | "target">;
  workingRepo?: WorkingRepo; // required if install.target.type === "working-repo"
  remainingInstallsInTarget: Array<Pick<Install, "installedFiles">>;
}

export async function uninstallArtifact(args: UninstallArgs): Promise<void> {
  const { install, workingRepo, remainingInstallsInTarget } = args;
  for (const f of install.installedFiles) {
    const abs = workingRepo ? path.join(workingRepo.path, f.targetPath) : f.targetPath;
    await rm(abs, { force: true, recursive: true });
  }
  // Best-effort: clean up the now-empty <name>/ directory (and its parent if empty).
  if (workingRepo) {
    const dirs = new Set(install.installedFiles.map((f) => path.dirname(path.join(workingRepo.path, f.targetPath))));
    for (const d of dirs) {
      await rm(d, { force: true, recursive: false }).catch(() => {});
    }
    const excludePath = path.join(workingRepo.path, ".git", "info", "exclude");
    await writeExcludeBlock(excludePath, computeExcludePatterns(remainingInstallsInTarget));
  }
}
```

- [ ] **Step 4: Run test (should pass)**

Run: `npm test -- tests/integration/uninstall.test.ts`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add src/engine/uninstall.ts tests/integration/uninstall.test.ts
git commit -m "feat(engine): uninstall + exclude block reconciliation"
```

---

### Task 21: Re-install / collision coherence test

**Files:**
- Modify: `tests/integration/install.test.ts`

Validates the exclude-block stays correct across install→install→uninstall→install sequences.

- [ ] **Step 1: Append failing test**

```typescript
import { uninstallArtifact } from "../../src/engine/uninstall.ts";

describe("exclude-block coherence across install/uninstall cycles", () => {
  it("install A + install B + uninstall A + install C → block contains only B and C", async () => {
    const fx = await buildFixtureRepo([
      { message: "init", files: {
        "ai/skills/a/SKILL.md": "# A\n",
        "ai/skills/b/SKILL.md": "# B\n",
        "ai/skills/c/SKILL.md": "# C\n",
      } },
    ]);
    const dest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, dest, "main");
    const { agents, types } = buildRegistries();
    const skillsRepo: SkillsRepo = {
      id: "src1", name: "s", gitUrl: fx.fileUrl, branch: "main",
      artifactPaths: { skills: ["ai/skills"] },
      presetId: null, localClonePath: dest, lastFetchedAt: null,
    };
    const arts = await discoverArtifacts(skillsRepo, types);
    const a = arts.find(x => x.name === "a")!;
    const b = arts.find(x => x.name === "b")!;
    const c = arts.find(x => x.name === "c")!;
    const wr = await makeWorkingRepo();
    const cc = agents.get("claude-code");

    const rA = await installArtifact({ artifact: a, skillsRepo, target: { type: "working-repo", workingRepoId: wr.id }, workingRepo: wr, agent: cc, sha: fx.shas[0]!, autoUpdate: false, existingInstallsInTarget: [] });
    const rB = await installArtifact({ artifact: b, skillsRepo, target: { type: "working-repo", workingRepoId: wr.id }, workingRepo: wr, agent: cc, sha: fx.shas[0]!, autoUpdate: false, existingInstallsInTarget: [rA] });
    await uninstallArtifact({ install: rA, workingRepo: wr, remainingInstallsInTarget: [rB] });
    const rC = await installArtifact({ artifact: c, skillsRepo, target: { type: "working-repo", workingRepoId: wr.id }, workingRepo: wr, agent: cc, sha: fx.shas[0]!, autoUpdate: false, existingInstallsInTarget: [rB] });

    const excl = await readFile(path.join(wr.path, ".git/info/exclude"), "utf8");
    expect(excl).not.toContain(".claude/skills/a/");
    expect(excl).toContain(".claude/skills/b/");
    expect(excl).toContain(".claude/skills/c/");
  });
});
```

- [ ] **Step 2: Run test (should pass — uses already-implemented engines)**

Run: `npm test -- tests/integration/install.test.ts`
Expected: 3 passed (2 prior + new coherence).

- [ ] **Step 3: Commit**

```bash
git add tests/integration/install.test.ts
git commit -m "test(engine): exclude-block coherence across install/uninstall cycles"
```

---

## Phase 7 — HTTP API

### Task 22: Fastify server skeleton + Settings endpoints

**Files:**
- Create: `src/ports.ts`
- Create: `src/server.ts`
- Create: `src/api/settings.ts`
- Create: `tests/integration/api.test.ts`

`buildServer(deps)` returns a configured Fastify instance. We test by `inject()`-ing requests — no real network listen during tests.

- [ ] **Step 1: Implement `ports.ts`**

```typescript
// src/ports.ts
import { createServer } from "node:net";

export async function pickFreePort(start: number): Promise<number> {
  for (let p = start; p < start + 100; p++) {
    if (await isFree(p)) return p;
  }
  throw new Error("no free port found");
}

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => {
      s.close(() => resolve(true));
    });
  });
}
```

- [ ] **Step 2: Write failing test**

```typescript
// tests/integration/api.test.ts
import { describe, it, expect } from "vitest";
import { buildServer } from "../../src/server.ts";
import { SettingsStore } from "../../src/state/settings.ts";
import { SkillsRepoStore } from "../../src/state/skills-repos.ts";
import { WorkingRepoStore } from "../../src/state/working-repos.ts";
import { InstallsStore } from "../../src/state/installs.ts";
import { buildRegistries } from "../../src/adapters/index.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";

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
```

- [ ] **Step 3: Run test (should fail)**

Run: `npm test -- tests/integration/api.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 4: Implement `server.ts`**

```typescript
// src/server.ts
import Fastify, { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { registerRoutes } from "./api/routes.ts";
import type { SettingsStore } from "./state/settings.ts";
import type { SkillsRepoStore } from "./state/skills-repos.ts";
import type { WorkingRepoStore } from "./state/working-repos.ts";
import type { InstallsStore } from "./state/installs.ts";
import type { buildRegistries } from "./adapters/index.ts";

export interface ServerDeps {
  stateDir: string;
  cacheDir: string;
  settings: SettingsStore;
  skillsRepos: SkillsRepoStore;
  workingRepos: WorkingRepoStore;
  installs: InstallsStore;
  registries: ReturnType<typeof buildRegistries>;
}

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerRoutes(app, deps);
  const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web");
  if (existsSync(webRoot)) {
    await app.register(fastifyStatic, { root: webRoot, prefix: "/", decorateReply: false });
  }
  return app;
}
```

- [ ] **Step 5: Implement `api/routes.ts` and `api/settings.ts`**

```typescript
// src/api/routes.ts
import type { FastifyInstance } from "fastify";
import type { ServerDeps } from "../server.ts";
import { registerSettingsRoutes } from "./settings.ts";

export async function registerRoutes(app: FastifyInstance, deps: ServerDeps): Promise<void> {
  await registerSettingsRoutes(app, deps);
}
```

```typescript
// src/api/settings.ts
import type { FastifyInstance } from "fastify";
import type { ServerDeps } from "../server.ts";

export async function registerSettingsRoutes(app: FastifyInstance, { settings }: ServerDeps): Promise<void> {
  app.get("/api/settings", async () => settings.read());
  app.patch<{ Body: { favoriteAgent?: "claude-code" | "cursor"; mcpPort?: number } }>(
    "/api/settings",
    async (req) => settings.update(req.body ?? {}),
  );
}
```

- [ ] **Step 6: Run tests (should pass)**

Run: `npm test -- tests/integration/api.test.ts`
Expected: 2 passed.

- [ ] **Step 7: Commit**

```bash
git add src/ports.ts src/server.ts src/api/routes.ts src/api/settings.ts tests/integration/api.test.ts
git commit -m "feat(api): Fastify server skeleton + settings endpoints"
```

---

### Task 23: Skills-repos endpoints

**Files:**
- Create: `src/api/skills-repos.ts`
- Create: `src/git/clone.ts`
- Modify: `src/api/routes.ts`
- Modify: `tests/integration/api.test.ts`

Endpoints:
- `POST /api/skills-repos` — registers a new source: clones into cache, persists.
- `GET /api/skills-repos` — list.
- `GET /api/skills-repos/:id` — detail.
- `DELETE /api/skills-repos/:id` — removes record + local clone.
- `POST /api/skills-repos/:id/refresh` — fetches latest.

- [ ] **Step 1: Implement `git/clone.ts`**

```typescript
// src/git/clone.ts
import path from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { GitClient } from "./client.ts";

export async function cloneIntoCache(args: {
  gitUrl: string;
  branch: string;
  cacheDir: string;
  repoId: string;
}): Promise<string> {
  const dest = path.join(args.cacheDir, args.repoId);
  await mkdir(args.cacheDir, { recursive: true });
  await new GitClient().clone(args.gitUrl, dest, args.branch);
  return dest;
}

export async function removeClone(localClonePath: string): Promise<void> {
  await rm(localClonePath, { recursive: true, force: true });
}
```

- [ ] **Step 2: Write failing test**

Append to `tests/integration/api.test.ts`:

```typescript
import { buildFixtureRepo } from "../helpers/build-fixture-repo.ts";

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
```

- [ ] **Step 3: Run test (should fail — route missing)**

Run: `npm test -- tests/integration/api.test.ts`
Expected: FAIL with 404 or "Cannot find module".

- [ ] **Step 4: Implement `api/skills-repos.ts`**

```typescript
// src/api/skills-repos.ts
import type { FastifyInstance } from "fastify";
import type { ServerDeps } from "../server.ts";
import { cloneIntoCache, removeClone } from "../git/clone.ts";
import { newId } from "../util/ids.ts";
import { AppError } from "../util/errors.ts";

interface RegisterBody {
  name: string;
  gitUrl: string;
  branch?: string;
  artifactPaths?: Partial<Record<"skills", string[]>>;
  presetId?: string | null;
}

export async function registerSkillsReposRoutes(app: FastifyInstance, deps: ServerDeps): Promise<void> {
  app.get("/api/skills-repos", async () => deps.skillsRepos.list());

  app.get<{ Params: { id: string } }>("/api/skills-repos/:id", async (req, reply) => {
    const r = await deps.skillsRepos.get(req.params.id);
    if (!r) return reply.code(404).send({ code: "skills_repo_not_found" });
    return r;
  });

  app.post<{ Body: RegisterBody }>("/api/skills-repos", async (req, reply) => {
    const { name, gitUrl, branch = "main", artifactPaths = {}, presetId = null } = req.body ?? ({} as RegisterBody);
    if (!name || !gitUrl) throw new AppError("bad_input", "name and gitUrl required");
    const id = newId();
    const localClonePath = await cloneIntoCache({ gitUrl, branch, cacheDir: deps.cacheDir, repoId: id });
    const created = await deps.skillsRepos.add({
      name, gitUrl, branch, artifactPaths, presetId, localClonePath,
      lastFetchedAt: new Date().toISOString(),
    });
    // Replace the auto-assigned id with our pre-generated one (so localClonePath matches id).
    // Since the store assigns its own id, re-add and remove the duplicate. Simpler: extend store
    // to accept id — but for slice 1 we accept the store-assigned id and re-name clone if needed.
    if (created.id !== id) {
      const { rename } = await import("node:fs/promises");
      const path = await import("node:path");
      const newPath = path.join(deps.cacheDir, created.id);
      await rename(localClonePath, newPath);
      await deps.skillsRepos.update(created.id, { localClonePath: newPath });
      created.localClonePath = newPath;
    }
    return reply.code(201).send(created);
  });

  app.delete<{ Params: { id: string } }>("/api/skills-repos/:id", async (req, reply) => {
    const r = await deps.skillsRepos.get(req.params.id);
    if (!r) return reply.code(404).send({ code: "skills_repo_not_found" });
    await removeClone(r.localClonePath);
    await deps.skillsRepos.remove(req.params.id);
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>("/api/skills-repos/:id/refresh", async (req, reply) => {
    const r = await deps.skillsRepos.get(req.params.id);
    if (!r) return reply.code(404).send({ code: "skills_repo_not_found" });
    const { GitClient } = await import("../git/client.ts");
    await new GitClient().fetch(r.localClonePath);
    return deps.skillsRepos.update(r.id, { lastFetchedAt: new Date().toISOString() });
  });
}
```

- [ ] **Step 5: Wire into routes.ts**

Update `src/api/routes.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import type { ServerDeps } from "../server.ts";
import { registerSettingsRoutes } from "./settings.ts";
import { registerSkillsReposRoutes } from "./skills-repos.ts";
import { AppError } from "../util/errors.ts";

export async function registerRoutes(app: FastifyInstance, deps: ServerDeps): Promise<void> {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) {
      const status = err.code === "bad_input" ? 400 : err.code === "unsupported_combination" ? 409 : 500;
      return reply.code(status).send({ code: err.code, message: err.message });
    }
    return reply.code(500).send({ code: "internal", message: err.message });
  });
  await registerSettingsRoutes(app, deps);
  await registerSkillsReposRoutes(app, deps);
}
```

- [ ] **Step 6: Run tests (should pass)**

Run: `npm test -- tests/integration/api.test.ts`
Expected: 3 passed.

- [ ] **Step 7: Commit**

```bash
git add src/api/skills-repos.ts src/git/clone.ts src/api/routes.ts tests/integration/api.test.ts
git commit -m "feat(api): skills-repos register/list/get/delete/refresh"
```

---

### Task 24: Working-repos endpoints

**Files:**
- Create: `src/api/working-repos.ts`
- Modify: `src/api/routes.ts`
- Modify: `tests/integration/api.test.ts`

Endpoints:
- `GET /api/working-repos`
- `POST /api/working-repos` — validates the path is a git repo.
- `DELETE /api/working-repos/:id`

- [ ] **Step 1: Write failing test**

Append to `tests/integration/api.test.ts`:

```typescript
import { simpleGit } from "simple-git";

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
```

- [ ] **Step 2: Run test (should fail)**

Run: `npm test -- tests/integration/api.test.ts`
Expected: FAIL with 404 or undefined route.

- [ ] **Step 3: Implement working-repos endpoints**

```typescript
// src/api/working-repos.ts
import type { FastifyInstance } from "fastify";
import type { ServerDeps } from "../server.ts";
import { existsSync } from "node:fs";
import path from "node:path";
import { AppError } from "../util/errors.ts";

export async function registerWorkingReposRoutes(app: FastifyInstance, deps: ServerDeps): Promise<void> {
  app.get("/api/working-repos", async () => deps.workingRepos.list());

  app.post<{ Body: { name: string; path: string } }>("/api/working-repos", async (req, reply) => {
    const body = req.body ?? ({} as { name: string; path: string });
    if (!body.name || !body.path) throw new AppError("bad_input", "name and path required");
    const absPath = path.resolve(body.path);
    if (!existsSync(path.join(absPath, ".git"))) {
      throw new AppError("bad_input", `not a git repository: ${absPath}`);
    }
    const r = await deps.workingRepos.add({ name: body.name, path: absPath, addedAt: new Date().toISOString() });
    return reply.code(201).send(r);
  });

  app.delete<{ Params: { id: string } }>("/api/working-repos/:id", async (req, reply) => {
    const r = await deps.workingRepos.get(req.params.id);
    if (!r) return reply.code(404).send({ code: "working_repo_not_found" });
    await deps.workingRepos.remove(req.params.id);
    return reply.code(204).send();
  });
}
```

- [ ] **Step 4: Wire into routes.ts**

In `src/api/routes.ts`, add the import and call:

```typescript
import { registerWorkingReposRoutes } from "./working-repos.ts";
// ...
await registerWorkingReposRoutes(app, deps);
```

- [ ] **Step 5: Run tests (should pass)**

Run: `npm test -- tests/integration/api.test.ts`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add src/api/working-repos.ts src/api/routes.ts tests/integration/api.test.ts
git commit -m "feat(api): working-repos register/list/delete"
```

---

### Task 25: Artifacts endpoints (list across all sources)

**Files:**
- Create: `src/api/artifacts.ts`
- Modify: `src/api/routes.ts`
- Modify: `tests/integration/api.test.ts`

Endpoints:
- `GET /api/artifacts` — list all discovered artifacts across all registered sources. Optional query: `q` (search), `type`, `sourceRepoId`.
- `GET /api/artifacts/:artifactKey` — get artifact detail (metadata + files list).
- `GET /api/artifacts/:artifactKey/files/:filePath` — get file content (latest only in slice 1).

- [ ] **Step 1: Write failing test**

Append to `tests/integration/api.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test (should fail)**

Run: `npm test -- tests/integration/api.test.ts`
Expected: FAIL with 404.

- [ ] **Step 3: Implement artifacts endpoints**

```typescript
// src/api/artifacts.ts
import type { FastifyInstance } from "fastify";
import type { ServerDeps } from "../server.ts";
import { discoverArtifacts } from "../discovery/discover.ts";
import { readFileAtSha } from "../git/show.ts";
import { AppError } from "../util/errors.ts";
import type { DiscoveredArtifact } from "../adapters/types.ts";

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

  app.get<{ Params: { artifactKey: string; "*": string } }>(
    "/api/artifacts/:artifactKey/files/*",
    async (req, reply) => {
      const key = decodeURIComponent(req.params.artifactKey);
      const filePath = (req.params as any)["*"] as string;
      const artifact = (await discoverAll(deps)).find((a) => a.artifactKey === key);
      if (!artifact) return reply.code(404).send({ code: "artifact_not_found" });
      if (!artifact.files.includes(filePath)) {
        throw new AppError("bad_input", `file not in artifact: ${filePath}`);
      }
      const repo = await deps.skillsRepos.get(artifact.sourceRepoId);
      if (!repo) return reply.code(404).send({ code: "skills_repo_not_found" });
      const content = await readFileAtSha(repo.localClonePath, artifact.lastTouchedSha ?? repo.branch, filePath);
      reply.header("content-type", "text/plain; charset=utf-8");
      return content;
    },
  );
}

async function discoverAll(deps: ServerDeps): Promise<DiscoveredArtifact[]> {
  const sources = await deps.skillsRepos.list();
  const out: DiscoveredArtifact[] = [];
  for (const s of sources) out.push(...(await discoverArtifacts(s, deps.registries.types)));
  return out;
}
```

- [ ] **Step 4: Wire into routes.ts**

Add `import { registerArtifactsRoutes } from "./artifacts.ts";` and `await registerArtifactsRoutes(app, deps);`.

- [ ] **Step 5: Run tests (should pass)**

Run: `npm test -- tests/integration/api.test.ts`
Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add src/api/artifacts.ts src/api/routes.ts tests/integration/api.test.ts
git commit -m "feat(api): artifacts list/detail/file endpoints"
```

---

### Task 26: Installs endpoints (create + list-by-target + delete)

**Files:**
- Create: `src/api/installs.ts`
- Modify: `src/api/routes.ts`
- Modify: `tests/integration/api.test.ts`

Endpoints:
- `POST /api/installs` — create.
- `GET /api/working-repos/:id/installs` — list installs in a working repo.
- `DELETE /api/installs/:id` — uninstall.

- [ ] **Step 1: Write failing test**

Append to `tests/integration/api.test.ts`:

```typescript
describe("API /installs", () => {
  it("creates an install and lists it under the working repo", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const fx = await buildFixtureRepo([
      { message: "init", files: { "ai/skills/foo/SKILL.md": "# Foo\n" } },
    ]);
    const src = (await app.inject({
      method: "POST", url: "/api/skills-repos",
      payload: { name: "src", gitUrl: fx.fileUrl, branch: "main", artifactPaths: { skills: ["ai/skills"] } },
    })).json();
    const wrPath = await tmpDir("skillmgr-wr-");
    await simpleGit(wrPath).init();
    const wr = (await app.inject({
      method: "POST", url: "/api/working-repos",
      payload: { name: "w", path: wrPath },
    })).json();

    const arts = (await app.inject({ method: "GET", url: "/api/artifacts" })).json();
    const foo = arts.find((a: { name: string }) => a.name === "foo");

    const created = await app.inject({
      method: "POST", url: "/api/installs",
      payload: { artifactKey: foo.artifactKey, target: { type: "working-repo", workingRepoId: wr.id }, agent: "claude-code", autoUpdate: false },
    });
    expect(created.statusCode).toBe(201);

    const list = await app.inject({ method: "GET", url: `/api/working-repos/${wr.id}/installs` });
    expect(list.json()).toHaveLength(1);

    const dup = await app.inject({
      method: "POST", url: "/api/installs",
      payload: { artifactKey: foo.artifactKey, target: { type: "working-repo", workingRepoId: wr.id }, agent: "claude-code", autoUpdate: false },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe("already_installed");

    const del = await app.inject({ method: "DELETE", url: `/api/installs/${created.json().id}` });
    expect(del.statusCode).toBe(204);
    const list2 = await app.inject({ method: "GET", url: `/api/working-repos/${wr.id}/installs` });
    expect(list2.json()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test (should fail)**

Run: `npm test -- tests/integration/api.test.ts`
Expected: FAIL with 404.

- [ ] **Step 3: Implement installs endpoints**

```typescript
// src/api/installs.ts
import type { FastifyInstance } from "fastify";
import type { ServerDeps } from "../server.ts";
import { installArtifact } from "../engine/install.ts";
import { uninstallArtifact } from "../engine/uninstall.ts";
import { discoverArtifacts } from "../discovery/discover.ts";
import { AppError } from "../util/errors.ts";
import type { AgentId, InstallTarget } from "../state/schema.ts";

interface CreateBody {
  artifactKey: string;
  target: InstallTarget;
  agent?: AgentId;
  sha?: string;
  autoUpdate?: boolean;
}

export async function registerInstallsRoutes(app: FastifyInstance, deps: ServerDeps): Promise<void> {
  app.get<{ Params: { id: string } }>("/api/working-repos/:id/installs", async (req, reply) => {
    const wr = await deps.workingRepos.get(req.params.id);
    if (!wr) return reply.code(404).send({ code: "working_repo_not_found" });
    return deps.installs.listByWorkingRepo(wr.id);
  });

  app.post<{ Body: CreateBody }>("/api/installs", async (req, reply) => {
    const body = req.body ?? ({} as CreateBody);
    if (!body.artifactKey || !body.target) throw new AppError("bad_input", "artifactKey and target required");
    const settings = await deps.settings.read();
    const agentId = body.agent ?? settings.favoriteAgent;
    const agent = deps.registries.agents.get(agentId);

    const sources = await deps.skillsRepos.list();
    const [sourceRepoId] = body.artifactKey.split(":", 1);
    const skillsRepo = sources.find((s) => s.id === sourceRepoId);
    if (!skillsRepo) throw new AppError("skills_repo_not_found", `unknown source: ${sourceRepoId}`);

    const allArtifacts = await discoverArtifacts(skillsRepo, deps.registries.types);
    const artifact = allArtifacts.find((a) => a.artifactKey === body.artifactKey);
    if (!artifact) throw new AppError("artifact_not_found", body.artifactKey);

    let workingRepo;
    let existing;
    if (body.target.type === "working-repo") {
      workingRepo = await deps.workingRepos.get(body.target.workingRepoId);
      if (!workingRepo) throw new AppError("working_repo_not_found", body.target.workingRepoId);
      existing = await deps.installs.findExisting(body.artifactKey, body.target, agentId);
      if (existing) throw new AppError("already_installed", `${body.artifactKey} already installed in ${workingRepo.name}`);
    } else {
      existing = await deps.installs.findExisting(body.artifactKey, body.target, agentId);
      if (existing) throw new AppError("already_installed", `${body.artifactKey} already installed globally for ${agentId}`);
    }

    const targetInstalls = workingRepo ? await deps.installs.listByWorkingRepo(workingRepo.id) : [];
    const sha = body.sha ?? artifact.lastTouchedSha;
    if (!sha) throw new AppError("bad_input", "could not resolve SHA for artifact");

    const record = await installArtifact({
      artifact, skillsRepo, target: body.target, workingRepo, agent, sha,
      autoUpdate: body.autoUpdate ?? false,
      existingInstallsInTarget: targetInstalls,
    });
    const persisted = await deps.installs.add(record);
    return reply.code(201).send(persisted);
  });

  app.delete<{ Params: { id: string } }>("/api/installs/:id", async (req, reply) => {
    const install = await deps.installs.get(req.params.id);
    if (!install) return reply.code(404).send({ code: "artifact_not_found" });
    let workingRepo;
    let remaining: Awaited<ReturnType<typeof deps.installs.list>> = [];
    if (install.target.type === "working-repo") {
      workingRepo = await deps.workingRepos.get(install.target.workingRepoId);
      remaining = (await deps.installs.listByWorkingRepo(install.target.workingRepoId)).filter((i) => i.id !== install.id);
    }
    await uninstallArtifact({ install, workingRepo, remainingInstallsInTarget: remaining });
    await deps.installs.remove(install.id);
    return reply.code(204).send();
  });
}
```

- [ ] **Step 4: Wire into routes.ts**

Add `import { registerInstallsRoutes } from "./installs.ts";` and `await registerInstallsRoutes(app, deps);`.

- [ ] **Step 5: Run tests (should pass)**

Run: `npm test -- tests/integration/api.test.ts`
Expected: 6 passed.

- [ ] **Step 6: Commit**

```bash
git add src/api/installs.ts src/api/routes.ts tests/integration/api.test.ts
git commit -m "feat(api): installs create/list/delete with already_installed guard"
```

---

### Task 27: BE entry point

**Files:**
- Create: `src/index.ts`

The actual `tsx src/index.ts` entry that wires real stores + ports + listen.

- [ ] **Step 1: Implement `src/index.ts`**

```typescript
// src/index.ts
import { buildServer } from "./server.ts";
import { ensureStateDirs, resolveStateDir, resolveCacheDir } from "./state/paths.ts";
import { SettingsStore } from "./state/settings.ts";
import { SkillsRepoStore } from "./state/skills-repos.ts";
import { WorkingRepoStore } from "./state/working-repos.ts";
import { InstallsStore } from "./state/installs.ts";
import { buildRegistries } from "./adapters/index.ts";
import { pickFreePort } from "./ports.ts";

async function main() {
  ensureStateDirs();
  const stateDir = resolveStateDir();
  const cacheDir = resolveCacheDir();
  const settings = new SettingsStore(stateDir);
  const skillsRepos = new SkillsRepoStore(stateDir);
  const workingRepos = new WorkingRepoStore(stateDir);
  const installs = new InstallsStore(stateDir);
  const registries = buildRegistries();
  const app = await buildServer({ stateDir, cacheDir, settings, skillsRepos, workingRepos, installs, registries });
  const desired = (await settings.read()).mcpPort;
  const port = await pickFreePort(desired);
  if (port !== desired) await settings.update({ mcpPort: port });
  await app.listen({ port, host: "127.0.0.1" });
  process.stdout.write(`Skills Manager listening at http://127.0.0.1:${port}\n`);
}

main().catch((err) => {
  process.stderr.write(`fatal: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
```

- [ ] **Step 2: Smoke-run the BE**

Run: `npx tsx src/index.ts` in one terminal; in another: `curl http://127.0.0.1:7747/api/settings`
Expected: JSON `{"favoriteAgent":"claude-code","mcpPort":7747}`. Stop with Ctrl-C.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat(be): entry point boots stores + server + picks free port"
```

---

## Phase 8 — FE shell + API client

### Task 28: API client

**Files:**
- Create: `web/api.ts`

Single thin layer over `fetch`. Vite dev proxies `/api` to the BE in dev; production hits the same origin.

- [ ] **Step 1: Implement `api.ts`**

```typescript
// web/api.ts
export interface SkillsRepo {
  id: string; name: string; gitUrl: string; branch: string;
  artifactPaths: { skills?: string[] };
  presetId: string | null; localClonePath: string; lastFetchedAt: string | null;
}
export interface WorkingRepo { id: string; name: string; path: string; addedAt: string; }
export interface Settings { favoriteAgent: "claude-code" | "cursor"; mcpPort: number; }
export interface Artifact {
  artifactKey: string; sourceRepoId: string; type: "skills";
  name: string; description: string | null;
  rootRelativePath: string; files: string[]; lastTouchedSha: string | null;
}
export interface Install {
  id: string; artifactKey: string; sourceRepoId: string;
  target: { type: "working-repo"; workingRepoId: string } | { type: "global" };
  agent: "claude-code" | "cursor";
  installedCommitSha: string; autoUpdate: boolean;
  installedFiles: { sourcePath: string; targetPath: string }[];
  installedAt: string;
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let err: { code?: string; message?: string } = {};
    try { err = await res.json(); } catch { /* ignore */ }
    throw Object.assign(new Error(err.message ?? `HTTP ${res.status}`), { code: err.code, status: res.status });
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  getSettings: () => req<Settings>("GET", "/api/settings"),
  updateSettings: (patch: Partial<Settings>) => req<Settings>("PATCH", "/api/settings", patch),

  listSkillsRepos: () => req<SkillsRepo[]>("GET", "/api/skills-repos"),
  getSkillsRepo: (id: string) => req<SkillsRepo>("GET", `/api/skills-repos/${id}`),
  registerSkillsRepo: (body: { name: string; gitUrl: string; branch?: string; artifactPaths?: { skills?: string[] } }) =>
    req<SkillsRepo>("POST", "/api/skills-repos", body),
  deleteSkillsRepo: (id: string) => req<void>("DELETE", `/api/skills-repos/${id}`),
  refreshSkillsRepo: (id: string) => req<SkillsRepo>("POST", `/api/skills-repos/${id}/refresh`),

  listWorkingRepos: () => req<WorkingRepo[]>("GET", "/api/working-repos"),
  registerWorkingRepo: (body: { name: string; path: string }) => req<WorkingRepo>("POST", "/api/working-repos", body),
  deleteWorkingRepo: (id: string) => req<void>("DELETE", `/api/working-repos/${id}`),

  listArtifacts: (q?: { q?: string; type?: string; sourceRepoId?: string }) => {
    const params = new URLSearchParams();
    if (q?.q) params.set("q", q.q);
    if (q?.type) params.set("type", q.type);
    if (q?.sourceRepoId) params.set("sourceRepoId", q.sourceRepoId);
    const qs = params.toString();
    return req<Artifact[]>("GET", `/api/artifacts${qs ? `?${qs}` : ""}`);
  },

  listInstallsByWorkingRepo: (workingRepoId: string) =>
    req<Install[]>("GET", `/api/working-repos/${workingRepoId}/installs`),
  createInstall: (body: {
    artifactKey: string;
    target: { type: "working-repo"; workingRepoId: string } | { type: "global" };
    agent?: "claude-code" | "cursor";
    autoUpdate?: boolean;
  }) => req<Install>("POST", "/api/installs", body),
  deleteInstall: (id: string) => req<void>("DELETE", `/api/installs/${id}`),
};
```

- [ ] **Step 2: Commit**

```bash
git add web/api.ts
git commit -m "feat(fe): typed API client over fetch"
```

---

### Task 29: Router shell + sidebar

**Files:**
- Modify: `web/App.tsx`
- Create: `web/routes.tsx`
- Create: `web/components/Sidebar.tsx`
- Create: `web/styles/theme.css`
- Modify: `web/main.tsx`

- [ ] **Step 1: Theme CSS**

```css
/* web/styles/theme.css */
:root {
  --bg: #1a1a1c;
  --panel: #232326;
  --border: rgba(255,255,255,0.08);
  --text: #e6e6e8;
  --muted: #8a8a90;
  --accent: #3b3;
  --warn: #fc6;
  --danger: #f88;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); }
button { font: inherit; cursor: pointer; }
.app { display: flex; min-height: 100vh; }
.sidebar { width: 200px; background: var(--panel); border-right: 1px solid var(--border); padding: 16px; }
.sidebar h1 { font-size: 14px; margin: 0 0 18px; }
.sidebar a { display: block; padding: 6px 10px; border-radius: 4px; color: var(--text); text-decoration: none; font-size: 13px; }
.sidebar a.active { background: rgba(255,255,255,0.08); }
.main { flex: 1; padding: 20px; }
.card { background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 14px; }
.table { width: 100%; border-collapse: collapse; font-size: 13px; }
.table th, .table td { padding: 8px 10px; border-bottom: 1px solid var(--border); text-align: left; }
input, select { background: var(--panel); color: var(--text); border: 1px solid var(--border); border-radius: 4px; padding: 6px 8px; font: inherit; }
.btn { background: var(--accent); color: #fff; border: none; padding: 6px 12px; border-radius: 4px; }
.btn.secondary { background: transparent; color: var(--muted); }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; }
.modal { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 18px; min-width: 420px; max-width: 560px; }
.field { margin-bottom: 10px; }
.field label { display: block; font-size: 11px; color: var(--muted); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.04em; }
```

- [ ] **Step 2: Sidebar**

```tsx
// web/components/Sidebar.tsx
import { NavLink } from "react-router-dom";

export function Sidebar() {
  return (
    <nav className="sidebar">
      <h1>Skills Manager</h1>
      <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>Dashboard</NavLink>
      <NavLink to="/browse" className={({ isActive }) => (isActive ? "active" : "")}>Browse</NavLink>
      <NavLink to="/skills-repos" className={({ isActive }) => (isActive ? "active" : "")}>Skills repos</NavLink>
      <NavLink to="/working-repos" className={({ isActive }) => (isActive ? "active" : "")}>Working repos</NavLink>
      <NavLink to="/settings" className={({ isActive }) => (isActive ? "active" : "")}>Settings</NavLink>
    </nav>
  );
}
```

- [ ] **Step 3: Routes**

```tsx
// web/routes.tsx
import { Routes, Route } from "react-router-dom";
import { Dashboard } from "./pages/Dashboard.tsx";
import { Browse } from "./pages/Browse.tsx";
import { SkillsRepos } from "./pages/SkillsRepos.tsx";
import { SkillsRepoDetail } from "./pages/SkillsRepoDetail.tsx";
import { WorkingRepos } from "./pages/WorkingRepos.tsx";
import { WorkingRepoDetail } from "./pages/WorkingRepoDetail.tsx";
import { Settings } from "./pages/Settings.tsx";

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
    </Routes>
  );
}
```

- [ ] **Step 4: App + main**

```tsx
// web/App.tsx
import { BrowserRouter } from "react-router-dom";
import { Sidebar } from "./components/Sidebar.tsx";
import { AppRoutes } from "./routes.tsx";

export function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <Sidebar />
        <main className="main"><AppRoutes /></main>
      </div>
    </BrowserRouter>
  );
}
```

```tsx
// web/main.tsx
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles/theme.css";

createRoot(document.getElementById("root")!).render(<App />);
```

- [ ] **Step 5: Page stubs (each just a heading for now)**

Create each of:

```tsx
// web/pages/Dashboard.tsx
export function Dashboard() { return <h2>Dashboard</h2>; }
```

```tsx
// web/pages/Browse.tsx
export function Browse() { return <h2>Browse</h2>; }
```

```tsx
// web/pages/SkillsRepos.tsx
export function SkillsRepos() { return <h2>Skills repos</h2>; }
```

```tsx
// web/pages/SkillsRepoDetail.tsx
export function SkillsRepoDetail() { return <h2>Skills repo detail</h2>; }
```

```tsx
// web/pages/WorkingRepos.tsx
export function WorkingRepos() { return <h2>Working repos</h2>; }
```

```tsx
// web/pages/WorkingRepoDetail.tsx
export function WorkingRepoDetail() { return <h2>Working repo detail</h2>; }
```

```tsx
// web/pages/Settings.tsx
export function Settings() { return <h2>Settings</h2>; }
```

- [ ] **Step 6: Verify FE builds**

Run: `npm run build:fe`
Expected: `dist/web/index.html` and `dist/web/assets/*.js` exist.

- [ ] **Step 7: Commit**

```bash
git add web/
git commit -m "feat(fe): app shell with sidebar, router, page stubs"
```

---

## Phase 9 — FE pages + modals

### Task 30: Skills repos page + register modal

**Files:**
- Create: `web/components/RegisterSkillsRepoModal.tsx`
- Modify: `web/pages/SkillsRepos.tsx`

- [ ] **Step 1: Register modal**

```tsx
// web/components/RegisterSkillsRepoModal.tsx
import { useState } from "react";
import { api } from "../api.ts";

export function RegisterSkillsRepoModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [gitUrl, setGitUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [skillsPaths, setSkillsPaths] = useState("ai/skills");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await api.registerSkillsRepo({
        name, gitUrl, branch,
        artifactPaths: { skills: skillsPaths.split(",").map((s) => s.trim()).filter(Boolean) },
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Register skills repository</h3>
        <div className="field">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%" }} />
        </div>
        <div className="field">
          <label>Git URL</label>
          <input value={gitUrl} onChange={(e) => setGitUrl(e.target.value)} style={{ width: "100%" }} placeholder="https://github.com/..." />
        </div>
        <div className="field">
          <label>Branch</label>
          <input value={branch} onChange={(e) => setBranch(e.target.value)} style={{ width: "100%" }} />
        </div>
        <div className="field">
          <label>Skills paths (comma-separated)</label>
          <input value={skillsPaths} onChange={(e) => setSkillsPaths(e.target.value)} style={{ width: "100%" }} />
        </div>
        {error && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 8 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn secondary" onClick={onClose} disabled={submitting}>Cancel</button>
          <button className="btn" onClick={submit} disabled={submitting || !name || !gitUrl}>Register</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Skills repos page**

```tsx
// web/pages/SkillsRepos.tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, SkillsRepo } from "../api.ts";
import { RegisterSkillsRepoModal } from "../components/RegisterSkillsRepoModal.tsx";

export function SkillsRepos() {
  const [repos, setRepos] = useState<SkillsRepo[]>([]);
  const [open, setOpen] = useState(false);

  const reload = () => { api.listSkillsRepos().then(setRepos); };
  useEffect(reload, []);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Skills repos</h2>
        <button className="btn" style={{ marginLeft: "auto" }} onClick={() => setOpen(true)}>+ Register</button>
      </div>
      <table className="table">
        <thead><tr><th>Name</th><th>Git URL</th><th>Branch</th><th>Skills paths</th><th></th></tr></thead>
        <tbody>
          {repos.map((r) => (
            <tr key={r.id}>
              <td><Link to={`/skills-repos/${r.id}`}>{r.name}</Link></td>
              <td style={{ color: "var(--muted)" }}>{r.gitUrl}</td>
              <td>{r.branch}</td>
              <td>{(r.artifactPaths.skills ?? []).join(", ")}</td>
              <td><button className="btn secondary" onClick={async () => { await api.deleteSkillsRepo(r.id); reload(); }}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {open && <RegisterSkillsRepoModal onClose={() => setOpen(false)} onDone={() => { setOpen(false); reload(); }} />}
    </>
  );
}
```

- [ ] **Step 3: Verify FE builds**

Run: `npm run build:fe`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add web/components/RegisterSkillsRepoModal.tsx web/pages/SkillsRepos.tsx
git commit -m "feat(fe): skills repos list + register modal"
```

---

### Task 31: Skills repo detail page

**Files:**
- Modify: `web/pages/SkillsRepoDetail.tsx`

- [ ] **Step 1: Implement detail page**

```tsx
// web/pages/SkillsRepoDetail.tsx
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, Artifact, SkillsRepo } from "../api.ts";

export function SkillsRepoDetail() {
  const { id = "" } = useParams();
  const [repo, setRepo] = useState<SkillsRepo | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);

  useEffect(() => {
    api.getSkillsRepo(id).then(setRepo);
    api.listArtifacts({ sourceRepoId: id }).then(setArtifacts);
  }, [id]);

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
          const updated = await api.refreshSkillsRepo(repo.id);
          setRepo(updated);
          setArtifacts(await api.listArtifacts({ sourceRepoId: repo.id }));
        }}>Refresh</button>
      </div>
      <h3>Discovered artifacts</h3>
      <table className="table">
        <thead><tr><th>Name</th><th>Type</th><th>Description</th><th>Path</th></tr></thead>
        <tbody>
          {artifacts.map((a) => (
            <tr key={a.artifactKey}>
              <td>{a.name}</td>
              <td>{a.type}</td>
              <td style={{ color: "var(--muted)" }}>{a.description ?? "—"}</td>
              <td style={{ color: "var(--muted)" }}>{a.rootRelativePath}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
```

- [ ] **Step 2: Verify FE builds**

Run: `npm run build:fe`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add web/pages/SkillsRepoDetail.tsx
git commit -m "feat(fe): skills repo detail page"
```

---

### Task 32: Working repos page + register modal + detail

**Files:**
- Create: `web/components/RegisterWorkingRepoModal.tsx`
- Modify: `web/pages/WorkingRepos.tsx`
- Modify: `web/pages/WorkingRepoDetail.tsx`

- [ ] **Step 1: Register modal**

```tsx
// web/components/RegisterWorkingRepoModal.tsx
import { useState } from "react";
import { api } from "../api.ts";

export function RegisterWorkingRepoModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try { await api.registerWorkingRepo({ name, path }); onDone(); }
    catch (e) { setError((e as Error).message); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Register working repository</h3>
        <div className="field"><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%" }} /></div>
        <div className="field"><label>Absolute path</label><input value={path} onChange={(e) => setPath(e.target.value)} style={{ width: "100%" }} placeholder="/Users/me/code/project" /></div>
        {error && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 8 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn secondary" onClick={onClose} disabled={submitting}>Cancel</button>
          <button className="btn" onClick={submit} disabled={submitting || !name || !path}>Register</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Working repos list page**

```tsx
// web/pages/WorkingRepos.tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, WorkingRepo } from "../api.ts";
import { RegisterWorkingRepoModal } from "../components/RegisterWorkingRepoModal.tsx";

export function WorkingRepos() {
  const [repos, setRepos] = useState<WorkingRepo[]>([]);
  const [open, setOpen] = useState(false);
  const reload = () => { api.listWorkingRepos().then(setRepos); };
  useEffect(reload, []);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Working repos</h2>
        <button className="btn" style={{ marginLeft: "auto" }} onClick={() => setOpen(true)}>+ Register</button>
      </div>
      <table className="table">
        <thead><tr><th>Name</th><th>Path</th><th></th></tr></thead>
        <tbody>
          {repos.map((r) => (
            <tr key={r.id}>
              <td><Link to={`/working-repos/${r.id}`}>{r.name}</Link></td>
              <td style={{ color: "var(--muted)" }}>{r.path}</td>
              <td><button className="btn secondary" onClick={async () => { await api.deleteWorkingRepo(r.id); reload(); }}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {open && <RegisterWorkingRepoModal onClose={() => setOpen(false)} onDone={() => { setOpen(false); reload(); }} />}
    </>
  );
}
```

- [ ] **Step 3: Working repo detail page**

```tsx
// web/pages/WorkingRepoDetail.tsx
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, Install, WorkingRepo } from "../api.ts";

export function WorkingRepoDetail() {
  const { id = "" } = useParams();
  const [repo, setRepo] = useState<WorkingRepo | null>(null);
  const [installs, setInstalls] = useState<Install[]>([]);

  const reload = () => {
    api.listWorkingRepos().then((all) => setRepo(all.find((r) => r.id === id) ?? null));
    api.listInstallsByWorkingRepo(id).then(setInstalls);
  };
  useEffect(reload, [id]);

  if (!repo) return <p>Loading…</p>;
  return (
    <>
      <p style={{ color: "var(--muted)", fontSize: 12 }}><Link to="/working-repos">Working repos</Link> / {repo.name}</p>
      <h2 style={{ marginTop: 0 }}>{repo.name}</h2>
      <div className="card" style={{ marginBottom: 16, fontSize: 13 }}>
        <div><strong>Path:</strong> {repo.path}</div>
        <div style={{ color: "var(--muted)" }}>Added {repo.addedAt}</div>
      </div>
      <h3>Installed</h3>
      <table className="table">
        <thead><tr><th>Skill</th><th>Source</th><th>Agent</th><th>Version</th><th>Auto-update</th><th></th></tr></thead>
        <tbody>
          {installs.map((i) => {
            const [, rel] = i.artifactKey.split(":", 2);
            return (
              <tr key={i.id}>
                <td>{rel?.split("/").pop()}</td>
                <td style={{ color: "var(--muted)" }}>{i.sourceRepoId.slice(0, 8)}</td>
                <td>{i.agent}</td>
                <td style={{ color: "var(--muted)" }}>{i.installedCommitSha.slice(0, 7)}</td>
                <td>{i.autoUpdate ? "on" : "off"}</td>
                <td><button className="btn secondary" onClick={async () => { await api.deleteInstall(i.id); reload(); }}>Uninstall</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
```

- [ ] **Step 4: Verify FE builds**

Run: `npm run build:fe`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add web/components/RegisterWorkingRepoModal.tsx web/pages/WorkingRepos.tsx web/pages/WorkingRepoDetail.tsx
git commit -m "feat(fe): working repos list + register + detail with installs"
```

---

### Task 33: Browse page + Install modal

**Files:**
- Create: `web/components/InstallModal.tsx`
- Modify: `web/pages/Browse.tsx`
- Create: `tests/unit/install-modal.test.tsx`

The install modal pre-fills the agent from `settings.favoriteAgent`. We test that bit.

- [ ] **Step 1: Add JSDOM environment for FE tests**

Edit `vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "node",
    environmentMatchGlobs: [["tests/**/*.test.tsx", "jsdom"]],
    testTimeout: 30000,
    setupFiles: ["tests/helpers/setup.ts"],
  },
});
```

Install jsdom + testing-library:

```bash
npm i -D jsdom @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 2: Install modal component**

```tsx
// web/components/InstallModal.tsx
import { useEffect, useState } from "react";
import { api, Artifact, Settings, WorkingRepo } from "../api.ts";

interface Props {
  artifact: Artifact;
  onClose: () => void;
  onDone: () => void;
}

export function InstallModal({ artifact, onClose, onDone }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [workingRepos, setWorkingRepos] = useState<WorkingRepo[]>([]);
  const [scope, setScope] = useState<"working-repo" | "global">("working-repo");
  const [workingRepoId, setWorkingRepoId] = useState("");
  const [agent, setAgent] = useState<"claude-code" | "cursor">("claude-code");
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([api.getSettings(), api.listWorkingRepos()]).then(([s, wr]) => {
      setSettings(s);
      setAgent(s.favoriteAgent);
      setWorkingRepos(wr);
      if (wr[0]) setWorkingRepoId(wr[0].id);
    });
  }, []);

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await api.createInstall({
        artifactKey: artifact.artifactKey,
        target: scope === "working-repo" ? { type: "working-repo", workingRepoId } : { type: "global" },
        agent, autoUpdate,
      });
      onDone();
    } catch (e) { setError((e as Error).message); }
    finally { setSubmitting(false); }
  };

  if (!settings) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Install skill</h3>
        <div className="field">
          <label>Skill</label>
          <div>{artifact.name} <span style={{ color: "var(--muted)" }}>· {artifact.sourceRepoId.slice(0, 8)}</span></div>
        </div>
        <div className="field">
          <label>Target</label>
          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <button className="btn secondary" style={{ background: scope === "working-repo" ? "rgba(255,255,255,0.08)" : undefined }} onClick={() => setScope("working-repo")}>Working repo</button>
            <button className="btn secondary" style={{ background: scope === "global" ? "rgba(255,255,255,0.08)" : undefined }} onClick={() => setScope("global")}>Global</button>
          </div>
          {scope === "working-repo" && (
            <select value={workingRepoId} onChange={(e) => setWorkingRepoId(e.target.value)} style={{ width: "100%" }} aria-label="Working repo">
              {workingRepos.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          )}
        </div>
        <div className="field">
          <label>Agent</label>
          <select value={agent} onChange={(e) => setAgent(e.target.value as "claude-code" | "cursor")} aria-label="Agent" style={{ width: "100%" }}>
            <option value="claude-code">Claude Code</option>
            <option value="cursor">Cursor</option>
          </select>
        </div>
        <div className="field">
          <label><input type="checkbox" checked={autoUpdate} onChange={(e) => setAutoUpdate(e.target.checked)} /> Auto-update</label>
        </div>
        {error && <div style={{ color: "var(--danger)", fontSize: 12 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn secondary" onClick={onClose} disabled={submitting}>Cancel</button>
          <button className="btn" onClick={submit} disabled={submitting || (scope === "working-repo" && !workingRepoId)}>Install</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Browse page**

```tsx
// web/pages/Browse.tsx
import { useEffect, useState } from "react";
import { api, Artifact } from "../api.ts";
import { InstallModal } from "../components/InstallModal.tsx";

export function Browse() {
  const [q, setQ] = useState("");
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [installing, setInstalling] = useState<Artifact | null>(null);

  useEffect(() => { api.listArtifacts({ q: q || undefined }).then(setArtifacts); }, [q]);

  return (
    <>
      <h2 style={{ marginTop: 0 }}>Browse</h2>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" style={{ width: 360, marginBottom: 14 }} />
      <table className="table">
        <thead><tr><th>Name</th><th>Source</th><th>Description</th><th></th></tr></thead>
        <tbody>
          {artifacts.map((a) => (
            <tr key={a.artifactKey}>
              <td>{a.name}</td>
              <td style={{ color: "var(--muted)" }}>{a.sourceRepoId.slice(0, 8)}</td>
              <td style={{ color: "var(--muted)" }}>{a.description ?? "—"}</td>
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

- [ ] **Step 4: Test install modal pre-fills favorite agent**

```tsx
// tests/unit/install-modal.test.tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { InstallModal } from "../../web/components/InstallModal.tsx";
import type { Artifact } from "../../web/api.ts";

beforeEach(() => {
  // @ts-ignore
  globalThis.fetch = vi.fn(async (url: string) => {
    if (url === "/api/settings") return new Response(JSON.stringify({ favoriteAgent: "cursor", mcpPort: 7747 }), { status: 200 });
    if (url === "/api/working-repos") return new Response(JSON.stringify([{ id: "w1", name: "alpha", path: "/x", addedAt: "" }]), { status: 200 });
    return new Response("{}", { status: 200 });
  });
});

const artifact: Artifact = {
  artifactKey: "src1:ai/skills/foo", sourceRepoId: "src1", type: "skills",
  name: "foo", description: null, rootRelativePath: "ai/skills/foo",
  files: ["ai/skills/foo/SKILL.md"], lastTouchedSha: "abc",
};

describe("InstallModal", () => {
  it("pre-fills the agent from settings.favoriteAgent", async () => {
    render(<InstallModal artifact={artifact} onClose={() => {}} onDone={() => {}} />);
    const select = await waitFor(() => screen.getByLabelText("Agent") as HTMLSelectElement);
    expect(select.value).toBe("cursor");
  });
});
```

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/unit/install-modal.test.tsx`
Expected: 1 passed.

- [ ] **Step 6: Verify FE builds**

Run: `npm run build:fe`
Expected: success.

- [ ] **Step 7: Commit**

```bash
git add web/components/InstallModal.tsx web/pages/Browse.tsx tests/unit/install-modal.test.tsx vitest.config.ts package.json package-lock.json
git commit -m "feat(fe): Browse page + Install modal with favorite-agent prefill"
```

---

### Task 34: Dashboard + Settings page

**Files:**
- Modify: `web/pages/Dashboard.tsx`
- Modify: `web/pages/Settings.tsx`

Slice-1 Dashboard: a thin overview — list of working repos with chips of installed-skill names, and a thin list of skills repos. No "new skill cards", no notification dots, no status pills (those need slice 2+).

- [ ] **Step 1: Dashboard**

```tsx
// web/pages/Dashboard.tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, SkillsRepo, WorkingRepo, Install } from "../api.ts";

export function Dashboard() {
  const [working, setWorking] = useState<WorkingRepo[]>([]);
  const [sources, setSources] = useState<SkillsRepo[]>([]);
  const [installsByWr, setInstallsByWr] = useState<Record<string, Install[]>>({});

  useEffect(() => {
    (async () => {
      const wr = await api.listWorkingRepos();
      setWorking(wr);
      setSources(await api.listSkillsRepos());
      const map: Record<string, Install[]> = {};
      for (const w of wr) map[w.id] = await api.listInstallsByWorkingRepo(w.id);
      setInstallsByWr(map);
    })();
  }, []);

  return (
    <>
      <h2 style={{ marginTop: 0 }}>Dashboard</h2>
      <section style={{ marginBottom: 28 }}>
        <h3>Working repos</h3>
        {working.length === 0 && <p style={{ color: "var(--muted)" }}>No working repos yet — register one to get started.</p>}
        {working.map((w) => (
          <div key={w.id} className="card" style={{ marginBottom: 10 }}>
            <Link to={`/working-repos/${w.id}`} style={{ color: "var(--text)", textDecoration: "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <strong>{w.name}</strong>
                <span style={{ color: "var(--muted)", fontSize: 12, marginLeft: "auto" }}>{w.path}</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, fontSize: 12, color: "var(--muted)" }}>
                {(installsByWr[w.id] ?? []).map((i) => (
                  <span key={i.id} style={{ background: "rgba(255,255,255,0.06)", padding: "3px 8px", borderRadius: 3 }}>
                    {i.artifactKey.split("/").pop()}
                  </span>
                ))}
                {(installsByWr[w.id] ?? []).length === 0 && <em>no installs yet</em>}
              </div>
            </Link>
          </div>
        ))}
      </section>
      <section>
        <h3>Skills repos</h3>
        {sources.length === 0 && <p style={{ color: "var(--muted)" }}>No sources registered.</p>}
        <table className="table">
          <tbody>
            {sources.map((s) => (
              <tr key={s.id}>
                <td><Link to={`/skills-repos/${s.id}`}>{s.name}</Link></td>
                <td style={{ color: "var(--muted)" }}>{s.gitUrl}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
```

- [ ] **Step 2: Settings page**

```tsx
// web/pages/Settings.tsx
import { useEffect, useState } from "react";
import { api, Settings as SettingsT } from "../api.ts";

export function Settings() {
  const [s, setS] = useState<SettingsT | null>(null);
  useEffect(() => { api.getSettings().then(setS); }, []);
  if (!s) return <p>Loading…</p>;
  return (
    <>
      <h2 style={{ marginTop: 0 }}>Settings</h2>
      <div className="card" style={{ maxWidth: 480 }}>
        <div className="field">
          <label>Favorite agent</label>
          <select value={s.favoriteAgent} onChange={async (e) => setS(await api.updateSettings({ favoriteAgent: e.target.value as "claude-code" | "cursor" }))} style={{ width: "100%" }}>
            <option value="claude-code">Claude Code</option>
            <option value="cursor">Cursor</option>
          </select>
        </div>
        <div className="field" style={{ color: "var(--muted)", fontSize: 12 }}>
          MCP port: {s.mcpPort} (MCP server arrives in slice 3)
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 3: Verify FE builds**

Run: `npm run build:fe`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add web/pages/Dashboard.tsx web/pages/Settings.tsx
git commit -m "feat(fe): minimal dashboard + settings page (favorite agent)"
```

---

## Phase 10 — Launcher + smoke

### Task 35: `skillmgr` CLI launcher

**Files:**
- Create: `bin/skillmgr.js`

A thin shim that runs the compiled BE (or falls back to `tsx` in dev), opens the default browser, and shuts down on exit.

- [ ] **Step 1: Implement launcher**

```javascript
#!/usr/bin/env node
// bin/skillmgr.js
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import open from "open";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const compiled = path.join(root, "dist", "be", "index.js");
const cmd = existsSync(compiled)
  ? { run: process.execPath, args: [compiled] }
  : { run: process.execPath, args: [path.join(root, "node_modules", "tsx", "dist", "cli.mjs"), path.join(root, "src", "index.ts")] };

const child = spawn(cmd.run, cmd.args, { stdio: ["ignore", "pipe", "inherit"], cwd: root });

let opened = false;
child.stdout.on("data", (chunk) => {
  const s = chunk.toString();
  process.stdout.write(s);
  if (!opened) {
    const m = s.match(/http:\/\/127\.0\.0\.1:(\d+)/);
    if (m) {
      opened = true;
      open(m[0]).catch(() => {});
    }
  }
});

process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
child.on("exit", (code) => process.exit(code ?? 0));
```

- [ ] **Step 2: Make it executable on POSIX**

Run (POSIX only — skipped on Windows): `chmod +x bin/skillmgr.js`

- [ ] **Step 3: Smoke-launch the full app**

In one terminal:

Run: `npm run build` (builds FE to `dist/web` and BE to `dist/be`).
Run: `node bin/skillmgr.js`
Expected: a browser opens to `http://127.0.0.1:7747` and the Skills Manager UI loads. Stop with Ctrl-C.

- [ ] **Step 4: Commit**

```bash
git add bin/skillmgr.js
git commit -m "feat: skillmgr CLI launcher boots BE + opens browser"
```

---

### Task 36: README + manual smoke checklist

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# Skills Manager

Locally-run application that manages AI-agent artifacts (skills, rules, …) across multiple source repositories and multiple working repositories, without polluting the working repos' git history.

See `docs/product-specification.md` for capabilities and `docs/design.md` for architecture.

## Requirements

- Node.js 20+
- git on PATH

## Install (from source)

\`\`\`bash
npm install
npm run build
node bin/skillmgr.js
\`\`\`

The first launch opens your browser to `http://127.0.0.1:7747` (or the next free port).

## Dev

\`\`\`bash
# Terminal 1 — BE with auto-reload
npm run dev:be

# Terminal 2 — FE with HMR (proxies /api to BE)
npm run dev:fe
\`\`\`

## Tests

\`\`\`bash
npm test
\`\`\`

## State location

State lives in the OS user-data directory:

- macOS: `~/Library/Application Support/skillmanager/`
- Linux: `~/.config/skillmanager/`
- Windows: `%APPDATA%\skillmanager\`

## Slice 1 — manual smoke test

1. Launch the app, open Settings, confirm favorite agent shows `Claude Code`.
2. Skills repos → Register: name `superpowers`, git URL (file:// to a local fixture or a public repo), branch `main`, skills paths `skills` (or wherever).
3. The repo appears in the list; click it to see discovered skills.
4. Working repos → Register: name `test-proj`, path to any existing local git repo (`mkdir t && cd t && git init` works for a fresh one).
5. Browse → find a skill → Install. Pick the working repo, leave agent as Claude Code.
6. Check the working repo: `.claude/skills/<name>/` exists, `.git/info/exclude` contains a `# BEGIN skills-manager` block listing the new path, `git status` is clean.
7. Open the working-repo detail page; the install appears.
8. Uninstall — files vanish, exclude block is updated.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README with build/run/smoke checklist"
```

---

### Task 37: Slice-1 acceptance check

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: ALL tests pass. If anything is red, fix it before continuing.

- [ ] **Step 2: Type-check both halves**

Run: `npx tsc -p tsconfig.be.json --noEmit && npx tsc -p tsconfig.fe.json --noEmit`
Expected: no errors.

- [ ] **Step 3: Manually walk the smoke checklist in README**

Follow the eight steps in the README's "Slice 1 — manual smoke test" section against a real fixture (or a public skills repo) and a fresh `git init` working repo. Confirm: files written to `.claude/skills/<name>/`, `.git/info/exclude` block present and correct, working repo's `git status` clean, uninstall reverses everything.

- [ ] **Step 4: Tag the slice**

```bash
git tag -a slice-1 -m "Walking skeleton: register sources + targets, browse, manual install"
git log --oneline -1
```

(Don't push the tag unless the user asks.)

---

## Self-review

Run through the spec/design once more and confirm coverage.

| Spec/design requirement                                                                 | Where it's implemented                                          |
|------------------------------------------------------------------------------------------|------------------------------------------------------------------|
| Register skills repo by git URL                                                          | Task 23 (`/api/skills-repos` POST), Task 30 (UI modal)          |
| Per-artifact-type paths in registration                                                  | Task 5 (schema), Task 23 (payload), Task 30 (UI input)          |
| Local clone of source repo in cache dir                                                  | Task 4 (resolveCacheDir), Task 23 (cloneIntoCache)              |
| Register working repo, validated as a git repo                                           | Task 24 (POST `/api/working-repos` with `.git` check)           |
| Browse / search artifacts                                                                | Task 25 (artifacts list with q/type/sourceRepoId), Task 33 (UI) |
| Install into working repo                                                                | Tasks 19, 26                                                    |
| Install globally (per-agent home dir)                                                    | Tasks 14, 15 (targetRoot global scope), Task 26 (target type)   |
| File contents copied as-is + filename mapping (`CLAUDE.md` → `AGENTS.md` for Cursor)     | Task 15 (mapFileName), Task 19 (engine applies it)              |
| `.git/info/exclude` block (no edits to tracked files)                                    | Tasks 18, 19, 20 (write + reconcile across installs)            |
| Install records persisted with source SHA                                                | Tasks 9, 19                                                     |
| Favorite-agent default that the install modal pre-fills                                  | Task 7 (SettingsStore default), Task 22 (`/api/settings`), Task 33 (UI test) |
| Adapter abstraction (no Claude/Cursor names baked into engine)                           | Task 12 (interfaces + registries), Tasks 14–16                  |
| Uninstall removes files + reconciles exclude block                                       | Tasks 20, 26                                                    |
| Already-installed collision uses `(artifactKey, target, agent)` triple                   | Task 9 (`findExisting`), Task 26 (POST `/api/installs`)         |
| Per-OS state directory                                                                   | Task 4 (env-paths)                                              |
| Cross-platform path handling (`node:path`)                                               | All file/path manipulation                                      |
| Real git binary, no mocking; fixtures via `file://` URLs                                 | Task 10 (fixture helper + GitClient), all integration tests     |
| Browse / Working repos / Skills repos / Dashboard / Settings pages, sidebar nav          | Tasks 29, 30, 31, 32, 33, 34                                    |

**Deferred to later slices (documented as out-of-scope here):**

- Update detection, drift detection, status pills, "Needs attention" surfacing (Slice 2)
- MCP server, agent-wiring snippets, Settings → MCP panel (Slice 3)
- New-skill cards on the dashboard, notification dot per working repo, dismissible notifications, full-page diff view, version-history pages (Slice 4)
- Rules artifact type and any non-skills artifact types (later slice; data model already accommodates them)
- Translators (content translation between agent formats); only the no-op seam exists today

---

## Execution handoff

Plan complete and saved to `docs/plans/2026-05-20-slice-1-walking-skeleton.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
