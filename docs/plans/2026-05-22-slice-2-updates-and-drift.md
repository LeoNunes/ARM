# Slice 2 — Updates and Drift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-install update detection, drift detection, auto-update with drift gate, status surfacing in the working-repo detail UI, and the resolution buttons for gated updates.

**Architecture:** Update detection calls `git log <installedSha>..HEAD -- <files>` in the source clone; drift detection calls `git show <sha>:<sourcePath>` and byte-compares with the working-repo file. Status is computed fresh on every GET (volumes are small). An auto-update pass runs on app launch and after each skills-repo refresh; it re-applies installs that are `autoUpdate=true + update-available + not-drifted`. The UI adds a Status column, filter chips, and gated-update resolution buttons on the working-repo detail page.

**Tech Stack:** Node.js + TypeScript (BE), `simple-git`, React + TypeScript (FE), Vitest for tests.

---

## File Map

| File | Created/Modified | Responsibility |
|------|-----------------|----------------|
| `src/git/log.ts` | Modify | Add `hasCommitsTouching` |
| `src/engine/update-check.ts` | **New** | `checkForUpdates`: update detection for one install |
| `src/engine/drift-check.ts` | **New** | `checkForDrift`: byte-compare per install |
| `src/engine/status.ts` | **New** | Pure `computeInstallStatus` + `InstallStatus` type |
| `src/engine/apply-update.ts` | **New** | Re-write install files at a new SHA |
| `src/engine/update-pass.ts` | **New** | Batch auto-update pass (launch + refresh trigger) |
| `src/state/schema.ts` | Modify | Add `artifactType: ArtifactTypeId` to `Install` |
| `src/state/installs.ts` | Modify | Add `update()` method; backward-compat migration for `artifactType` |
| `src/engine/install.ts` | Modify | Include `artifactType` in returned draft record |
| `src/api/installs.ts` | Modify | GET returns status; add PATCH (auto-update toggle); add POST `/update` |
| `src/api/working-repos.ts` | Modify | Add `POST /api/working-repos/:id/refresh` |
| `src/api/skills-repos.ts` | Modify | Run auto-update pass after each source-repo refresh |
| `src/index.ts` | Modify | Run auto-update pass after server starts |
| `web/api.ts` | Modify | Add `InstallStatus`, `InstallWithStatus`; add new API calls |
| `web/components/StatusPill.tsx` | **New** | Status pill component |
| `web/pages/WorkingRepoDetail.tsx` | Modify | Status column, filter chips, Refresh button, resolution buttons |
| `tests/integration/git.test.ts` | Modify | Add `hasCommitsTouching` tests |
| `tests/integration/update-drift.test.ts` | **New** | Update detection, drift detection, apply-update, auto-update pass |
| `tests/unit/status.test.ts` | **New** | `computeInstallStatus` unit tests |

---

## Task 1: Add `hasCommitsTouching` to `src/git/log.ts`

**Files:**
- Modify: `src/git/log.ts`
- Test: `tests/integration/git.test.ts`

- [ ] **Step 1.1: Write the failing tests**

Append to `tests/integration/git.test.ts`:

```typescript
import { hasCommitsTouching } from "../../src/git/log.ts";

describe("hasCommitsTouching", () => {
  it("returns false when no commits after fromSha touch the paths", async () => {
    const fixture = await buildFixtureRepo([
      { message: "v1", files: { "skill/SKILL.md": "v1\n", "other.md": "o\n" } },
      { message: "touch other only", files: { "other.md": "o2\n" } },
    ]);
    const dest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fixture.fileUrl, dest, "main");
    const result = await hasCommitsTouching(dest, fixture.shas[0]!, "main", ["skill/SKILL.md"]);
    expect(result).toBe(false);
  });

  it("returns true when a commit after fromSha touches the paths", async () => {
    const fixture = await buildFixtureRepo([
      { message: "v1", files: { "skill/SKILL.md": "v1\n" } },
      { message: "v2", files: { "skill/SKILL.md": "v2\n" } },
    ]);
    const dest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fixture.fileUrl, dest, "main");
    const result = await hasCommitsTouching(dest, fixture.shas[0]!, "main", ["skill/SKILL.md"]);
    expect(result).toBe(true);
  });

  it("returns false when fromSha equals HEAD", async () => {
    const fixture = await buildFixtureRepo([
      { message: "v1", files: { "skill/SKILL.md": "v1\n" } },
    ]);
    const dest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fixture.fileUrl, dest, "main");
    const result = await hasCommitsTouching(dest, fixture.shas[0]!, "main", ["skill/SKILL.md"]);
    expect(result).toBe(false);
  });
});
```

- [ ] **Step 1.2: Run to confirm failure**

```bash
npx vitest run tests/integration/git.test.ts
```

Expected: FAIL — `hasCommitsTouching` is not exported.

- [ ] **Step 1.3: Implement `hasCommitsTouching` in `src/git/log.ts`**

Append to the existing file:

```typescript
export async function hasCommitsTouching(
  repoPath: string,
  fromSha: string,
  toRef: string,
  paths: string[],
): Promise<boolean> {
  const args = ["log", `${fromSha}..${toRef}`, "--format=%H", "-n", "1", "--"];
  for (const p of paths) args.push(p);
  const out = (await simpleGit(repoPath).raw(args)).trim();
  return out.length > 0;
}
```

- [ ] **Step 1.4: Run tests to confirm they pass**

```bash
npx vitest run tests/integration/git.test.ts
```

Expected: All PASS.

- [ ] **Step 1.5: Commit**

```bash
git add src/git/log.ts tests/integration/git.test.ts
git commit -m "feat(git): add hasCommitsTouching for update detection"
```

---

## Task 2: Create `src/engine/update-check.ts`

**Files:**
- Create: `src/engine/update-check.ts`
- Test: `tests/integration/update-drift.test.ts` (new file, add first describe block)

- [ ] **Step 2.1: Create the test file with the update-check describe block**

Create `tests/integration/update-drift.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildFixtureRepo } from "../helpers/build-fixture-repo.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";
import { GitClient } from "../../src/git/client.ts";
import { buildRegistries } from "../../src/adapters/index.ts";
import { discoverArtifacts } from "../../src/discovery/discover.ts";
import { installArtifact } from "../../src/engine/install.ts";
import { checkForUpdates } from "../../src/engine/update-check.ts";
import { checkForDrift } from "../../src/engine/drift-check.ts";
import { applyUpdate } from "../../src/engine/apply-update.ts";
import { runAutoUpdatePass } from "../../src/engine/update-pass.ts";
import { InstallsStore } from "../../src/state/installs.ts";
import { SkillsRepoStore } from "../../src/state/skills-repos.ts";
import { WorkingRepoStore } from "../../src/state/working-repos.ts";
import { simpleGit } from "simple-git";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SkillsRepo, WorkingRepo, Install } from "../../src/state/schema.ts";

async function makeWorkingRepo(): Promise<WorkingRepo> {
  const dir = await tmpDir("skillmgr-wr-");
  await simpleGit(dir).init();
  await simpleGit(dir).addConfig("user.email", "a@b").addConfig("user.name", "t");
  await simpleGit(dir).commit("seed", [], { "--allow-empty": null });
  return { id: "w1", name: "alpha", path: dir, addedAt: new Date().toISOString() };
}

async function makeInstall(
  fx: Awaited<ReturnType<typeof buildFixtureRepo>>,
  cloneDest: string,
  workingRepo: WorkingRepo,
  sha: string,
  autoUpdate = false,
): Promise<Install> {
  const { agents, types } = buildRegistries();
  const skillsRepo: SkillsRepo = {
    id: "src1", name: "src", gitUrl: fx.fileUrl, branch: "main",
    artifactPaths: { skills: ["ai/skills"] },
    presetId: null, localClonePath: cloneDest, lastFetchedAt: null,
  };
  const artifacts = await discoverArtifacts(skillsRepo, types);
  const foo = artifacts.find((a) => a.name === "foo")!;
  const draft = await installArtifact({
    artifact: foo, skillsRepo,
    target: { type: "working-repo", workingRepoId: workingRepo.id }, workingRepo,
    agent: agents.get("claude-code"), sha,
    autoUpdate,
    existingInstallsInTarget: [],
  });
  return { id: "i1", ...draft };
}

describe("checkForUpdates", () => {
  it("returns hasUpdate=false when no new commits touch the artifact", async () => {
    const fx = await buildFixtureRepo([
      { message: "v1", files: { "ai/skills/foo/SKILL.md": "# Foo\nv1\n" } },
      { message: "unrelated", files: { "other.md": "x\n" } },
    ]);
    const dest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, dest, "main");
    const wr = await makeWorkingRepo();
    const install = await makeInstall(fx, dest, wr, fx.shas[0]!);
    const sr: SkillsRepo = {
      id: "src1", name: "src", gitUrl: fx.fileUrl, branch: "main",
      artifactPaths: { skills: ["ai/skills"] },
      presetId: null, localClonePath: dest, lastFetchedAt: null,
    };
    const result = await checkForUpdates(install, sr);
    expect(result.hasUpdate).toBe(false);
    expect(result.availableSha).toBeNull();
  });

  it("returns hasUpdate=true with new SHA when upstream commits touch the artifact", async () => {
    const fx = await buildFixtureRepo([
      { message: "v1", files: { "ai/skills/foo/SKILL.md": "# Foo\nv1\n" } },
      { message: "v2", files: { "ai/skills/foo/SKILL.md": "# Foo\nv2\n" } },
    ]);
    const dest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, dest, "main");
    const wr = await makeWorkingRepo();
    const install = await makeInstall(fx, dest, wr, fx.shas[0]!);
    const sr: SkillsRepo = {
      id: "src1", name: "src", gitUrl: fx.fileUrl, branch: "main",
      artifactPaths: { skills: ["ai/skills"] },
      presetId: null, localClonePath: dest, lastFetchedAt: null,
    };
    const result = await checkForUpdates(install, sr);
    expect(result.hasUpdate).toBe(true);
    expect(result.availableSha).toBe(fx.shas[1]);
  });
});
```

