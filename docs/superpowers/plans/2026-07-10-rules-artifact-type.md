# Rules Artifact Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add **rules** (single markdown-file artifacts) as a second artifact type alongside skills, end to end: discovery, install to Claude Code / Cursor, git-exclusion, updates, uninstall, MCP, and UI.

**Architecture:** Plug a new `rulesAdapter` into the existing `ArtifactTypeRegistry`, add `rules` entries to both `AgentAdapter`s (install locations + extension mapping), and fix the three engine spots that assume "artifact = directory of files": relative-path slicing in install/apply-update and directory-level git-exclude patterns.

**Tech Stack:** TypeScript, Fastify backend, React frontend, Vitest (+ Testing Library), simple-git fixtures.

**Spec:** `docs/superpowers/specs/2026-07-10-rules-artifact-type-design.md`

## Global Constraints

- A rule is a single `.md` or `.mdc` file **directly** under a configured rules path (non-recursive); `README.md` (case-insensitive) is skipped.
- Rule name = filename without extension; description = frontmatter `description:` or null.
- Install locations: Claude Code `<repo>/.claude/rules/` and `~/.claude/rules/`; Cursor `<repo>/.cursor/rules/` only — **Cursor + global + rules is unsupported**.
- Extension mapping: Cursor rules `*.md → *.mdc`; Claude Code rules `*.mdc → *.md`. Content copied as-is (no frontmatter translation).
- Git-exclude patterns: per exact file for rules; per directory for skills (unchanged).
- All existing tests must keep passing; run `npm test` from the repo root.

---

### Task 1: Widen `ArtifactTypeId` and extract the frontmatter helper

**Files:**
- Modify: `src/state/schema.ts:2`
- Create: `src/adapters/artifact-types/frontmatter.ts`
- Modify: `src/adapters/artifact-types/skills.ts`
- Modify: `src/adapters/agents/claude-code.ts:6-8`
- Modify: `src/adapters/agents/cursor.ts:6-8`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ArtifactTypeId = "skills" | "rules"`; `frontmatterDescription(md: string): string | null` exported from `src/adapters/artifact-types/frontmatter.ts`. The agents' `SUPPORTED` maps become `Partial<Record<ArtifactTypeId, Scope[]>>` so this task compiles before Task 3 adds rules entries.

- [ ] **Step 1: Widen the type union**

In `src/state/schema.ts` replace line 2:

```ts
export type ArtifactTypeId = "skills" | "rules";
```

- [ ] **Step 2: Make both agents' SUPPORTED maps Partial**

In `src/adapters/agents/claude-code.ts` and `src/adapters/agents/cursor.ts`, replace the `SUPPORTED` declaration (both files are identical here):

```ts
const SUPPORTED: Partial<Record<ArtifactTypeId, Scope[]>> = {
  skills: ["working-repo", "global"],
};
```

(`supports()` already uses `SUPPORTED[type]?.includes(scope) ?? false`, so no other change is needed yet.)

- [ ] **Step 3: Extract the frontmatter helper**

Create `src/adapters/artifact-types/frontmatter.ts` with the function currently private to `skills.ts` (moved verbatim, exported):

```ts
export function frontmatterDescription(md: string): string | null {
  const frontmatterMatch = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!frontmatterMatch) return null;
  const descriptionMatch = frontmatterMatch[1]!.match(/^description:\s*(.*)$/m);
  if (!descriptionMatch) return null;
  let value = descriptionMatch[1]!.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return value || null;
}
```

In `src/adapters/artifact-types/skills.ts`: delete the local `frontmatterDescription` function and add the import:

```ts
import { frontmatterDescription } from './frontmatter';
```

- [ ] **Step 4: Run the full suite to verify no regression**

Run: `npm test`
Expected: PASS (this task is a refactor + type widening; behavior unchanged)

- [ ] **Step 5: Commit**

```bash
git add src/state/schema.ts src/adapters/artifact-types/frontmatter.ts src/adapters/artifact-types/skills.ts src/adapters/agents/claude-code.ts src/adapters/agents/cursor.ts
git commit -m "feat: widen ArtifactTypeId to include rules; extract frontmatter helper"
```

---

### Task 2: Rules discovery adapter

**Files:**
- Create: `src/adapters/artifact-types/rules.ts`
- Modify: `src/adapters/index.ts`
- Test: `tests/unit/artifact-types.rules.test.ts`

**Interfaces:**
- Consumes: `frontmatterDescription` (Task 1), `lastSHATouching(repoPath, ref, files)` from `src/git/log.ts`, `ArtifactTypeAdapter`/`DiscoveredArtifact` from `src/adapters/types.ts`.
- Produces: `rulesAdapter: ArtifactTypeAdapter` with `id: "rules"`, registered in `buildRegistries()`. For each rule: `artifactKey = "<sourceRepoId>:<configuredPath>/<file>"`, `rootRelativePath` = the file's repo-relative path, `files = [rootRelativePath]`, `name` = filename without extension.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/artifact-types.rules.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildFixtureRepo } from "../helpers/build-fixture-repo.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";
import { GitClient } from "../../src/git/client.ts";
import { rulesAdapter } from "../../src/adapters/artifact-types/rules.ts";
import path from "node:path";

describe("rulesAdapter.discoverAt", () => {
  it("discovers each .md/.mdc file directly under the configured path", async () => {
    const fx = await buildFixtureRepo([
      {
        message: "init",
        files: {
          "ai/rules/style.md": "---\ndescription: Code style rules.\n---\n\nUse tabs.\n",
          "ai/rules/security.mdc": "---\ndescription: \"Security rules.\"\nglobs: **/*.ts\n---\n\nNo secrets.\n",
          "ai/rules/README.md": "not a rule\n",
          "ai/rules/notes.txt": "not markdown\n",
          "ai/rules/nested/deep.md": "should be ignored\n",
        },
      },
    ]);
    const dest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, dest, "main");
    const out = await rulesAdapter.discoverAt({
      sourceRepoId: "src1",
      sourceRepoPath: dest,
      configuredPath: "ai/rules",
      ref: "main",
    });
    expect(out.map((a) => a.name).sort()).toEqual(["security", "style"]);
    const style = out.find((a) => a.name === "style")!;
    expect(style.type).toBe("rules");
    expect(style.artifactKey).toBe("src1:ai/rules/style.md");
    expect(style.rootRelativePath).toBe("ai/rules/style.md");
    expect(style.files).toEqual(["ai/rules/style.md"]);
    expect(style.description).toBe("Code style rules.");
    expect(style.lastTouchedSha).toBe(fx.shas[0]);
    const security = out.find((a) => a.name === "security")!;
    expect(security.artifactKey).toBe("src1:ai/rules/security.mdc");
    expect(security.description).toBe("Security rules.");
  });

  it("returns null description when frontmatter is missing, and [] for a missing path", async () => {
    const fx = await buildFixtureRepo([
      { message: "init", files: { "ai/rules/plain.md": "Just text, no frontmatter.\n" } },
    ]);
    const dest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, dest, "main");
    const out = await rulesAdapter.discoverAt({
      sourceRepoId: "src1", sourceRepoPath: dest, configuredPath: "ai/rules", ref: "main",
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.description).toBeNull();
    const missing = await rulesAdapter.discoverAt({
      sourceRepoId: "src1", sourceRepoPath: dest, configuredPath: "no/such/dir", ref: "main",
    });
    expect(missing).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/artifact-types.rules.test.ts`