- [ ] **Step 2.2: Run to confirm failure**

```bash
npx vitest run tests/integration/update-drift.test.ts
```

Expected: FAIL — `checkForUpdates` not found.

- [ ] **Step 2.3: Create `src/engine/update-check.ts`**

```typescript
import { hasCommitsTouching, lastSHATouching } from "../git/log";
import type { Install, SkillsRepo } from "../state/schema";

export interface UpdateCheckResult {
  hasUpdate: boolean;
  availableSha: string | null;
}

export async function checkForUpdates(
  install: Install,
  skillsRepo: SkillsRepo,
): Promise<UpdateCheckResult> {
  const files = install.installedFiles.map((f) => f.sourcePath);
  const hasUpdate = await hasCommitsTouching(
    skillsRepo.localClonePath,
    install.installedCommitSha,
    skillsRepo.branch,
    files,
  );
  if (!hasUpdate) return { hasUpdate: false, availableSha: null };
  const availableSha = await lastSHATouching(skillsRepo.localClonePath, skillsRepo.branch, files);
  return { hasUpdate: true, availableSha };
}
```

- [ ] **Step 2.4: Run tests to confirm they pass**

```bash
npx vitest run tests/integration/update-drift.test.ts --reporter=verbose 2>&1 | head -40
```

Expected: `checkForUpdates` describe passes.

- [ ] **Step 2.5: Commit**

```bash
git add src/engine/update-check.ts tests/integration/update-drift.test.ts
git commit -m "feat(engine): add update detection — checkForUpdates"
```

---

## Task 3: Create `src/engine/drift-check.ts`

**Files:**
- Create: `src/engine/drift-check.ts`
- Test: `tests/integration/update-drift.test.ts` (add drift-check describe)

- [ ] **Step 3.1: Add drift-check tests to `tests/integration/update-drift.test.ts`**

Append to the file:

```typescript
describe("checkForDrift", () => {
  it("returns isDrifted=false when installed files match the source at installedCommitSha", async () => {
    const fx = await buildFixtureRepo([
      { message: "v1", files: { "ai/skills/foo/SKILL.md": "# Foo\nv1\n" } },
    ]);
    const dest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, dest, "main");
    const wr = await makeWorkingRepo();
    const install = await makeInstall(fx, dest, wr, fx.shas[0]!);
    const sr: SkillsRepo = {
      id: "src1", name: "src", gitUrl: fx.fileUrl, branch: "main",
      artifactPaths: { skills: ["ai/skills"] }, presetId: null,
      localClonePath: dest, lastFetchedAt: null,
    };
    const result = await checkForDrift(install, sr, wr.path);
    expect(result.isDrifted).toBe(false);
    expect(result.driftedFiles).toHaveLength(0);
  });

  it("returns isDrifted=true with drifted file listed when working-repo file is modified", async () => {
    const fx = await buildFixtureRepo([
      { message: "v1", files: { "ai/skills/foo/SKILL.md": "# Foo\nv1\n" } },
    ]);
    const dest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, dest, "main");
    const wr = await makeWorkingRepo();
    const install = await makeInstall(fx, dest, wr, fx.shas[0]!);
    // Mutate the installed file
    const targetAbs = path.join(wr.path, ".claude/skills/foo/SKILL.md");
    await writeFile(targetAbs, "# Foo\nmodified!\n", "utf8");
    const sr: SkillsRepo = {
      id: "src1", name: "src", gitUrl: fx.fileUrl, branch: "main",
      artifactPaths: { skills: ["ai/skills"] }, presetId: null,
      localClonePath: dest, lastFetchedAt: null,
    };
    const result = await checkForDrift(install, sr, wr.path);
    expect(result.isDrifted).toBe(true);
    expect(result.driftedFiles).toHaveLength(1);
    expect(result.driftedFiles[0]!.sourcePath).toBe("ai/skills/foo/SKILL.md");
  });

  it("returns isDrifted=true when an installed file is deleted from the working repo", async () => {
    const fx = await buildFixtureRepo([
      { message: "v1", files: { "ai/skills/foo/SKILL.md": "# Foo\nv1\n" } },
    ]);
    const dest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, dest, "main");
    const wr = await makeWorkingRepo();
    const install = await makeInstall(fx, dest, wr, fx.shas[0]!);
    const { rm } = await import("node:fs/promises");
    await rm(path.join(wr.path, ".claude/skills/foo/SKILL.md"), { force: true });
    const sr: SkillsRepo = {
      id: "src1", name: "src", gitUrl: fx.fileUrl, branch: "main",
      artifactPaths: { skills: ["ai/skills"] }, presetId: null,
      localClonePath: dest, lastFetchedAt: null,
    };
    const result = await checkForDrift(install, sr, wr.path);
    expect(result.isDrifted).toBe(true);
  });
});
```

- [ ] **Step 3.2: Run to confirm failure**

```bash
npx vitest run tests/integration/update-drift.test.ts --reporter=verbose 2>&1 | grep -E "PASS|FAIL|Error"
```

Expected: FAIL — `checkForDrift` not found.

- [ ] **Step 3.3: Create `src/engine/drift-check.ts`**

```typescript
import { readFile } from "node:fs/promises";
import path from "node:path";
import { readFileAtSha } from "../git/show";
import type { Install, SkillsRepo } from "../state/schema";

export interface DriftedFile {
  sourcePath: string;
  targetPath: string;
}

export interface DriftCheckResult {
  isDrifted: boolean;
  driftedFiles: DriftedFile[];
}

export async function checkForDrift(
  install: Install,
  skillsRepo: SkillsRepo,
  workingRepoPath: string,
): Promise<DriftCheckResult> {
  const driftedFiles: DriftedFile[] = [];
  for (const { sourcePath, targetPath } of install.installedFiles) {
    const sourceContent = await readFileAtSha(
      skillsRepo.localClonePath,
      install.installedCommitSha,
      sourcePath,
    );
    const targetAbs = path.join(workingRepoPath, targetPath);
    let targetContent: string;
    try {
      targetContent = await readFile(targetAbs, "utf8");
    } catch {
      driftedFiles.push({ sourcePath, targetPath });
      continue;
    }
    if (sourceContent !== targetContent) {
      driftedFiles.push({ sourcePath, targetPath });
    }
  }
  return { isDrifted: driftedFiles.length > 0, driftedFiles };
}
```

- [ ] **Step 3.4: Run tests**

```bash
npx vitest run tests/integration/update-drift.test.ts --reporter=verbose 2>&1 | grep -E "✓|✗|PASS|FAIL"
```

Expected: All `checkForUpdates` and `checkForDrift` tests pass.

- [ ] **Step 3.5: Commit**

```bash
git add src/engine/drift-check.ts tests/integration/update-drift.test.ts
git commit -m "feat(engine): add drift detection — checkForDrift"
```

---

## Task 4: Create `src/engine/status.ts`

**Files:**
- Create: `src/engine/status.ts`
- Create: `tests/unit/status.test.ts`

- [ ] **Step 4.1: Write the unit tests**

Create `tests/unit/status.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeInstallStatus } from "../../src/engine/status.ts";

describe("computeInstallStatus", () => {
  it("returns up-to-date when no update and no drift", () => {
    expect(computeInstallStatus(false, false)).toBe("up-to-date");
  });
  it("returns update-available when update exists and no drift", () => {
    expect(computeInstallStatus(true, false)).toBe("update-available");
  });
  it("returns drifted when no update and drift exists", () => {
    expect(computeInstallStatus(false, true)).toBe("drifted");
  });
  it("returns update-available+drifted when both are true", () => {
    expect(computeInstallStatus(true, true)).toBe("update-available+drifted");
  });
});
```

- [ ] **Step 4.2: Run to confirm failure**

```bash
npx vitest run tests/unit/status.test.ts
```

Expected: FAIL — `computeInstallStatus` not found.

- [ ] **Step 4.3: Create `src/engine/status.ts`**

```typescript
export type InstallStatus =
  | "up-to-date"
  | "update-available"
  | "drifted"
  | "update-available+drifted";

export function computeInstallStatus(hasUpdate: boolean, isDrifted: boolean): InstallStatus {
  if (hasUpdate && isDrifted) return "update-available+drifted";
  if (hasUpdate) return "update-available";
  if (isDrifted) return "drifted";
  return "up-to-date";
}
```