Expected: FAIL — cannot resolve `src/adapters/artifact-types/rules.ts`

- [ ] **Step 3: Implement the adapter**

Create `src/adapters/artifact-types/rules.ts`:

```ts
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { ArtifactTypeAdapter, DiscoveredArtifact } from '../types';
import { lastSHATouching } from '../../git/log';
import { frontmatterDescription } from './frontmatter';

const RULE_EXTENSIONS = new Set([".md", ".mdc"]);

export const rulesAdapter: ArtifactTypeAdapter = {
  id: "rules",
  displayName: "Rules",
  async discoverAt({ sourceRepoId, sourceRepoPath, configuredPath, ref }) {
    const absRoot = path.join(sourceRepoPath, configuredPath);
    if (!existsSync(absRoot)) return [];
    const items = await readdir(absRoot, { withFileTypes: true });
    const files = items
      .filter((i) => i.isFile())
      .map((i) => i.name)
      .filter((n) => RULE_EXTENSIONS.has(path.extname(n)) && n.toLowerCase() !== "readme.md")
      .sort();
    const out: DiscoveredArtifact[] = [];
    for (const fileName of files) {
      const rootRelativePath = `${configuredPath}/${fileName}`;
      const description = frontmatterDescription(await readFile(path.join(absRoot, fileName), "utf8"));
      const lastTouchedSha = await lastSHATouching(sourceRepoPath, ref, [rootRelativePath]);
      out.push({
        artifactKey: `${sourceRepoId}:${rootRelativePath}`,
        sourceRepoId,
        type: "rules",
        name: fileName.slice(0, -path.extname(fileName).length),
        description,
        rootRelativePath,
        files: [rootRelativePath],
        lastTouchedSha,
      });
    }
    return out;
  },
};
```

Register it in `src/adapters/index.ts`:

```ts
import { AgentRegistry, ArtifactTypeRegistry } from './registry';
import { claudeCodeAdapter } from './agents/claude-code';
import { cursorAdapter } from './agents/cursor';
import { skillsAdapter } from './artifact-types/skills';
import { rulesAdapter } from './artifact-types/rules';

export function buildRegistries(): { agents: AgentRegistry; types: ArtifactTypeRegistry } {
  const agents = new AgentRegistry();
  agents.register(claudeCodeAdapter);
  agents.register(cursorAdapter);
  const types = new ArtifactTypeRegistry();
  types.register(skillsAdapter);
  types.register(rulesAdapter);
  return { agents, types };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/artifact-types.rules.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/adapters/artifact-types/rules.ts src/adapters/index.ts tests/unit/artifact-types.rules.test.ts
git commit -m "feat: add rules artifact-type adapter and register it"
```

---

### Task 3: Agent adapters — rules locations and extension mapping

**Files:**
- Modify: `src/adapters/types.ts:21` (mapFileName signature)
- Modify: `src/adapters/agents/claude-code.ts`
- Modify: `src/adapters/agents/cursor.ts`
- Modify: `src/engine/install.ts:41` and `src/engine/apply-update.ts:51` (call sites gain the type argument)
- Test: `tests/unit/agents.claude-code.test.ts`, `tests/unit/agents.cursor.test.ts`