- [ ] **Step 4.4: Run tests**

```bash
npx vitest run tests/unit/status.test.ts
```

Expected: All 4 tests PASS.

- [ ] **Step 4.5: Commit**

```bash
git add src/engine/status.ts tests/unit/status.test.ts
git commit -m "feat(engine): add computeInstallStatus pure function"
```

---

## Task 5: Add `artifactType` to schema and `update()` to InstallsStore

**Files:**
- Modify: `src/state/schema.ts`
- Modify: `src/state/installs.ts`
- Test: `tests/integration/state.test.ts` (extend with update() test)

- [ ] **Step 5.1: Read `tests/integration/state.test.ts` to understand existing coverage**

```bash
cat -n tests/integration/state.test.ts
```

- [ ] **Step 5.2: Write the failing test for `InstallsStore.update()`**

Append to `tests/integration/state.test.ts`:

```typescript
import { InstallsStore } from "../../src/state/installs.ts";
// (already imported if existing; just add the describe block)

describe("InstallsStore.update()", () => {
  it("updates fields on an existing install record", async () => {
    const dir = await tmpDir("skillmgr-state-");
    const store = new InstallsStore(dir);
    const record = await store.add({
      artifactKey: "src1:ai/skills/foo",
      sourceRepoId: "src1",
      target: { type: "global" },
      agent: "claude-code",
      artifactType: "skills",
      installedCommitSha: "abc123",
      autoUpdate: false,
      installedFiles: [],
      installedAt: new Date().toISOString(),
    });
    const updated = await store.update(record.id, { autoUpdate: true, installedCommitSha: "def456" });
    expect(updated.autoUpdate).toBe(true);
    expect(updated.installedCommitSha).toBe("def456");

    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0]!.autoUpdate).toBe(true);
  });

  it("defaults artifactType to 'skills' for records missing the field (backward compat)", async () => {
    const dir = await tmpDir("skillmgr-state-");
    // Write a raw record without artifactType to simulate old installs.json
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const raw = JSON.stringify([{
      id: "old1", artifactKey: "s:a/b", sourceRepoId: "s",
      target: { type: "global" }, agent: "claude-code",
      installedCommitSha: "aaa", autoUpdate: false,
      installedFiles: [], installedAt: "2024-01-01T00:00:00.000Z",
    }]);
    await writeFile(join(dir, "installs.json"), raw, "utf8");
    const store = new InstallsStore(dir);
    const all = await store.list();
    expect(all[0]!.artifactType).toBe("skills");
  });
});
```

- [ ] **Step 5.3: Run to confirm failure**

```bash
npx vitest run tests/integration/state.test.ts
```

Expected: FAIL — `artifactType` not in schema / `update` not a method.

- [ ] **Step 5.4: Add `artifactType` to `Install` in `src/state/schema.ts`**

Replace the `Install` interface (the whole interface):

```typescript
export interface Install {
  id: string;
  artifactKey: string;
  sourceRepoId: string;
  target: InstallTarget;
  agent: AgentId;
  artifactType: ArtifactTypeId;
  installedCommitSha: string;
  autoUpdate: boolean;
  installedFiles: InstalledFile[];
  installedAt: string;
}
```

- [ ] **Step 5.5: Update `src/state/installs.ts` — add `update()` + backward-compat migration**

Replace the full file content:

```typescript
import path from "node:path";
import { JsonStore } from "./store";
import type { Install, ArtifactTypeId } from "./schema";
import { newId } from "../util/ids";

export class InstallsStore {
  private store: JsonStore<Install[]>;
  constructor(stateDir: string) {
    this.store = new JsonStore<Install[]>(path.join(stateDir, "installs.json"), []);
  }
  async list(): Promise<Install[]> {
    const raw = (await this.store.read()) as Array<Install & { artifactType?: ArtifactTypeId }>;
    return raw.map((i) => ({
      ...i,
      artifactType: i.artifactType ?? "skills",
    }));
  }
  async get(id: string): Promise<Install | undefined> {
    return (await this.list()).find((i) => i.id === id);
  }
  async listByWorkingRepo(workingRepoId: string): Promise<Install[]> {
    return (await this.list()).filter(
      (i) => i.target.type === "working-repo" && i.target.workingRepoId === workingRepoId,
    );
  }
  async findExisting(
    artifactKey: string,
    target: Install["target"],
    agent: Install["agent"],
  ): Promise<Install | undefined> {
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
  async update(id: string, patch: Partial<Omit<Install, "id">>): Promise<Install> {
    const list = await this.list();
    const idx = list.findIndex((i) => i.id === id);
    if (idx === -1) throw new Error(`install not found: ${id}`);
    const updated = { ...list[idx]!, ...patch };
    list[idx] = updated;
    await this.store.write(list);
    return updated;
  }
  async remove(id: string): Promise<void> {
    const list = await this.list();
    await this.store.write(list.filter((i) => i.id !== id));
  }
}
```

- [ ] **Step 5.6: Run tests**

```bash
npx vitest run tests/integration/state.test.ts
```

Expected: All tests PASS. (The `update()` test and backward-compat test should now pass.)

- [ ] **Step 5.7: Commit**

```bash
git add src/state/schema.ts src/state/installs.ts tests/integration/state.test.ts
git commit -m "feat(state): add artifactType to Install schema; add InstallsStore.update()"
```

---

## Task 6: Update `src/engine/install.ts` to include `artifactType`

**Files:**
- Modify: `src/engine/install.ts`

The `installArtifact` function receives `artifact.type` via the `args.artifact` parameter. We need to pass it through to the returned draft record.

- [ ] **Step 6.1: Read current `src/engine/install.ts` to locate the return statement**

The `record` object at line 66–76 is what needs updating.

- [ ] **Step 6.2: Add `artifactType` to the draft record**

In `src/engine/install.ts`, replace the `record` construction (lines 66–76):

```typescript
  const record: Omit<Install, "id"> = {
    artifactKey: artifact.artifactKey,
    sourceRepoId: skillsRepo.id,
    target,
    agent: agent.id,
    artifactType: artifact.type,
    installedCommitSha: sha,
    autoUpdate,
    installedFiles,
    installedAt: new Date().toISOString(),
  };
```

- [ ] **Step 6.3: Run the existing install tests to verify no regression**

```bash
npx vitest run tests/integration/install.test.ts tests/integration/api.test.ts
```

Expected: All PASS. (The new `artifactType` field is now present in records; existing tests check other fields and won't break.)

- [ ] **Step 6.4: Commit**

```bash
git add src/engine/install.ts
git commit -m "feat(engine): include artifactType in install draft record"
```

---

## Task 7: Create `src/engine/apply-update.ts`

**Files:**
- Create: `src/engine/apply-update.ts`
- Test: `tests/integration/update-drift.test.ts` (add apply-update describe)

- [ ] **Step 7.1: Add apply-update test to `tests/integration/update-drift.test.ts`**

Append to the test file:

```typescript
describe("applyUpdate", () => {
  it("overwrites installed files with content from the new SHA and returns updated record fields", async () => {
    const fx = await buildFixtureRepo([
      { message: "v1", files: { "ai/skills/foo/SKILL.md": "# Foo\nv1\n" } },
      { message: "v2", files: { "ai/skills/foo/SKILL.md": "# Foo\nv2\n", "ai/skills/foo/extra.md": "new file\n" } },
    ]);
    const dest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, dest, "main");
    const wr = await makeWorkingRepo();
    const install = await makeInstall(fx, dest, wr, fx.shas[0]!, false);
    const { agents } = buildRegistries();
    const sr: SkillsRepo = {
      id: "src1", name: "src", gitUrl: fx.fileUrl, branch: "main",
      artifactPaths: { skills: ["ai/skills"] }, presetId: null,
      localClonePath: dest, lastFetchedAt: null,
    };
    const patch = await applyUpdate({
      install,
      skillsRepo: sr,
      workingRepo: wr,
      newSha: fx.shas[1]!,
      agent: agents.get("claude-code"),
      otherInstallsInTarget: [],
    });
    expect(patch.installedCommitSha).toBe(fx.shas[1]);
    expect(patch.installedFiles).toHaveLength(2);
    const content = await readFile(path.join(wr.path, ".claude/skills/foo/SKILL.md"), "utf8");
    expect(content).toBe("# Foo\nv2\n");
    const extra = await readFile(path.join(wr.path, ".claude/skills/foo/extra.md"), "utf8");
    expect(extra).toBe("new file\n");
  });

  it("removes files that were deleted in the new version", async () => {
    const fx = await buildFixtureRepo([
      { message: "v1", files: { "ai/skills/foo/SKILL.md": "# Foo\nv1\n", "ai/skills/foo/old.md": "old\n" } },
      { message: "v2 removes old.md", files: { "ai/skills/foo/SKILL.md": "# Foo\nv2\n" }, deletes: ["ai/skills/foo/old.md"] },
    ]);
    const dest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, dest, "main");
    const wr = await makeWorkingRepo();
    const install = await makeInstall(fx, dest, wr, fx.shas[0]!, false);
    const { agents } = buildRegistries();
    const sr: SkillsRepo = {
      id: "src1", name: "src", gitUrl: fx.fileUrl, branch: "main",
      artifactPaths: { skills: ["ai/skills"] }, presetId: null,
      localClonePath: dest, lastFetchedAt: null,
    };
    await applyUpdate({
      install, skillsRepo: sr, workingRepo: wr,
      newSha: fx.shas[1]!, agent: agents.get("claude-code"),
      otherInstallsInTarget: [],
    });
    const { existsSync } = await import("node:fs");
    expect(existsSync(path.join(wr.path, ".claude/skills/foo/old.md"))).toBe(false);
    expect(existsSync(path.join(wr.path, ".claude/skills/foo/SKILL.md"))).toBe(true);
  });
});
```

- [ ] **Step 7.2: Run to confirm failure**

```bash
npx vitest run tests/integration/update-drift.test.ts --reporter=verbose 2>&1 | grep -E "applyUpdate|Error" | head -10
```

Expected: FAIL — `applyUpdate` not found.

- [ ] **Step 7.3: Create `src/engine/apply-update.ts`**

```typescript
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { readFileAtSha, listFilesAtSha } from "../git/show";
import { writeExcludeBlock } from "./exclude-block";
import { computeExcludePatterns } from "./install";
import { AppError } from "../util/errors";
import type { AgentAdapter } from "../adapters/types";
import type { Install, InstalledFile, SkillsRepo, WorkingRepo } from "../state/schema";

export async function applyUpdate(args: {
  install: Install;
  skillsRepo: SkillsRepo;
  workingRepo: WorkingRepo;
  newSha: string;
  agent: AgentAdapter;
  otherInstallsInTarget: Array<Pick<Install, "installedFiles">>;
}): Promise<Pick<Install, "installedCommitSha" | "installedFiles">> {
  const { install, skillsRepo, workingRepo, newSha, agent, otherInstallsInTarget } = args;

  const rootRelativePath = install.artifactKey.split(":", 2)[1]!;
  const artifactName = rootRelativePath.split("/").pop()!;
  const targetRoot = agent.targetRoot({
    scope: "working-repo",
    workingRepoPath: workingRepo.path,
    type: install.artifactType,
    name: artifactName,
  });

  // Remove all currently installed files
  for (const { targetPath } of install.installedFiles) {
    await rm(path.join(workingRepo.path, targetPath), { force: true });
  }

  // List source files at the new SHA
  const newSourceFiles = await listFilesAtSha(skillsRepo.localClonePath, newSha, rootRelativePath);

  const newInstalledFiles: InstalledFile[] = [];
  const writtenPaths: string[] = [];
  try {
    for (const sourcePath of newSourceFiles) {
      const relativeToArtifact = sourcePath.slice(rootRelativePath.length + 1);
      const mapped = agent.mapFileName(relativeToArtifact);
      const targetAbs = path.join(targetRoot, mapped);
      const targetRel = path.relative(workingRepo.path, targetAbs).replace(/\\/g, "/");
      const content = await readFileAtSha(skillsRepo.localClonePath, newSha, sourcePath);
      await mkdir(path.dirname(targetAbs), { recursive: true });
      await writeFile(targetAbs, content, "utf8");
      writtenPaths.push(targetAbs);
      newInstalledFiles.push({ sourcePath, targetPath: targetRel });
    }
    const patterns = computeExcludePatterns([
      ...otherInstallsInTarget,
      { installedFiles: newInstalledFiles },
    ]);
    const excludePath = path.join(workingRepo.path, ".git", "info", "exclude");
    await writeExcludeBlock(excludePath, patterns);
  } catch (err) {
    for (const p of writtenPaths) await rm(p, { force: true });
    throw new AppError("io_error", `apply-update failed: ${(err as Error).message}`);
  }

  return { installedCommitSha: newSha, installedFiles: newInstalledFiles };
}
```

- [ ] **Step 7.4: Run tests**

```bash
npx vitest run tests/integration/update-drift.test.ts --reporter=verbose 2>&1 | grep -E "✓|✗|PASS|FAIL"
```

Expected: All tests up to and including `applyUpdate` PASS.

- [ ] **Step 7.5: Commit**

```bash
git add src/engine/apply-update.ts tests/integration/update-drift.test.ts
git commit -m "feat(engine): add applyUpdate — re-write install files at a new SHA"
```

---

## Task 8: Create `src/engine/update-pass.ts`

**Files:**
- Create: `src/engine/update-pass.ts`
- Test: `tests/integration/update-drift.test.ts` (add auto-update pass describe)

- [ ] **Step 8.1: Add auto-update pass tests to `tests/integration/update-drift.test.ts`**

Append to the test file:

```typescript
describe("runAutoUpdatePass", () => {
  it("auto-updates a non-drifted install and records new SHA", async () => {
    const fx = await buildFixtureRepo([
      { message: "v1", files: { "ai/skills/foo/SKILL.md": "# Foo\nv1\n" } },
      { message: "v2", files: { "ai/skills/foo/SKILL.md": "# Foo\nv2\n" } },
    ]);
    const dest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, dest, "main");
    const stateDir = await tmpDir("skillmgr-pass-");
    const wr = await makeWorkingRepo();
    const { agents, types } = buildRegistries();
    const srData: SkillsRepo = {
      id: "src1", name: "src", gitUrl: fx.fileUrl, branch: "main",
      artifactPaths: { skills: ["ai/skills"] }, presetId: null,
      localClonePath: dest, lastFetchedAt: null,
    };
    const srStore = new SkillsRepoStore(stateDir);
    await srStore.add(srData);
    const wrStore = new WorkingRepoStore(stateDir);
    await wrStore.add({ name: wr.name, path: wr.path, addedAt: wr.addedAt });
    const installsStore = new InstallsStore(stateDir);
    const artifacts = await discoverArtifacts(srData, types);
    const foo = artifacts.find((a) => a.name === "foo")!;
    const draft = await installArtifact({
      artifact: foo, skillsRepo: srData,
      target: { type: "working-repo", workingRepoId: (await wrStore.list())[0]!.id },
      workingRepo: (await wrStore.list())[0]!,
      agent: agents.get("claude-code"),
      sha: fx.shas[0]!,
      autoUpdate: true,
      existingInstallsInTarget: [],
    });
    const persisted = await installsStore.add(draft);

    await runAutoUpdatePass({
      installs: installsStore,
      skillsRepos: srStore,
      workingRepos: wrStore,
      registries: { agents },
    });

    const updated = await installsStore.get(persisted.id);
    expect(updated!.installedCommitSha).toBe(fx.shas[1]);
    const content = await readFile(path.join(wr.path, ".claude/skills/foo/SKILL.md"), "utf8");
    expect(content).toBe("# Foo\nv2\n");
  });

  it("skips auto-update when the install is drifted, leaving it update-available+drifted", async () => {
    const fx = await buildFixtureRepo([
      { message: "v1", files: { "ai/skills/foo/SKILL.md": "# Foo\nv1\n" } },
      { message: "v2", files: { "ai/skills/foo/SKILL.md": "# Foo\nv2\n" } },
    ]);
    const dest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, dest, "main");
    const stateDir = await tmpDir("skillmgr-pass-");
    const wr = await makeWorkingRepo();
    const { agents, types } = buildRegistries();
    const srData: SkillsRepo = {
      id: "src1", name: "src", gitUrl: fx.fileUrl, branch: "main",
      artifactPaths: { skills: ["ai/skills"] }, presetId: null,
      localClonePath: dest, lastFetchedAt: null,
    };
    const srStore = new SkillsRepoStore(stateDir);
    await srStore.add(srData);
    const wrStore = new WorkingRepoStore(stateDir);
    await wrStore.add({ name: wr.name, path: wr.path, addedAt: wr.addedAt });
    const installsStore = new InstallsStore(stateDir);
    const artifacts = await discoverArtifacts(srData, types);
    const foo = artifacts.find((a) => a.name === "foo")!;
    const draft = await installArtifact({
      artifact: foo, skillsRepo: srData,
      target: { type: "working-repo", workingRepoId: (await wrStore.list())[0]!.id },
      workingRepo: (await wrStore.list())[0]!,
      agent: agents.get("claude-code"),
      sha: fx.shas[0]!, autoUpdate: true,
      existingInstallsInTarget: [],
    });
    const persisted = await installsStore.add(draft);

    // Drift the working-repo file
    await writeFile(path.join(wr.path, ".claude/skills/foo/SKILL.md"), "locally modified\n", "utf8");

    await runAutoUpdatePass({
      installs: installsStore,
      skillsRepos: srStore,
      workingRepos: wrStore,
      registries: { agents },
    });

    // SHA should be unchanged — auto-update was gated
    const after = await installsStore.get(persisted.id);
    expect(after!.installedCommitSha).toBe(fx.shas[0]);
    // Working-repo file should still be the drifted version
    const content = await readFile(path.join(wr.path, ".claude/skills/foo/SKILL.md"), "utf8");
    expect(content).toBe("locally modified\n");
  });

  it("skips installs with autoUpdate=false", async () => {
    const fx = await buildFixtureRepo([
      { message: "v1", files: { "ai/skills/foo/SKILL.md": "v1\n" } },
      { message: "v2", files: { "ai/skills/foo/SKILL.md": "v2\n" } },
    ]);
    const dest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, dest, "main");
    const stateDir = await tmpDir("skillmgr-pass-");
    const wr = await makeWorkingRepo();
    const { agents, types } = buildRegistries();
    const srData: SkillsRepo = {
      id: "src1", name: "src", gitUrl: fx.fileUrl, branch: "main",
      artifactPaths: { skills: ["ai/skills"] }, presetId: null,
      localClonePath: dest, lastFetchedAt: null,
    };
    const srStore = new SkillsRepoStore(stateDir);
    await srStore.add(srData);
    const wrStore = new WorkingRepoStore(stateDir);
    await wrStore.add({ name: wr.name, path: wr.path, addedAt: wr.addedAt });
    const installsStore = new InstallsStore(stateDir);
    const artifacts = await discoverArtifacts(srData, types);
    const foo = artifacts.find((a) => a.name === "foo")!;
    const draft = await installArtifact({
      artifact: foo, skillsRepo: srData,
      target: { type: "working-repo", workingRepoId: (await wrStore.list())[0]!.id },
      workingRepo: (await wrStore.list())[0]!,
      agent: agents.get("claude-code"),
      sha: fx.shas[0]!, autoUpdate: false,
      existingInstallsInTarget: [],
    });
    const persisted = await installsStore.add(draft);

    await runAutoUpdatePass({
      installs: installsStore,
      skillsRepos: srStore,
      workingRepos: wrStore,
      registries: { agents },
    });

    const after = await installsStore.get(persisted.id);
    expect(after!.installedCommitSha).toBe(fx.shas[0]);
  });
});
```

- [ ] **Step 8.2: Run to confirm failure**

```bash
npx vitest run tests/integration/update-drift.test.ts --reporter=verbose 2>&1 | grep "runAutoUpdatePass" | head -5
```

Expected: FAIL — `runAutoUpdatePass` not found.

- [ ] **Step 8.3: Create `src/engine/update-pass.ts`**

```typescript
import { checkForUpdates } from "./update-check";
import { checkForDrift } from "./drift-check";
import { applyUpdate } from "./apply-update";
import type { InstallsStore } from "../state/installs";
import type { SkillsRepoStore } from "../state/skills-repos";
import type { WorkingRepoStore } from "../state/working-repos";
import type { AgentRegistry } from "../adapters/registry";

export interface AutoUpdatePassDeps {
  installs: InstallsStore;
  skillsRepos: SkillsRepoStore;
  workingRepos: WorkingRepoStore;
  registries: { agents: AgentRegistry };
}

export async function runAutoUpdatePass(deps: AutoUpdatePassDeps): Promise<void> {
  const allInstalls = await deps.installs.list();
  const allRepos = await deps.skillsRepos.list();
  const allWrs = await deps.workingRepos.list();
  const reposById = new Map(allRepos.map((r) => [r.id, r]));
  const wrsById = new Map(allWrs.map((w) => [w.id, w]));

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
    const patch = await applyUpdate({
      install, skillsRepo: sr, workingRepo: wr,
      newSha: updateResult.availableSha, agent,
      otherInstallsInTarget: others,
    });
    await deps.installs.update(install.id, patch);
  }
}
```

- [ ] **Step 8.4: Run all update-drift tests**

```bash
npx vitest run tests/integration/update-drift.test.ts --reporter=verbose
```

Expected: All tests PASS.

- [ ] **Step 8.5: Run the full test suite to check for regressions**

```bash
npx vitest run
```

Expected: All tests PASS.

- [ ] **Step 8.6: Commit**

```bash
git add src/engine/update-pass.ts tests/integration/update-drift.test.ts
git commit -m "feat(engine): add runAutoUpdatePass batch orchestrator"
```

---

## Task 9: Extend `src/api/installs.ts` — status on GET, PATCH, POST update

**Files:**
- Modify: `src/api/installs.ts`
- Test: `tests/integration/api.test.ts` (add new describe block)

- [ ] **Step 9.1: Add API tests to `tests/integration/api.test.ts`**

Append to `tests/integration/api.test.ts`:

```typescript
describe("API /installs — status, PATCH auto-update, POST update", () => {
  async function setup() {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const fx = await buildFixtureRepo([
      { message: "v1", files: { "ai/skills/foo/SKILL.md": "# Foo\nv1\n" } },
      { message: "v2", files: { "ai/skills/foo/SKILL.md": "# Foo\nv2\n" } },
    ]);
    const src = (await app.inject({
      method: "POST", url: "/api/skills-repos",
      payload: { name: "src", gitUrl: fx.fileUrl, branch: "main", artifactPaths: { skills: ["ai/skills"] } },
    })).json();
    const wrPath = await tmpDir("skillmgr-wr-");
    await simpleGit(wrPath).init();
    await simpleGit(wrPath).addConfig("user.email", "a@b").addConfig("user.name", "t");
    await simpleGit(wrPath).commit("seed", [], { "--allow-empty": null });
    const wr = (await app.inject({
      method: "POST", url: "/api/working-repos",
      payload: { name: "w", path: wrPath },
    })).json();
    // Install at v1 SHA
    const arts = (await app.inject({ method: "GET", url: "/api/artifacts" })).json();
    const foo = arts.find((a: { name: string }) => a.name === "foo");
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
    return { deps, app, fx, src, wr, install, wrPath };
  }

  it("GET installs returns status field", async () => {
    const { app, wr, fx } = await setup();
    const list = await app.inject({ method: "GET", url: `/api/working-repos/${wr.id}/installs` });
    expect(list.statusCode).toBe(200);
    const installs = list.json();
    expect(installs).toHaveLength(1);
    // Installed at v1, HEAD is v2 → update-available
    expect(installs[0].status).toBe("update-available");
    expect(installs[0].availableSha).toBe(fx.shas[1]);
  });

  it("PATCH /api/installs/:id toggles autoUpdate", async () => {
    const { app, install } = await setup();
    const patched = await app.inject({
      method: "PATCH", url: `/api/installs/${install.id}`,
      payload: { autoUpdate: true },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().autoUpdate).toBe(true);
  });

  it("PATCH /api/installs/:id returns 400 for missing autoUpdate field", async () => {
    const { app, install } = await setup();
    const res = await app.inject({
      method: "PATCH", url: `/api/installs/${install.id}`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("bad_input");
  });

  it("POST /api/installs/:id/update applies available update and returns updated install", async () => {
    const { app, install, fx, wrPath } = await setup();
    const res = await app.inject({ method: "POST", url: `/api/installs/${install.id}/update` });
    expect(res.statusCode).toBe(200);
    const updated = res.json();
    expect(updated.installedCommitSha).toBe(fx.shas[1]);
    // File should be updated to v2 content
    const { readFile } = await import("node:fs/promises");
    const content = await readFile(`${wrPath}/.claude/skills/foo/SKILL.md`, "utf8");
    expect(content).toBe("# Foo\nv2\n");
  });

  it("POST /api/installs/:id/update returns 400 when no update is available", async () => {
    const fx2 = await buildFixtureRepo([
      { message: "v1", files: { "ai/skills/bar/SKILL.md": "# Bar\n" } },
    ]);
    const deps2 = await makeDeps();
    const app2 = await buildServer(deps2);
    await app2.inject({
      method: "POST", url: "/api/skills-repos",
      payload: { name: "s", gitUrl: fx2.fileUrl, branch: "main", artifactPaths: { skills: ["ai/skills"] } },
    });
    const wrPath2 = await tmpDir("skillmgr-wr-");
    await simpleGit(wrPath2).init();
    await simpleGit(wrPath2).addConfig("user.email", "a@b").addConfig("user.name", "t");
    await simpleGit(wrPath2).commit("seed", [], { "--allow-empty": null });
    const wr2 = (await app2.inject({ method: "POST", url: "/api/working-repos", payload: { name: "w", path: wrPath2 } })).json();
    const arts2 = (await app2.inject({ method: "GET", url: "/api/artifacts" })).json();
    const bar = arts2.find((a: { name: string }) => a.name === "bar");
    const inst2 = (await app2.inject({
      method: "POST", url: "/api/installs",
      payload: { artifactKey: bar.artifactKey, target: { type: "working-repo", workingRepoId: wr2.id }, autoUpdate: false },
    })).json();
    const res2 = await app2.inject({ method: "POST", url: `/api/installs/${inst2.id}/update` });
    expect(res2.statusCode).toBe(400);
    expect(res2.json().code).toBe("bad_input");
  });
});
```

- [ ] **Step 9.2: Run to confirm failures**

```bash
npx vitest run tests/integration/api.test.ts --reporter=verbose 2>&1 | grep -E "✓|✗|FAIL|GET installs|PATCH|POST.*update"
```

Expected: New tests FAIL (routes don't exist yet).

- [ ] **Step 9.3: Replace `src/api/installs.ts` with the extended version**

```typescript
import type { FastifyInstance } from "fastify";
import type { ServerDeps } from "../server";
import { installArtifact } from "../engine/install";
import { uninstallArtifact } from "../engine/uninstall";
import { applyUpdate } from "../engine/apply-update";
import { checkForUpdates } from "../engine/update-check";
import { checkForDrift } from "../engine/drift-check";
import { computeInstallStatus } from "../engine/status";
import { discoverArtifacts } from "../discovery/discover";
import { AppError } from "../util/errors";
import type { AgentId, Install, InstallTarget } from "../state/schema";

interface CreateBody {
  artifactKey: string;
  target: InstallTarget;
  agent?: AgentId;
  sha?: string;
  autoUpdate?: boolean;
}

interface PatchBody {
  autoUpdate?: boolean;
}

async function computeStatusForInstalls(
  installs: Install[],
  deps: ServerDeps,
  workingRepoPath: string,
) {
  const allRepos = await deps.skillsRepos.list();
  const reposById = new Map(allRepos.map((r) => [r.id, r]));
  return Promise.all(
    installs.map(async (install) => {
      const sr = reposById.get(install.sourceRepoId);
      if (!sr) return { ...install, status: "up-to-date" as const, availableSha: null };
      const updateResult = await checkForUpdates(install, sr);
      const driftResult = await checkForDrift(install, sr, workingRepoPath);
      const status = computeInstallStatus(updateResult.hasUpdate, driftResult.isDrifted);
      return { ...install, status, availableSha: updateResult.availableSha };
    }),
  );
}

export async function registerInstallsRoutes(app: FastifyInstance, deps: ServerDeps): Promise<void> {
  app.get<{ Params: { id: string } }>("/api/working-repos/:id/installs", async (req, reply) => {
    const wr = await deps.workingRepos.get(req.params.id);
    if (!wr) return reply.code(404).send({ code: "working_repo_not_found" });
    const installs = await deps.installs.listByWorkingRepo(wr.id);
    return computeStatusForInstalls(installs, deps, wr.path);
  });

  app.post<{ Body: CreateBody }>("/api/installs", async (req, reply) => {
    const body = req.body ?? ({} as CreateBody);
    if (!body.artifactKey || !body.target) throw new AppError("bad_input", "artifactKey and target required");
    const settings = await deps.settings.read();
    const agentId = body.agent ?? settings.favoriteAgent;
    let agent;
    try {
      agent = deps.registries.agents.get(agentId);
    } catch {
      throw new AppError("bad_input", `unknown agent: ${agentId}`);
    }
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

  app.patch<{ Params: { id: string }; Body: PatchBody }>("/api/installs/:id", async (req, reply) => {
    const install = await deps.installs.get(req.params.id);
    if (!install) return reply.code(404).send({ code: "install_not_found" });
    const body = req.body ?? ({} as PatchBody);
    if (typeof body.autoUpdate !== "boolean") {
      throw new AppError("bad_input", "autoUpdate (boolean) required");
    }
    const updated = await deps.installs.update(install.id, { autoUpdate: body.autoUpdate });
    return updated;
  });

  app.post<{ Params: { id: string } }>("/api/installs/:id/update", async (req, reply) => {
    const install = await deps.installs.get(req.params.id);
    if (!install) return reply.code(404).send({ code: "install_not_found" });
    if (install.target.type !== "working-repo") {
      throw new AppError("bad_input", "update only supported for working-repo targets");
    }
    const sr = await deps.skillsRepos.get(install.sourceRepoId);
    if (!sr) throw new AppError("skills_repo_not_found", install.sourceRepoId);
    const wr = await deps.workingRepos.get(install.target.workingRepoId);
    if (!wr) throw new AppError("working_repo_not_found", install.target.workingRepoId);
    const updateResult = await checkForUpdates(install, sr);
    if (!updateResult.hasUpdate || !updateResult.availableSha) {
      throw new AppError("bad_input", "no update available for this install");
    }
    const agent = deps.registries.agents.get(install.agent);
    const others = (await deps.installs.listByWorkingRepo(wr.id)).filter((i) => i.id !== install.id);
    const patch = await applyUpdate({
      install, skillsRepo: sr, workingRepo: wr,
      newSha: updateResult.availableSha, agent,
      otherInstallsInTarget: others,
    });
    const updated = await deps.installs.update(install.id, patch);
    return updated;
  });

  app.delete<{ Params: { id: string } }>("/api/installs/:id", async (req, reply) => {
    const install = await deps.installs.get(req.params.id);
    if (!install) return reply.code(404).send({ code: "install_not_found" });
    let workingRepo;
    let remaining: Awaited<ReturnType<typeof deps.installs.list>> = [];
    if (install.target.type === "working-repo") {
      workingRepo = await deps.workingRepos.get(install.target.workingRepoId);
      remaining = (await deps.installs.listByWorkingRepo(install.target.workingRepoId)).filter(
        (i) => i.id !== install.id,
      );
    }
    try {
      await uninstallArtifact({ install, workingRepo, remainingInstallsInTarget: remaining });
    } finally {
      await deps.installs.remove(install.id);
    }
    return reply.code(204).send();
  });
}
```

- [ ] **Step 9.4: Add `install_not_found` to the error handler in `src/api/routes.ts`**

In `src/api/routes.ts`, the error handler maps codes to status codes. Add `install_not_found → 404`:

```typescript
      err.code === "install_not_found" ? 404 :
```

Place it after `"working_repo_not_found" ? 404 :`.

- [ ] **Step 9.5: Run all API tests**

```bash
npx vitest run tests/integration/api.test.ts --reporter=verbose
```

Expected: All tests PASS, including the new status/PATCH/POST-update tests.

- [ ] **Step 9.6: Commit**

```bash
git add src/api/installs.ts src/api/routes.ts tests/integration/api.test.ts
git commit -m "feat(api): installs GET returns status; add PATCH auto-update toggle; add POST update"
```

---

## Task 10: Add `POST /api/working-repos/:id/refresh` endpoint

**Files:**
- Modify: `src/api/working-repos.ts`
- Test: `tests/integration/api.test.ts` (add describe block)

- [ ] **Step 10.1: Add working-repo refresh API tests to `tests/integration/api.test.ts`**

Append to the file:

```typescript
describe("API POST /working-repos/:id/refresh", () => {
  it("runs auto-update pass and returns installs with updated status", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const fx = await buildFixtureRepo([
      { message: "v1", files: { "ai/skills/foo/SKILL.md": "v1\n" } },
      { message: "v2", files: { "ai/skills/foo/SKILL.md": "v2\n" } },
    ]);
    await app.inject({
      method: "POST", url: "/api/skills-repos",
      payload: { name: "src", gitUrl: fx.fileUrl, branch: "main", artifactPaths: { skills: ["ai/skills"] } },
    });
    const wrPath = await tmpDir("skillmgr-wr-");
    await simpleGit(wrPath).init();
    await simpleGit(wrPath).addConfig("user.email", "a@b").addConfig("user.name", "t");
    await simpleGit(wrPath).commit("seed", [], { "--allow-empty": null });
    const wr = (await app.inject({
      method: "POST", url: "/api/working-repos",
      payload: { name: "w", path: wrPath },
    })).json();
    const arts = (await app.inject({ method: "GET", url: "/api/artifacts" })).json();
    const foo = arts.find((a: { name: string }) => a.name === "foo");
    // Install at v1 with autoUpdate=true
    await app.inject({
      method: "POST", url: "/api/installs",
      payload: {
        artifactKey: foo.artifactKey,
        target: { type: "working-repo", workingRepoId: wr.id },
        autoUpdate: true,
        sha: fx.shas[0],
      },
    });

    const res = await app.inject({ method: "POST", url: `/api/working-repos/${wr.id}/refresh` });
    expect(res.statusCode).toBe(200);
    const installs = res.json();
    expect(installs).toHaveLength(1);
    // Auto-update should have fired: SHA updated to v2
    expect(installs[0].installedCommitSha).toBe(fx.shas[1]);
    expect(installs[0].status).toBe("up-to-date");
  });

  it("returns 404 for unknown working repo", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const res = await app.inject({ method: "POST", url: "/api/working-repos/no-such-id/refresh" });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 10.2: Run to confirm failure**

```bash
npx vitest run tests/integration/api.test.ts --reporter=verbose 2>&1 | grep "working-repos.*refresh" | head -5
```

Expected: FAIL — route not found.

- [ ] **Step 10.3: Modify `src/api/working-repos.ts` to add the refresh endpoint**

Replace the full file content:

```typescript
import type { FastifyInstance } from "fastify";
import type { ServerDeps } from "../server";
import { existsSync } from "node:fs";
import path from "node:path";
import { AppError } from "../util/errors";
import { runAutoUpdatePass } from "../engine/update-pass";
import { checkForUpdates } from "../engine/update-check";
import { checkForDrift } from "../engine/drift-check";
import { computeInstallStatus } from "../engine/status";
import type { Install } from "../state/schema";

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

  app.post<{ Params: { id: string } }>("/api/working-repos/:id/refresh", async (req, reply) => {
    const wr = await deps.workingRepos.get(req.params.id);
    if (!wr) return reply.code(404).send({ code: "working_repo_not_found" });

    await runAutoUpdatePass({
      installs: deps.installs,
      skillsRepos: deps.skillsRepos,
      workingRepos: deps.workingRepos,
      registries: deps.registries,
    });

    const allRepos = await deps.skillsRepos.list();
    const reposById = new Map(allRepos.map((r) => [r.id, r]));
    const installs = await deps.installs.listByWorkingRepo(wr.id);
    const results = await Promise.all(
      installs.map(async (install: Install) => {
        const sr = reposById.get(install.sourceRepoId);
        if (!sr) return { ...install, status: "up-to-date" as const, availableSha: null };
        const updateResult = await checkForUpdates(install, sr);
        const driftResult = await checkForDrift(install, sr, wr.path);
        const status = computeInstallStatus(updateResult.hasUpdate, driftResult.isDrifted);
        return { ...install, status, availableSha: updateResult.availableSha };
      }),
    );
    return results;
  });

  app.delete<{ Params: { id: string } }>("/api/working-repos/:id", async (req, reply) => {
    const r = await deps.workingRepos.get(req.params.id);
    if (!r) return reply.code(404).send({ code: "working_repo_not_found" });
    const orphanedInstalls = await deps.installs.listByWorkingRepo(r.id);
    for (const inst of orphanedInstalls) {
      await deps.installs.remove(inst.id);
    }
    await deps.workingRepos.remove(req.params.id);
    return reply.code(204).send();
  });
}
```

- [ ] **Step 10.4: Run the full test suite**

```bash
npx vitest run
```

Expected: All tests PASS.

- [ ] **Step 10.5: Commit**

```bash
git add src/api/working-repos.ts tests/integration/api.test.ts
git commit -m "feat(api): add POST /working-repos/:id/refresh with auto-update pass"
```

---

## Task 11: Trigger auto-update pass on skills-repo refresh and app launch

**Files:**
- Modify: `src/api/skills-repos.ts`
- Modify: `src/index.ts`

No new tests needed — covered by existing API test coverage and the update-drift integration tests.

- [ ] **Step 11.1: Modify `src/api/skills-repos.ts` — run auto-update pass after refresh**

In the `POST /api/skills-repos/:id/refresh` handler (currently the last route), add the auto-update pass after the fetch. Replace the existing handler:

```typescript
  app.post<{ Params: { id: string } }>("/api/skills-repos/:id/refresh", async (req, reply) => {
    const r = await deps.skillsRepos.get(req.params.id);
    if (!r) return reply.code(404).send({ code: "skills_repo_not_found" });
    await new GitClient().fetchAndReset(r.localClonePath, r.branch);
    const updated = await deps.skillsRepos.update(r.id, { lastFetchedAt: new Date().toISOString() });
    await runAutoUpdatePass({
      installs: deps.installs,
      skillsRepos: deps.skillsRepos,
      workingRepos: deps.workingRepos,
      registries: deps.registries,
    }).catch(() => {});
    return updated;
  });
```

Also add the import at the top of the file:

```typescript
import { runAutoUpdatePass } from "../engine/update-pass";
```

The `.catch(() => {})` is intentional: the refresh response returns immediately; update-pass failures are non-fatal and logged elsewhere.

- [ ] **Step 11.2: Modify `src/index.ts` — run auto-update pass on launch**

After `await app.listen(...)`, add:

```typescript
  // Background auto-update pass on launch — non-fatal
  runAutoUpdatePass({ installs, skillsRepos, workingRepos, registries }).catch((err) => {
    process.stderr.write(`update-pass error: ${(err as Error).message}\n`);
  });
```

Also add the import at the top of `src/index.ts`:

```typescript
import { runAutoUpdatePass } from './engine/update-pass';
```

- [ ] **Step 11.3: Run the full test suite to confirm no regressions**

```bash
npx vitest run
```

Expected: All tests PASS.

- [ ] **Step 11.4: Commit**

```bash
git add src/api/skills-repos.ts src/index.ts
git commit -m "feat: trigger auto-update pass after skills-repo refresh and on app launch"
```

---

## Task 12: Update `web/api.ts` — add types and new API calls

**Files:**
- Modify: `web/api.ts`

- [ ] **Step 12.1: Replace `web/api.ts` with the extended version**

```typescript
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
  artifactType: "skills";
  installedCommitSha: string; autoUpdate: boolean;
  installedFiles: { sourcePath: string; targetPath: string }[];
  installedAt: string;
}
export type InstallStatus =
  | "up-to-date"
  | "update-available"
  | "drifted"
  | "update-available+drifted";