**Interfaces:**
- Consumes: `ArtifactTypeId` incl. `"rules"` (Task 1).
- Produces: `mapFileName(fileName: string, type: ArtifactTypeId): string` on `AgentAdapter`; `supports("rules", ...)` per the matrix; `targetRoot({type: "rules", ...})` returns the **shared** rules directory (ignores `name`).

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/agents.cursor.test.ts` inside the `describe("cursorAdapter", ...)` block, and update the three existing `mapFileName(...)` calls in that file to pass `"skills"` as the second argument:

```ts
  it("supports rules only at working-repo scope", () => {
    expect(cursorAdapter.supports("rules", "working-repo")).toBe(true);
    expect(cursorAdapter.supports("rules", "global")).toBe(false);
  });

  it("rules targetRoot is the shared .cursor/rules directory", () => {
    const root = cursorAdapter.targetRoot({
      scope: "working-repo",
      workingRepoPath: "/r/a",
      type: "rules",
      name: "style",
    });
    expect(root.replace(/\\/g, "/")).toBe("/r/a/.cursor/rules");
  });

  it("mapFileName renames rule .md to .mdc, leaves .mdc alone, and leaves skills extensions alone", () => {
    expect(cursorAdapter.mapFileName("style.md", "rules")).toBe("style.mdc");
    expect(cursorAdapter.mapFileName("security.mdc", "rules")).toBe("security.mdc");
    expect(cursorAdapter.mapFileName("SKILL.md", "skills")).toBe("SKILL.md");
  });