export interface InstallWithStatus extends Install {
  status: InstallStatus;
  availableSha: string | null;
}

async function req<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
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
  refreshWorkingRepo: (id: string) => req<InstallWithStatus[]>("POST", `/api/working-repos/${id}/refresh`),

  listArtifacts: (q?: { q?: string; type?: string; sourceRepoId?: string }, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (q?.q) params.set("q", q.q);
    if (q?.type) params.set("type", q.type);
    if (q?.sourceRepoId) params.set("sourceRepoId", q.sourceRepoId);
    const qs = params.toString();
    return req<Artifact[]>("GET", `/api/artifacts${qs ? `?${qs}` : ""}`, undefined, signal);
  },

  listInstallsByWorkingRepo: (workingRepoId: string) =>
    req<InstallWithStatus[]>("GET", `/api/working-repos/${workingRepoId}/installs`),
  createInstall: (body: {
    artifactKey: string;
    target: { type: "working-repo"; workingRepoId: string } | { type: "global" };
    agent?: "claude-code" | "cursor";
    autoUpdate?: boolean;
    sha?: string;
  }) => req<Install>("POST", "/api/installs", body),
  updateInstall: (id: string, patch: { autoUpdate: boolean }) =>
    req<Install>("PATCH", `/api/installs/${id}`, patch),
  applyInstallUpdate: (id: string) => req<Install>("POST", `/api/installs/${id}/update`),
  deleteInstall: (id: string) => req<void>("DELETE", `/api/installs/${id}`),
};
```

- [ ] **Step 12.2: Run the FE unit tests to confirm no regressions**

```bash
npx vitest run tests/unit/install-modal.test.tsx
```

Expected: PASS.

- [ ] **Step 12.3: Commit**

```bash
git add web/api.ts
git commit -m "feat(web): add InstallStatus type, InstallWithStatus, and new API calls"
```

---

## Task 13: Create `web/components/StatusPill.tsx`

**Files:**
- Create: `web/components/StatusPill.tsx`
- Create: `tests/unit/status-pill.test.tsx`

- [ ] **Step 13.1: Write the failing unit test**

Create `tests/unit/status-pill.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusPill } from "../../web/components/StatusPill.tsx";