```

Append to `tests/unit/agents.claude-code.test.ts` inside its `describe` block (also add `, "skills"` to any existing `mapFileName` calls there):

```ts
  it("supports rules at both scopes", () => {
    expect(claudeCodeAdapter.supports("rules", "working-repo")).toBe(true);
    expect(claudeCodeAdapter.supports("rules", "global")).toBe(true);
  });

  it("rules targetRoot is the shared rules directory", () => {
    const root = claudeCodeAdapter.targetRoot({
      scope: "working-repo",
      workingRepoPath: "/r/a",
      type: "rules",
      name: "style",
    });
    expect(root.replace(/\\/g, "/")).toBe("/r/a/.claude/rules");
    const globalRoot = claudeCodeAdapter.targetRoot({ scope: "global", type: "rules", name: "style" });
    expect(globalRoot).toBe(path.join(os.homedir(), ".claude", "rules"));
  });

  it("mapFileName renames rule .mdc to .md, otherwise identity", () => {
    expect(claudeCodeAdapter.mapFileName("security.mdc", "rules")).toBe("security.md");
    expect(claudeCodeAdapter.mapFileName("style.md", "rules")).toBe("style.md");
    expect(claudeCodeAdapter.mapFileName("SKILL.md", "skills")).toBe("SKILL.md");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/agents.cursor.test.ts tests/unit/agents.claude-code.test.ts`
Expected: FAIL — `supports("rules", "working-repo")` returns false; targetRoot throws; mapFileName ignores the new argument (TypeScript will also flag the arity once the signature changes)

- [ ] **Step 3: Implement**

`src/adapters/types.ts` — change the interface method:

```ts
  mapFileName(fileName: string, type: ArtifactTypeId): string;
```

`src/adapters/agents/cursor.ts` — full new body:

```ts
import os from "node:os";
import path from "node:path";
import type { AgentAdapter, Scope } from '../types';
import type { ArtifactTypeId } from '../../state/schema';

const SUPPORTED: Partial<Record<ArtifactTypeId, Scope[]>> = {
  skills: ["working-repo", "global"],
  rules: ["working-repo"],
};

export const cursorAdapter: AgentAdapter = {
  id: "cursor",
  displayName: "Cursor",
  supports(type, scope) {
    return SUPPORTED[type]?.includes(scope) ?? false;
  },
  targetRoot({ scope, workingRepoPath, type, name }) {
    if (type === "rules") {
      if (scope !== "working-repo" || !workingRepoPath) {
        throw new Error("cursor: rules are only supported in a working repo");
      }
      return path.join(workingRepoPath, ".cursor", "rules");
    }
    if (type !== "skills") throw new Error(`cursor: unsupported artifact type: ${type}`);
    if (scope === "working-repo") {
      if (!workingRepoPath) throw new Error("workingRepoPath required for working-repo scope");
      return path.join(workingRepoPath, ".cursor", "skills", name);
    }
    return path.join(os.homedir(), ".cursor", "skills", name);
  },
  mapFileName(name, type) {
    const parts = name.split("/");
    const last = parts[parts.length - 1]!;
    if (type === "rules" && last.endsWith(".md")) {
      parts[parts.length - 1] = last.slice(0, -3) + ".mdc";
    } else if (last === "CLAUDE.md") {
      parts[parts.length - 1] = "AGENTS.md";
    }
    return parts.join("/");
  },
};
```

`src/adapters/agents/claude-code.ts` — full new body:

```ts
import os from "node:os";
import path from "node:path";
import type { AgentAdapter, Scope } from '../types';
import type { ArtifactTypeId } from '../../state/schema';

const SUPPORTED: Partial<Record<ArtifactTypeId, Scope[]>> = {
  skills: ["working-repo", "global"],
  rules: ["working-repo", "global"],
};

export const claudeCodeAdapter: AgentAdapter = {
  id: "claude-code",
  displayName: "Claude Code",
  supports(type, scope) {
    return SUPPORTED[type]?.includes(scope) ?? false;
  },
  targetRoot({ scope, workingRepoPath, type, name }) {
    const leaf = type === "rules" ? [".claude", "rules"] : [".claude", "skills", name];
    if (scope === "working-repo") {
      if (!workingRepoPath) throw new Error("workingRepoPath required for working-repo scope");
      return path.join(workingRepoPath, ...leaf);
    }
    return path.join(os.homedir(), ...leaf);
  },
  mapFileName(name, type) {
    if (type === "rules" && name.endsWith(".mdc")) return name.slice(0, -4) + ".md";
    return name;
  },
};
```

Call sites — in `src/engine/install.ts` line 41:

```ts
      const mapped = agent.mapFileName(relativeToArtifact, artifact.type);
```

In `src/engine/apply-update.ts` line 51:

```ts
      const mapped = agent.mapFileName(relativeToArtifact, install.artifactType);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/agents.cursor.test.ts tests/unit/agents.claude-code.test.ts`
Expected: PASS. Then run `npm test` — everything else must still pass.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/types.ts src/adapters/agents/cursor.ts src/adapters/agents/claude-code.ts src/engine/install.ts src/engine/apply-update.ts tests/unit/agents.cursor.test.ts tests/unit/agents.claude-code.test.ts
git commit -m "feat: rules support in agent adapters with per-agent extension mapping"
```

---

### Task 4: Engine — single-file artifacts and per-file exclude patterns

**Files:**
- Modify: `src/engine/install.ts` (lines 18, 40, 53-55, 80-90)
- Modify: `src/engine/uninstall.ts:9-11`
- Modify: `src/engine/apply-update.ts` (lines 16, 50, 61-64)
- Test: `tests/unit/compute-exclude-patterns.test.ts`

**Interfaces:**
- Consumes: `Install` with `artifactType` (existing field).
- Produces: `computeExcludePatterns(installs: Array<Pick<Install, "installedFiles" | "artifactType">>): string[]` — exact file paths for `rules` installs, `dir/` for everything else. `InstallArgs.existingInstallsInTarget`, `UninstallArgs.remainingInstallsInTarget`, and `applyUpdate`'s `otherInstallsInTarget` all widen to the same Pick. (All production callers in `src/api/installs.ts`, `src/engine/update-pass.ts`, `src/mcp/tools.ts` already pass full `Install` records, so they compile unchanged.)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/compute-exclude-patterns.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeExcludePatterns } from "../../src/engine/install.ts";

describe("computeExcludePatterns", () => {
  it("emits the parent directory for skills installs", () => {
    const patterns = computeExcludePatterns([
      {
        artifactType: "skills",
        installedFiles: [
          { sourcePath: "ai/skills/foo/SKILL.md", targetPath: ".claude/skills/foo/SKILL.md" },
          { sourcePath: "ai/skills/foo/extra.md", targetPath: ".claude/skills/foo/extra.md" },
        ],
      },
    ]);
    expect(patterns).toEqual([".claude/skills/foo/"]);
  });

  it("emits the exact file path for rules installs", () => {
    const patterns = computeExcludePatterns([
      {
        artifactType: "rules",
        installedFiles: [{ sourcePath: "ai/rules/style.md", targetPath: ".claude/rules/style.md" }],
      },
    ]);
    expect(patterns).toEqual([".claude/rules/style.md"]);
  });

  it("mixes both, sorted and de-duplicated", () => {
    const patterns = computeExcludePatterns([
      {
        artifactType: "rules",
        installedFiles: [{ sourcePath: "ai/rules/style.md", targetPath: ".cursor/rules/style.mdc" }],
      },
      {
        artifactType: "rules",
        installedFiles: [{ sourcePath: "ai/rules/sec.mdc", targetPath: ".cursor/rules/sec.mdc" }],
      },
      {
        artifactType: "skills",
        installedFiles: [{ sourcePath: "ai/skills/foo/SKILL.md", targetPath: ".cursor/skills/foo/SKILL.md" }],
      },
    ]);
    expect(patterns).toEqual([".cursor/rules/sec.mdc", ".cursor/rules/style.mdc", ".cursor/skills/foo/"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/compute-exclude-patterns.test.ts`
Expected: FAIL — TypeScript error (`artifactType` not in the Pick) and/or the rules case returns `[".claude/rules/"]`

- [ ] **Step 3: Implement**

In `src/engine/install.ts`:

1. Widen the args field (line 18):

```ts
  existingInstallsInTarget: Array<Pick<Install, "installedFiles" | "artifactType">>;
```

2. Single-file relative path (line 40):

```ts
      const relativeToArtifact =
        sourcePath === artifact.rootRelativePath
          ? path.basename(sourcePath)
          : sourcePath.slice(artifact.rootRelativePath.length + 1);
```

3. Pass the type when recomputing patterns (lines 53-55):

```ts
      const patterns = computeExcludePatterns(
        [...existingInstallsInTarget, { installedFiles, artifactType: artifact.type }],
      );
```

4. New `computeExcludePatterns` (lines 80-90):

```ts
export function computeExcludePatterns(
  installs: Array<Pick<Install, "installedFiles" | "artifactType">>,
): string[] {
  const set = new Set<string>();
  for (const inst of installs) {
    for (const f of inst.installedFiles) {
      if (inst.artifactType === "rules") {
        // Single-file artifact in a shared directory: exclude only this file so
        // the user's own rules in the same directory stay visible to git.
        set.add(f.targetPath);
      } else {
        const dir = f.targetPath.split("/").slice(0, -1).join("/");
        if (dir) set.add(dir + "/");
      }
    }
  }
  return [...set].sort();
}
```

In `src/engine/uninstall.ts` (line 11):

```ts
  remainingInstallsInTarget: Array<Pick<Install, "installedFiles" | "artifactType">>;
```

In `src/engine/apply-update.ts`:

1. Widen the args field (line 16):

```ts
  otherInstallsInTarget: Array<Pick<Install, "installedFiles" | "artifactType">>;
```

2. Single-file relative path (line 50):

```ts
      const relativeToArtifact =
        sourcePath === rootRelativePath
          ? path.basename(sourcePath)
          : sourcePath.slice(rootRelativePath.length + 1);
```

3. Pass the type (lines 61-64):

```ts
    const patterns = computeExcludePatterns([
      ...otherInstallsInTarget,
      { installedFiles: newInstalledFiles, artifactType: install.artifactType },
    ]);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/compute-exclude-patterns.test.ts`
Expected: PASS. Then `npm test` — all existing install/uninstall/update tests must still pass (skills behavior unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/engine/install.ts src/engine/uninstall.ts src/engine/apply-update.ts tests/unit/compute-exclude-patterns.test.ts
git commit -m "feat: single-file artifact handling and per-file exclude patterns for rules"
```

---

### Task 5: Integration tests — rules install / uninstall / update end-to-end

**Files:**
- Test: `tests/integration/install-rules.test.ts` (create)

**Interfaces:**
- Consumes: `rulesAdapter` via `buildRegistries()` (Task 2), agent rules support (Task 3), engine changes (Task 4). No production code changes in this task — if a test fails, the bug is in Tasks 2-4.

- [ ] **Step 1: Write the integration tests**

Create `tests/integration/install-rules.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildFixtureRepo } from "../helpers/build-fixture-repo.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";
import { GitClient } from "../../src/git/client.ts";
import { buildRegistries } from "../../src/adapters/index.ts";
import { discoverArtifacts } from "../../src/discovery/discover.ts";
import { installArtifact } from "../../src/engine/install.ts";
import { uninstallArtifact } from "../../src/engine/uninstall.ts";
import { applyUpdate } from "../../src/engine/apply-update.ts";
import { checkForDrift } from "../../src/engine/drift-check.ts";
import { simpleGit } from "simple-git";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Install, SkillsRepo, WorkingRepo } from "../../src/state/schema.ts";

async function makeWorkingRepo(): Promise<WorkingRepo> {
  const dir = await tmpDir("arm-wr-");
  const sg = simpleGit(dir);
  await sg.init();
  await sg.addConfig("user.email", "a@b");
  await sg.addConfig("user.name", "t");
  await sg.addConfig("commit.gpgsign", "false");
  await sg.commit("seed", [], { "--allow-empty": null });
  return { id: "w1", name: "alpha", path: dir, addedAt: new Date().toISOString() };
}

async function makeRulesFixture() {
  const fx = await buildFixtureRepo([
    {
      message: "init",
      files: {
        "ai/rules/style.md": "---\ndescription: Style.\n---\nUse tabs.\n",
        "ai/rules/security.mdc": "No secrets.\n",
      },
    },
    { message: "update style", files: { "ai/rules/style.md": "---\ndescription: Style.\n---\nUse spaces.\n" } },
  ]);
  const cloneDest = path.join(await tmpDir(), "clone");
  await new GitClient().clone(fx.fileUrl, cloneDest, "main");
  const skillsRepo: SkillsRepo = {
    id: "src1", name: "src", gitUrl: fx.fileUrl, branch: "main",
    artifactPaths: { rules: ["ai/rules"] },
    presetId: null, localClonePath: cloneDest, lastFetchedAt: null,
  };
  return { fx, skillsRepo };
}

describe("rules install (working repo)", () => {
  it("Claude Code: installs into .claude/rules/ and excludes only the exact file", async () => {
    const { fx, skillsRepo } = await makeRulesFixture();
    const { agents, types } = buildRegistries();
    const artifacts = await discoverArtifacts(skillsRepo, types);
    const style = artifacts.find((a) => a.name === "style")!;
    const workingRepo = await makeWorkingRepo();

    const result = await installArtifact({
      artifact: style, skillsRepo,
      target: { type: "working-repo", workingRepoId: workingRepo.id },
      workingRepo, agent: agents.get("claude-code"),
      sha: fx.shas[1]!, autoUpdate: false, existingInstallsInTarget: [],
    });

    const installedPath = path.join(workingRepo.path, ".claude/rules/style.md");
    expect(existsSync(installedPath)).toBe(true);
    expect(await readFile(installedPath, "utf8")).toContain("Use spaces.");
    expect(result.installedFiles).toEqual([
      { sourcePath: "ai/rules/style.md", targetPath: ".claude/rules/style.md" },
    ]);
    const excl = await readFile(path.join(workingRepo.path, ".git/info/exclude"), "utf8");
    expect(excl).toContain(".claude/rules/style.md");
    expect(excl).not.toContain(".claude/rules/\n");
  });

  it("Claude Code: renames .mdc rules to .md", async () => {
    const { fx, skillsRepo } = await makeRulesFixture();
    const { agents, types } = buildRegistries();
    const security = (await discoverArtifacts(skillsRepo, types)).find((a) => a.name === "security")!;
    const workingRepo = await makeWorkingRepo();
    await installArtifact({
      artifact: security, skillsRepo,
      target: { type: "working-repo", workingRepoId: workingRepo.id },
      workingRepo, agent: agents.get("claude-code"),
      sha: fx.shas[1]!, autoUpdate: false, existingInstallsInTarget: [],
    });
    expect(existsSync(path.join(workingRepo.path, ".claude/rules/security.md"))).toBe(true);
    expect(existsSync(path.join(workingRepo.path, ".claude/rules/security.mdc"))).toBe(false);
  });

  it("Cursor: installs into .cursor/rules/ renaming .md to .mdc", async () => {
    const { fx, skillsRepo } = await makeRulesFixture();
    const { agents, types } = buildRegistries();
    const style = (await discoverArtifacts(skillsRepo, types)).find((a) => a.name === "style")!;
    const workingRepo = await makeWorkingRepo();
    const result = await installArtifact({
      artifact: style, skillsRepo,
      target: { type: "working-repo", workingRepoId: workingRepo.id },
      workingRepo, agent: agents.get("cursor"),
      sha: fx.shas[1]!, autoUpdate: false, existingInstallsInTarget: [],
    });
    expect(existsSync(path.join(workingRepo.path, ".cursor/rules/style.mdc"))).toBe(true);
    expect(result.installedFiles[0]!.targetPath).toBe(".cursor/rules/style.mdc");
  });

  it("Cursor: rejects global installs of rules", async () => {
    const { fx, skillsRepo } = await makeRulesFixture();
    const { agents, types } = buildRegistries();
    const style = (await discoverArtifacts(skillsRepo, types)).find((a) => a.name === "style")!;
    await expect(installArtifact({
      artifact: style, skillsRepo,
      target: { type: "global" },
      agent: agents.get("cursor"),
      sha: fx.shas[1]!, autoUpdate: false, existingInstallsInTarget: [],
    })).rejects.toMatchObject({ code: "unsupported_combination" });
  });

  it("uninstalling one rule leaves sibling rules and their exclude entries intact", async () => {
    const { fx, skillsRepo } = await makeRulesFixture();
    const { agents, types } = buildRegistries();
    const artifacts = await discoverArtifacts(skillsRepo, types);
    const style = artifacts.find((a) => a.name === "style")!;
    const security = artifacts.find((a) => a.name === "security")!;
    const workingRepo = await makeWorkingRepo();
    const agent = agents.get("claude-code");

    const styleInstall = await installArtifact({
      artifact: style, skillsRepo,
      target: { type: "working-repo", workingRepoId: workingRepo.id },
      workingRepo, agent, sha: fx.shas[1]!, autoUpdate: false, existingInstallsInTarget: [],
    });
    const securityInstall = await installArtifact({
      artifact: security, skillsRepo,
      target: { type: "working-repo", workingRepoId: workingRepo.id },
      workingRepo, agent, sha: fx.shas[1]!, autoUpdate: false,
      existingInstallsInTarget: [styleInstall],
    });

    await uninstallArtifact({
      install: styleInstall, workingRepo,
      remainingInstallsInTarget: [securityInstall],
    });

    expect(existsSync(path.join(workingRepo.path, ".claude/rules/style.md"))).toBe(false);
    expect(existsSync(path.join(workingRepo.path, ".claude/rules/security.md"))).toBe(true);
    const excl = await readFile(path.join(workingRepo.path, ".git/info/exclude"), "utf8");
    expect(excl).toContain(".claude/rules/security.md");
    expect(excl).not.toContain(".claude/rules/style.md");
  });

  it("detects drift when the installed rule file is edited locally", async () => {
    const { fx, skillsRepo } = await makeRulesFixture();
    const { agents, types } = buildRegistries();
    const style = (await discoverArtifacts(skillsRepo, types)).find((a) => a.name === "style")!;
    const workingRepo = await makeWorkingRepo();
    const draft = await installArtifact({
      artifact: style, skillsRepo,
      target: { type: "working-repo", workingRepoId: workingRepo.id },
      workingRepo, agent: agents.get("claude-code"),
      sha: fx.shas[1]!, autoUpdate: false, existingInstallsInTarget: [],
    });
    const install: Install = { id: "i1", ...draft };

    const clean = await checkForDrift(install, skillsRepo, workingRepo.path);
    expect(clean.isDrifted).toBe(false);

    await writeFile(path.join(workingRepo.path, ".claude/rules/style.md"), "edited locally\n", "utf8");
    const drifted = await checkForDrift(install, skillsRepo, workingRepo.path);
    expect(drifted.isDrifted).toBe(true);
    expect(drifted.driftedFiles).toEqual([
      { sourcePath: "ai/rules/style.md", targetPath: ".claude/rules/style.md" },
    ]);
  });

  it("applyUpdate moves a rule install to a new SHA", async () => {
    const { fx, skillsRepo } = await makeRulesFixture();
    const { agents, types } = buildRegistries();
    const style = (await discoverArtifacts(skillsRepo, types)).find((a) => a.name === "style")!;
    const workingRepo = await makeWorkingRepo();
    const agent = agents.get("claude-code");
    const draft = await installArtifact({
      artifact: style, skillsRepo,
      target: { type: "working-repo", workingRepoId: workingRepo.id },
      workingRepo, agent, sha: fx.shas[0]!, autoUpdate: true, existingInstallsInTarget: [],
    });
    const install: Install = { id: "i1", ...draft };

    const updated = await applyUpdate({
      install, skillsRepo, workingRepo, newSha: fx.shas[1]!, agent, otherInstallsInTarget: [],
    });

    expect(updated.installedCommitSha).toBe(fx.shas[1]);
    const content = await readFile(path.join(workingRepo.path, ".claude/rules/style.md"), "utf8");
    expect(content).toContain("Use spaces.");
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run tests/integration/install-rules.test.ts`
Expected: PASS (Tasks 2-4 delivered the behavior; if anything fails, fix the corresponding engine/adapter code, not the test, unless the test contradicts the spec)

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add tests/integration/install-rules.test.ts
git commit -m "test: end-to-end coverage for rules install, uninstall, and update"
```

---

### Task 6: Web — types, register modal rules paths, repo pages

**Files:**
- Modify: `web/api.ts` (SkillsRepo.artifactPaths, Artifact.type, registerSkillsRepo body)
- Modify: `web/components/RegisterSkillsRepoModal.tsx`
- Modify: `web/pages/SkillsRepos.tsx` (table column)
- Modify: `web/pages/SkillsRepoDetail.tsx:39`
- Test: `tests/unit/skills-repo-detail.test.tsx`

**Interfaces:**
- Consumes: backend already accepts `artifactPaths: { rules: [...] }` (schema is `Partial<Record<ArtifactTypeId, string[]>>`).
- Produces: `Artifact.type: "skills" | "rules"` and `artifactPaths: { skills?: string[]; rules?: string[] }` in `web/api.ts` — Tasks 7-8 rely on this union.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/skills-repo-detail.test.tsx`:

```ts
describe("SkillsRepoDetail — artifact paths", () => {
  it("shows skills and rules paths lines", async () => {
    renderDetail();
    await screen.findByText("alpha");
    expect(screen.getByText("Skills paths:")).toBeTruthy();
    expect(screen.getByText("Rules paths:")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/skills-repo-detail.test.tsx`
Expected: FAIL — "Rules paths:" not found

- [ ] **Step 3: Implement**

`web/api.ts` — update the two type declarations:

```ts
export interface SkillsRepo {
  id: string; name: string; gitUrl: string; branch: string;
  artifactPaths: { skills?: string[]; rules?: string[] };
  presetId: string | null; localClonePath: string; lastFetchedAt: string | null;
}
```

In the `Artifact` interface: `type: "skills" | "rules";`

In the `registerSkillsRepo` client function signature: `artifactPaths?: { skills?: string[]; rules?: string[] }`.

`web/components/RegisterSkillsRepoModal.tsx` — add state, submit payload, and a field. New state next to `skillsPaths`:

```ts
  const [rulesPaths, setRulesPaths] = useState("");
```

Submit payload:

```ts
      await api.registerSkillsRepo({
        name, gitUrl, branch,
        artifactPaths: {
          skills: skillsPaths.split(",").map((s) => s.trim()).filter(Boolean),
          rules: rulesPaths.split(",").map((s) => s.trim()).filter(Boolean),
        },
      });
```

New field after the "Skills paths" field:

```tsx
        <div className="field">
          <label>Rules paths (comma-separated)</label>
          <input value={rulesPaths} onChange={(e) => setRulesPaths(e.target.value)} style={{ width: "100%" }} placeholder="ai/rules" />
        </div>
```

`web/pages/SkillsRepos.tsx` — header row gains a column and each body row a cell:

```tsx
        <thead><tr><th>Name</th><th>Git URL</th><th>Branch</th><th>Skills paths</th><th>Rules paths</th><th></th></tr></thead>
```

```tsx
              <td>{(r.artifactPaths.rules ?? []).join(", ")}</td>
```

(insert the new `<td>` between the skills-paths cell and the Remove-button cell)

`web/pages/SkillsRepoDetail.tsx` — after the Skills paths line (line 39):

```tsx
        <div><strong>Rules paths:</strong> {(repo.artifactPaths.rules ?? []).join(", ") || "(none)"}</div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/skills-repo-detail.test.tsx`
Expected: PASS. Then `npm test`.

- [ ] **Step 5: Commit**

```bash
git add web/api.ts web/components/RegisterSkillsRepoModal.tsx web/pages/SkillsRepos.tsx web/pages/SkillsRepoDetail.tsx tests/unit/skills-repo-detail.test.tsx
git commit -m "feat: rules paths in register modal and skills-repo pages"
```

---

### Task 7: Browse — type column and type filter

**Files:**
- Modify: `web/pages/Browse.tsx`
- Test: `tests/unit/browse.test.tsx`

**Interfaces:**
- Consumes: `Artifact.type: "skills" | "rules"` (Task 6); `/api/artifacts?type=` filter (already implemented server-side); `api.listArtifacts({ q?, type? })`.
- Produces: UI only.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/browse.test.tsx`, add a rules artifact to `mockArtifacts`:

```ts
  {
    artifactKey: "src1:rules/style.md", sourceRepoId: "src1", sourceName: "acme-skills", type: "rules" as const,
    name: "style", description: "Style rule.", rootRelativePath: "rules/style.md",
    files: ["rules/style.md"], lastTouchedSha: "sha3", isFavorite: false,
  },
```

Append a new describe block:

```tsx
describe("Browse — artifact type", () => {
  it("renders a type badge per row", async () => {
    renderBrowse();
    await screen.findByText("alpha");
    expect(screen.getAllByText("skill").length).toBe(2);
    expect(screen.getAllByText("rule").length).toBe(1);
  });

  it("passes the selected type to api.listArtifacts", async () => {
    const { api } = await import("../../web/api.ts");
    renderBrowse();
    await screen.findByText("alpha");
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "rules" } });
    await waitFor(() => {
      expect(api.listArtifacts).toHaveBeenLastCalledWith(
        { q: undefined, type: "rules" },
        expect.anything(),
      );
    });
  });
});
```

Add `waitFor` to the imports from `@testing-library/react` at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/browse.test.tsx`
Expected: FAIL — no "Type" select, no badges

- [ ] **Step 3: Implement**

In `web/pages/Browse.tsx`:

1. Add state and include it in both fetch effects (the initial `useEffect` and `useAutoRefresh` callback both currently call `api.listArtifacts({ q: q || undefined }, ...)`):

```ts
  const [typeFilter, setTypeFilter] = useState("");
```

Both calls become:

```ts
    api.listArtifacts({ q: q || undefined, type: typeFilter || undefined }, ac.signal)
```

The initial effect's dependency array becomes `[q, typeFilter]`. The same argument shape is used in the two `listArtifacts` calls inside `handleToggleFavorite`.

2. Add the filter select next to the search input:

```tsx
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" style={{ width: 360 }} />
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Type">
          <option value="">All types</option>
          <option value="skills">Skills</option>
          <option value="rules">Rules</option>
        </select>
      </div>
```

(replace the existing bare `<input ... style={{ width: 360, marginBottom: 14 }} />`)

3. Add a Type column — header:

```tsx
        <thead><tr><th></th><th>Name</th><th>Type</th><th>Source</th><th>Description</th><th></th></tr></thead>
```

Body cell, inserted after the Name cell:

```tsx
              <td>
                <span style={{
                  fontSize: 11, padding: "2px 8px", borderRadius: 10,
                  background: "rgba(255,255,255,0.08)", color: "var(--muted)",
                }}>
                  {a.type === "skills" ? "skill" : "rule"}
                </span>
              </td>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/browse.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/pages/Browse.tsx tests/unit/browse.test.tsx
git commit -m "feat: type badge and type filter on Browse"
```

---

### Task 8: InstallModal type-awareness and ArtifactDetail badge

**Files:**
- Modify: `web/components/InstallModal.tsx`
- Modify: `web/pages/ArtifactDetail.tsx:94`
- Test: `tests/unit/install-modal.test.tsx`

**Interfaces:**
- Consumes: `Artifact.type: "skills" | "rules"` (Task 6). Support matrix (Global Constraints): the only invalid combo is Cursor + global + rules.
- Produces: UI only; the backend still enforces the same rule via `agent.supports()`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/install-modal.test.tsx`:

```tsx
const ruleArtifact: Artifact = {
  artifactKey: "src1:ai/rules/style.md", sourceRepoId: "src1", type: "rules",
  name: "style", description: null, rootRelativePath: "ai/rules/style.md",
  files: ["ai/rules/style.md"], lastTouchedSha: "abc", isFavorite: false,
};

describe("InstallModal — rules", () => {
  it("titles itself by artifact type", async () => {
    render(<InstallModal artifact={ruleArtifact} onClose={() => {}} onDone={() => {}} />);
    await waitFor(() => screen.getByText("Install rule"));
  });

  it("disables Cursor and falls back to Claude Code when scope is global", async () => {
    render(<InstallModal artifact={ruleArtifact} onClose={() => {}} onDone={() => {}} />);
    const select = await waitFor(() => screen.getByLabelText("Agent") as HTMLSelectElement);
    expect(select.value).toBe("cursor"); // pre-filled from favoriteAgent
    fireEvent.click(screen.getByText("Global"));
    await waitFor(() => expect((screen.getByLabelText("Agent") as HTMLSelectElement).value).toBe("claude-code"));
    const cursorOption = screen.getByRole("option", { name: /Cursor/ }) as HTMLOptionElement;
    expect(cursorOption.disabled).toBe(true);
  });
});
```

Add `fireEvent` to the imports from `@testing-library/react` at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/install-modal.test.tsx`
Expected: FAIL — title is "Install skill"; Cursor stays selected on Global

- [ ] **Step 3: Implement**

In `web/components/InstallModal.tsx`:

1. Add the combo gate and fallback after the state declarations:

```ts
  const cursorAllowed = !(artifact.type === "rules" && scope === "global");

  useEffect(() => {
    if (!cursorAllowed && agent === "cursor") setAgent("claude-code");
  }, [cursorAllowed, agent]);
```

2. Type-aware copy — title and artifact label:

```tsx
        <h3 style={{ marginTop: 0 }}>Install {artifact.type === "rules" ? "rule" : "skill"}</h3>
        <div className="field">
          <label>{artifact.type === "rules" ? "Rule" : "Skill"}</label>
```

3. Agent select options:

```tsx
            <option value="claude-code">Claude Code</option>
            <option value="cursor" disabled={!cursorAllowed}>
              Cursor{cursorAllowed ? "" : " (no global rules)"}
            </option>
```

In `web/pages/ArtifactDetail.tsx` line 94, replace the badge expression:

```tsx
          {artifact.type === "skills" ? "skill" : artifact.type === "rules" ? "rule" : artifact.type}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/install-modal.test.tsx tests/unit/artifact-detail.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/components/InstallModal.tsx web/pages/ArtifactDetail.tsx tests/unit/install-modal.test.tsx
git commit -m "feat: type-aware install modal with Cursor global-rules gating"
```

---

### Task 9: MCP tool descriptions and final verification

**Files:**
- Modify: `src/mcp/tools.ts:59,143`

**Interfaces:**
- Consumes: everything above. The MCP pipeline is already generic — `search_artifacts` discovers via the type registry, `install_artifact` goes through `installArtifact` which enforces `supports()`.
- Produces: final, verified feature.

- [ ] **Step 1: Update the two `type` parameter descriptions**

In `src/mcp/tools.ts` line 59 (`search_artifacts`):

```ts
      type: z.string().optional().describe("Filter by artifact type: skills or rules"),
```

Line 143 (`list_installs`):

```ts
      type: z.string().optional().describe("Filter by artifact type: skills or rules"),
```

- [ ] **Step 2: Full verification**

Run: `npm test`
Expected: PASS — full suite.

Run: `npm run build`
Expected: both frontend (vite) and backend (tsc) builds succeed with no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/mcp/tools.ts
git commit -m "feat: mention rules in MCP artifact-type filter descriptions"
```