describe("StatusPill", () => {
  it("renders 'Up to date' for up-to-date status", () => {
    render(<StatusPill status="up-to-date" />);
    expect(screen.getByText("Up to date")).toBeTruthy();
  });
  it("renders 'Update available' for update-available status", () => {
    render(<StatusPill status="update-available" />);
    expect(screen.getByText("Update available")).toBeTruthy();
  });
  it("renders 'Drifted' for drifted status", () => {
    render(<StatusPill status="drifted" />);
    expect(screen.getByText("Drifted")).toBeTruthy();
  });
  it("renders 'Update + drifted' for update-available+drifted status", () => {
    render(<StatusPill status="update-available+drifted" />);
    expect(screen.getByText("Update + drifted")).toBeTruthy();
  });
});
```

- [ ] **Step 13.2: Run to confirm failure**

```bash
npx vitest run tests/unit/status-pill.test.tsx
```

Expected: FAIL — `StatusPill` not found.

- [ ] **Step 13.3: Create `web/components/StatusPill.tsx`**

```tsx
import type { InstallStatus } from "../api.ts";

const STYLE: Record<InstallStatus, React.CSSProperties> = {
  "up-to-date":              { background: "#d4edda", color: "#155724" },
  "update-available":        { background: "#cce5ff", color: "#004085" },
  "drifted":                 { background: "#fff3cd", color: "#856404" },
  "update-available+drifted":{ background: "#f8d7da", color: "#721c24" },
};

const LABEL: Record<InstallStatus, string> = {
  "up-to-date":               "Up to date",
  "update-available":         "Update available",
  "drifted":                  "Drifted",
  "update-available+drifted": "Update + drifted",
};

export function StatusPill({ status }: { status: InstallStatus }) {
  return (
    <span style={{
      ...STYLE[status],
      padding: "2px 8px",
      borderRadius: 12,
      fontSize: 11,
      fontWeight: 600,
      whiteSpace: "nowrap",
    }}>
      {LABEL[status]}
    </span>
  );
}
```

- [ ] **Step 13.4: Run tests**

```bash
npx vitest run tests/unit/status-pill.test.tsx
```

Expected: All 4 tests PASS.

- [ ] **Step 13.5: Commit**

```bash
git add web/components/StatusPill.tsx tests/unit/status-pill.test.tsx
git commit -m "feat(web): add StatusPill component"
```

---

## Task 14: Update `web/pages/WorkingRepoDetail.tsx`

**Files:**
- Modify: `web/pages/WorkingRepoDetail.tsx`
- Test: `tests/unit/working-repo-detail.test.tsx` (new — filter chip + button rendering)

- [ ] **Step 14.1: Write the failing UI tests**

Create `tests/unit/working-repo-detail.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { WorkingRepoDetail } from "../../web/pages/WorkingRepoDetail.tsx";
import type { InstallWithStatus } from "../../web/api.ts";

// Mock the api module
const mockInstalls: InstallWithStatus[] = [
  {
    id: "i1", artifactKey: "src1:ai/skills/foo", sourceRepoId: "src1",
    target: { type: "working-repo", workingRepoId: "w1" },
    agent: "claude-code", artifactType: "skills",
    installedCommitSha: "abc1234", autoUpdate: true,
    installedFiles: [], installedAt: "2024-01-01T00:00:00.000Z",
    status: "update-available+drifted", availableSha: "def5678",
  },
  {
    id: "i2", artifactKey: "src1:ai/skills/bar", sourceRepoId: "src1",
    target: { type: "working-repo", workingRepoId: "w1" },
    agent: "claude-code", artifactType: "skills",
    installedCommitSha: "abc1234", autoUpdate: false,
    installedFiles: [], installedAt: "2024-01-01T00:00:00.000Z",
    status: "up-to-date", availableSha: null,
  },
];

vi.mock("../../web/api.ts", () => ({
  api: {
    listWorkingRepos: vi.fn(async () => [
      { id: "w1", name: "My Repo", path: "/some/path", addedAt: "2024-01-01T00:00:00.000Z" },
    ]),
    listInstallsByWorkingRepo: vi.fn(async () => mockInstalls),
    refreshWorkingRepo: vi.fn(async () => mockInstalls),
    updateInstall: vi.fn(async () => ({ ...mockInstalls[0], autoUpdate: false })),
    applyInstallUpdate: vi.fn(async () => ({ ...mockInstalls[0], installedCommitSha: "def5678" })),
    deleteInstall: vi.fn(async () => undefined),
  },
}));

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={["/working-repos/w1"]}>
      <Routes>
        <Route path="/working-repos/:id" element={<WorkingRepoDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("WorkingRepoDetail", () => {
  it("renders the status column header", async () => {
    renderDetail();
    const header = await screen.findByText("Status");
    expect(header).toBeTruthy();
  });

  it("renders filter chips — All, Update available, Drifted", async () => {
    renderDetail();
    expect(await screen.findByText("All")).toBeTruthy();
    expect(await screen.findByText("Update available")).toBeTruthy();
    expect(await screen.findByText("Drifted")).toBeTruthy();
  });

  it("shows all installs when All chip is active", async () => {
    renderDetail();
    await screen.findByText("Status");
    // Both installs visible (foo and bar)
    expect(await screen.findByText("foo")).toBeTruthy();
    expect(await screen.findByText("bar")).toBeTruthy();
  });

  it("filters to only update-available installs when that chip is clicked", async () => {
    renderDetail();
    await screen.findByText("Status");
    const chip = await screen.findByRole("button", { name: "Update available" });
    fireEvent.click(chip);
    // Only foo (update-available+drifted) should be visible; bar (up-to-date) hidden
    expect(screen.queryByText("bar")).toBeNull();
  });

  it("renders Disable auto-update and Discard & update buttons for update-available+drifted", async () => {
    renderDetail();
    expect(await screen.findByRole("button", { name: "Disable auto-update" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Discard & update" })).toBeTruthy();
  });
});
```

- [ ] **Step 14.2: Run to confirm failures**

```bash
npx vitest run tests/unit/working-repo-detail.test.tsx
```

Expected: FAIL — missing elements.

- [ ] **Step 14.3: Replace `web/pages/WorkingRepoDetail.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, InstallWithStatus, WorkingRepo } from "../api.ts";
import { StatusPill } from "../components/StatusPill.tsx";

type FilterChip = "all" | "update-available" | "drifted";

export function WorkingRepoDetail() {
  const { id = "" } = useParams();
  const [repo, setRepo] = useState<WorkingRepo | null>(null);
  const [installs, setInstalls] = useState<InstallWithStatus[]>([]);
  const [filter, setFilter] = useState<FilterChip>("all");
  const [refreshing, setRefreshing] = useState(false);

  const reload = () => {
    api.listWorkingRepos().then((all) => setRepo(all.find((r) => r.id === id) ?? null));
    api.listInstallsByWorkingRepo(id).then(setInstalls);
  };
  useEffect(reload, [id]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const updated = await api.refreshWorkingRepo(id);
      setInstalls(updated);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  const filtered = installs.filter((i) => {
    if (filter === "all") return true;
    if (filter === "update-available") return i.status === "update-available" || i.status === "update-available+drifted";
    if (filter === "drifted") return i.status === "drifted" || i.status === "update-available+drifted";
    return true;
  });

  if (!repo) return <p>Loading…</p>;

  return (
    <>
      <p style={{ color: "var(--muted)", fontSize: 12 }}>
        <Link to="/working-repos">Working repos</Link> / {repo.name}
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>{repo.name}</h2>
        <button className="btn secondary" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      <div className="card" style={{ marginBottom: 16, fontSize: 13 }}>
        <div><strong>Path:</strong> {repo.path}</div>
        <div style={{ color: "var(--muted)" }}>Added {repo.addedAt}</div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {(["all", "update-available", "drifted"] as FilterChip[]).map((chip) => (
          <button
            key={chip}
            role="button"
            className={`btn ${filter === chip ? "primary" : "secondary"}`}
            style={{ fontSize: 12, padding: "3px 10px" }}
            onClick={() => setFilter(chip)}
          >
            {chip === "all" ? "All" : chip === "update-available" ? "Update available" : "Drifted"}
          </button>
        ))}
      </div>

      <h3 style={{ marginTop: 0 }}>Installed</h3>
      <table className="table">
        <thead>
          <tr>
            <th>Skill</th>
            <th>Source</th>
            <th>Agent</th>
            <th>Version</th>
            <th>Status</th>
            <th>Auto-update</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((i) => {
            const [, rel] = i.artifactKey.split(":", 2);
            const name = rel?.split("/").pop() ?? rel;
            return (
              <tr key={i.id}>
                <td>{name}</td>
                <td style={{ color: "var(--muted)" }}>{i.sourceRepoId.slice(0, 8)}</td>
                <td>{i.agent}</td>
                <td style={{ color: "var(--muted)" }}>{i.installedCommitSha.slice(0, 7)}</td>
                <td><StatusPill status={i.status} /></td>
                <td>{i.autoUpdate ? "on" : "off"}</td>
                <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {i.status === "update-available+drifted" && (
                    <>
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
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
```

- [ ] **Step 14.4: Run the FE tests**

```bash
npx vitest run tests/unit/working-repo-detail.test.tsx --reporter=verbose
```

Expected: All 5 tests PASS.

- [ ] **Step 14.5: Run the full suite**

```bash
npx vitest run
```

Expected: All tests PASS.

- [ ] **Step 14.6: Commit**

```bash
git add web/pages/WorkingRepoDetail.tsx tests/unit/working-repo-detail.test.tsx
git commit -m "feat(web): working-repo detail — status column, filter chips, resolution buttons"
```

---

## Final Verification and Slice Tag

- [ ] **Step F.1: Run the complete test suite one last time**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -20
```

Expected: 0 failures.

- [ ] **Step F.2: Verify TypeScript compiles cleanly**

```bash
npx tsc -p tsconfig.be.json --noEmit && npx tsc -p tsconfig.json --noEmit
```

Expected: No errors.

- [ ] **Step F.3: Tag the slice**

```bash
git tag slice-2
```

---

## Self-Review

### Spec coverage check

| Requirement | Task |
|------------|------|
| Update detection via `git log <installedSha>..HEAD -- <files>` | Tasks 1, 2 |
| Drift detection via `git show <sha>:<path>` + byte-compare | Task 3 |
| `InstallStatus` type with 4 values | Task 4 |
| `artifactType` in Install record (needed by applyUpdate) | Task 5, 6 |
| Re-apply at new SHA (applyUpdate) | Task 7 |
| Auto-update pass — gate on drift | Task 8 |
| GET installs returns status + availableSha | Task 9 |
| PATCH installs (disable auto-update) | Task 9 |
| POST installs/:id/update (discard & update) | Task 9 |
| POST working-repos/:id/refresh | Task 10 |
| Auto-update pass on skills-repo refresh | Task 11 |
| Auto-update pass on app launch | Task 11 |
| FE: InstallStatus + InstallWithStatus types + API calls | Task 12 |
| FE: StatusPill component | Task 13 |
| FE: Status column in working-repo detail | Task 14 |
| FE: Filter chips (All / Update available / Drifted) | Task 14 |
| FE: "Disable auto-update" button for update-available+drifted | Task 14 |
| FE: "Discard & update" button for update-available+drifted | Task 14 |
| FE: "Refresh" button on working-repo detail | Task 14 |

### Type consistency check

- `InstallStatus` type defined in `src/engine/status.ts` and mirrored in `web/api.ts` — both use identical string literals.
- `InstallWithStatus` (FE type) mirrors `{ ...Install, status, availableSha }` returned by API routes.
- `applyUpdate` returns `Pick<Install, "installedCommitSha" | "installedFiles">` — consumed by `InstallsStore.update()` which takes `Partial<Omit<Install, "id">>`. Compatible.
- `runAutoUpdatePass` args type uses `InstallsStore`, `SkillsRepoStore`, `WorkingRepoStore`, `AgentRegistry` — all already imported from their modules in the callers.

### No placeholders — confirmed

All steps include full code blocks. No TBDs.
