# Slice 3 — MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Streamable HTTP MCP server at `/mcp` on the same Fastify instance, exposing seven tools that route through existing domain services, plus a Settings page panel for agent wiring.

**Architecture:** A single `McpServer` factory (`createMcpServer(deps)`) in `src/mcp/tools.ts` registers all seven tools; a separate `src/mcp/server.ts` wires stateless Streamable HTTP routes into Fastify (new `McpServer` + `StreamableHTTPServerTransport` per request). Tests use the MCP SDK's in-process `InMemoryTransport` for tool-level coverage and a real server + `fetch` for one HTTP smoke test.

**Tech Stack:** `@modelcontextprotocol/sdk` v1.29.0 (McpServer, StreamableHTTPServerTransport, InMemoryTransport, Client), `zod` (transitively from the SDK), Vitest + React Testing Library.

---

## File map

| Status | Path | Responsibility |
|--------|------|----------------|
| Create | `src/mcp/tools.ts` | `createMcpServer(deps)` — registers all 7 tools |
| Create | `src/mcp/server.ts` | `registerMcpServer(app, deps)` — Fastify POST/GET /mcp routes |
| Modify | `src/server.ts` | Call `registerMcpServer(app, deps)` inside `buildServer` |
| Modify | `src/git/log.ts` | Add `recentShasTouching` for version history in `get_artifact` |
| Create | `tests/integration/mcp.test.ts` | All MCP tool tests (in-process + one HTTP smoke) |
| Modify | `web/pages/Settings.tsx` | Add MCP server panel: status, URL, port editor, copy-snippet buttons |
| Create | `tests/unit/settings-mcp.test.tsx` | Settings MCP panel component tests |

---

## Task 1: Install the MCP SDK

**Files:**
- Modify: `package.json` (via npm install)

- [ ] **Step 1: Install the SDK**

```bash
cd /workspace && npm install @modelcontextprotocol/sdk
```

- [ ] **Step 2: Verify the SDK package is listed**

```bash
node -e "import('@modelcontextprotocol/sdk/server/mcp.js').then(m => console.log('ok', Object.keys(m)))"
```

Expected: prints `ok [ 'McpServer', ... ]`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install @modelcontextprotocol/sdk"
```

---

## Task 2: Add `recentShasTouching` to git/log + write failing tests for list_skills_repositories and list_working_repositories

**Files:**
- Modify: `src/git/log.ts`
- Create: `tests/integration/mcp.test.ts`

- [ ] **Step 1: Add `recentShasTouching` to `src/git/log.ts`**

Open `src/git/log.ts` and append after the existing exports:

```typescript
export interface CommitSummary {
  sha: string;
  date: string;
  subject: string;
}

export async function recentShasTouching(
  repoPath: string,
  ref: string,
  paths: string[],
  limit = 10,
): Promise<CommitSummary[]> {
  if (!paths.length) return [];
  const args = ["log", ref, `-n${limit}`, "--format=%H%x00%ai%x00%s", "--"];
  for (const p of paths) args.push(p);
  const out = (await simpleGit(repoPath).raw(args)).trim();
  if (!out) return [];
  return out.split("\n").map((line) => {
    const [sha, date, ...rest] = line.split("\x00");
    return { sha: sha!, date: date!, subject: rest.join("\x00") };
  });
}
```

- [ ] **Step 2: Create `tests/integration/mcp.test.ts` with test setup + list tool tests**

```typescript
// tests/integration/mcp.test.ts
import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildRegistries } from "../../src/adapters/index.ts";
import { SettingsStore } from "../../src/state/settings.ts";
import { SkillsRepoStore } from "../../src/state/skills-repos.ts";
import { WorkingRepoStore } from "../../src/state/working-repos.ts";
import { InstallsStore } from "../../src/state/installs.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";
import { buildFixtureRepo } from "../helpers/build-fixture-repo.ts";
import { GitClient } from "../../src/git/client.ts";
import { simpleGit } from "simple-git";
import path from "node:path";
import type { ServerDeps } from "../../src/server.ts";
import { createMcpServer } from "../../src/mcp/tools.ts";

async function makeDeps(): Promise<ServerDeps> {
  const stateDir = await tmpDir("skillmgr-mcp-");
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

async function makeMcpClient(deps: ServerDeps) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(deps);
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "1.0.0" }, {});
  await client.connect(clientTransport);
  return { client, server };
}

function parseResult(result: { content: Array<{ type: string; text?: string }> }) {
  const first = result.content[0];
  if (!first || first.type !== "text" || !first.text) throw new Error("no text content");
  return JSON.parse(first.text);
}

async function makeWorkingRepo(): Promise<{ id: string; name: string; path: string; addedAt: string }> {
  const dir = await tmpDir("skillmgr-wr-");
  const sg = simpleGit(dir);
  await sg.init();
  await sg.addConfig("user.email", "a@b");
  await sg.addConfig("user.name", "t");
  await sg.addConfig("commit.gpgsign", "false");
  await sg.commit("seed", [], { "--allow-empty": null });
  return { id: "w1", name: "my-repo", path: dir, addedAt: new Date().toISOString() };
}

// ─── list_skills_repositories ────────────────────────────────────────────────

describe("MCP list_skills_repositories", () => {
  it("returns empty array when no repos registered", async () => {
    const deps = await makeDeps();
    const { client } = await makeMcpClient(deps);
    const result = await client.callTool({ name: "list_skills_repositories", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(parseResult(result)).toEqual([]);
  });

  it("returns registered repos", async () => {
    const deps = await makeDeps();
    const fx = await buildFixtureRepo([
      { message: "init", files: { "ai/skills/foo/SKILL.md": "# Foo\n" } },
    ]);
    const cloneDest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, cloneDest, "main");
    await deps.skillsRepos.add({
      name: "test-src", gitUrl: fx.fileUrl, branch: "main",
      artifactPaths: { skills: ["ai/skills"] }, presetId: null,
      localClonePath: cloneDest, lastFetchedAt: null,
    });
    const { client } = await makeMcpClient(deps);
    const result = await client.callTool({ name: "list_skills_repositories", arguments: {} });
    expect(result.isError).toBeFalsy();
    const repos = parseResult(result);
    expect(repos).toHaveLength(1);
    expect(repos[0].name).toBe("test-src");
  });
});

// ─── list_working_repositories ───────────────────────────────────────────────

describe("MCP list_working_repositories", () => {
  it("returns empty array when none registered", async () => {
    const deps = await makeDeps();
    const { client } = await makeMcpClient(deps);
    const result = await client.callTool({ name: "list_working_repositories", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(parseResult(result)).toEqual([]);
  });

  it("returns registered working repos", async () => {
    const deps = await makeDeps();
    const wr = await makeWorkingRepo();
    await deps.workingRepos.add({ name: wr.name, path: wr.path, addedAt: wr.addedAt });
    const { client } = await makeMcpClient(deps);
    const result = await client.callTool({ name: "list_working_repositories", arguments: {} });
    expect(result.isError).toBeFalsy();
    const repos = parseResult(result);
    expect(repos).toHaveLength(1);
    expect(repos[0].name).toBe("my-repo");
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL (createMcpServer does not exist)**

```bash
cd /workspace && npm test -- tests/integration/mcp.test.ts 2>&1 | head -30
```

Expected: error about missing module `../../src/mcp/tools.ts`

---

## Task 3: Implement `createMcpServer` with list tools

**Files:**
- Create: `src/mcp/tools.ts`

- [ ] **Step 1: Create `src/mcp/tools.ts` with createMcpServer + the two list tools**

```typescript
// src/mcp/tools.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ServerDeps } from "../server.js";
import { discoverArtifacts } from "../discovery/discover.js";
import { readFileAtSha } from "../git/show.js";
import { recentShasTouching } from "../git/log.js";
import { GitClient } from "../git/client.js";
import { installArtifact } from "../engine/install.js";
import { checkForUpdates } from "../engine/update-check.js";
import { checkForDrift } from "../engine/drift-check.js";
import { computeInstallStatus } from "../engine/status.js";
import { AppError } from "../util/errors.js";
import type { AgentId, InstallTarget } from "../state/schema.js";

function toolError(code: string, message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ code, message }) }],
    isError: true as const,
  };
}

async function discoverAll(deps: ServerDeps) {
  const sources = await deps.skillsRepos.list();
  const out = [];
  for (const s of sources) out.push(...(await discoverArtifacts(s, deps.registries.types)));
  return out;
}

export function createMcpServer(deps: ServerDeps): McpServer {
  const server = new McpServer({ name: "skills-manager", version: "0.1.0" });

  server.tool(
    "list_skills_repositories",
    "List all registered skills repositories",
    {},
    async () => {
      const repos = await deps.skillsRepos.list();
      return { content: [{ type: "text" as const, text: JSON.stringify(repos) }] };
    },
  );

  server.tool(
    "list_working_repositories",
    "List all registered working repositories",
    {},
    async () => {
      const repos = await deps.workingRepos.list();
      return { content: [{ type: "text" as const, text: JSON.stringify(repos) }] };
    },
  );

  // remaining tools added in Tasks 5, 7, 9

  return server;
}
```

- [ ] **Step 2: Run the list tool tests — expect PASS**

```bash
cd /workspace && npm test -- tests/integration/mcp.test.ts --reporter=verbose 2>&1 | grep -E "(PASS|FAIL|✓|✗|list_)"
```

Expected: 4 passing tests for list_skills_repositories and list_working_repositories

- [ ] **Step 3: Run the full test suite to verify no regressions**

```bash
cd /workspace && npm test 2>&1 | tail -15
```

Expected: all existing tests pass

- [ ] **Step 4: Commit**

```bash
git add src/git/log.ts src/mcp/tools.ts tests/integration/mcp.test.ts
git commit -m "feat(mcp): add createMcpServer + list_skills/working_repositories tools"
```

---

## Task 4: Write failing tests for search_artifacts, get_artifact, read_artifact_file

**Files:**
- Modify: `tests/integration/mcp.test.ts`

- [ ] **Step 1: Append artifact tool tests to the mcp.test.ts describe blocks**

After the `list_working_repositories` describe block, add:

```typescript
// ─── search_artifacts ────────────────────────────────────────────────────────

describe("MCP search_artifacts", () => {
  async function seedRepo(deps: ServerDeps) {
    const fx = await buildFixtureRepo([
      {
        message: "init",
        files: {
          "ai/skills/foo/SKILL.md": "# Foo\nA foo skill\n",
          "ai/skills/bar/SKILL.md": "# Bar\nA bar skill\n",
        },
      },
    ]);
    const cloneDest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, cloneDest, "main");
    const repo = await deps.skillsRepos.add({
      name: "src", gitUrl: fx.fileUrl, branch: "main",
      artifactPaths: { skills: ["ai/skills"] }, presetId: null,
      localClonePath: cloneDest, lastFetchedAt: null,
    });
    return { fx, repo };
  }

  it("returns all artifacts with no filters", async () => {
    const deps = await makeDeps();
    await seedRepo(deps);
    const { client } = await makeMcpClient(deps);
    const result = await client.callTool({ name: "search_artifacts", arguments: {} });
    expect(result.isError).toBeFalsy();
    const artifacts = parseResult(result);
    expect(artifacts).toHaveLength(2);
  });

  it("filters by query string", async () => {
    const deps = await makeDeps();
    await seedRepo(deps);
    const { client } = await makeMcpClient(deps);
    const result = await client.callTool({ name: "search_artifacts", arguments: { q: "foo" } });
    expect(result.isError).toBeFalsy();
    const artifacts = parseResult(result);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].name).toBe("foo");
  });

  it("filters by sourceRepoId", async () => {
    const deps = await makeDeps();
    const { repo } = await seedRepo(deps);
    const { client } = await makeMcpClient(deps);
    const result = await client.callTool({
      name: "search_artifacts",
      arguments: { sourceRepoId: repo.id },
    });
    expect(result.isError).toBeFalsy();
    expect(parseResult(result)).toHaveLength(2);
  });

  it("returns empty array when sourceRepoId does not match", async () => {
    const deps = await makeDeps();
    await seedRepo(deps);
    const { client } = await makeMcpClient(deps);
    const result = await client.callTool({
      name: "search_artifacts",
      arguments: { sourceRepoId: "nonexistent-id" },
    });
    expect(result.isError).toBeFalsy();
    expect(parseResult(result)).toHaveLength(0);
  });
});

// ─── get_artifact ─────────────────────────────────────────────────────────────

describe("MCP get_artifact", () => {
  it("returns artifact metadata and versionHistory", async () => {
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
    const { client } = await makeMcpClient(deps);
    const artifactKey = `${repo.id}:ai/skills/foo`;
    const result = await client.callTool({ name: "get_artifact", arguments: { artifactKey } });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result);
    expect(data.name).toBe("foo");
    expect(Array.isArray(data.versionHistory)).toBe(true);
    expect(data.versionHistory.length).toBeGreaterThan(0);
    expect(data.versionHistory[0]).toMatchObject({
      sha: expect.stringMatching(/^[0-9a-f]{40}$/),
      subject: expect.any(String),
    });
  });

  it("returns artifact_not_found for unknown key", async () => {
    const deps = await makeDeps();
    const { client } = await makeMcpClient(deps);
    const result = await client.callTool({ name: "get_artifact", arguments: { artifactKey: "bad:key" } });
    expect(result.isError).toBe(true);
    expect(parseResult(result).code).toBe("artifact_not_found");
  });
});

// ─── read_artifact_file ───────────────────────────────────────────────────────

describe("MCP read_artifact_file", () => {
  it("returns file content", async () => {
    const deps = await makeDeps();
    const fx = await buildFixtureRepo([
      { message: "init", files: { "ai/skills/foo/SKILL.md": "# Foo\nContent here\n" } },
    ]);
    const cloneDest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, cloneDest, "main");
    const repo = await deps.skillsRepos.add({
      name: "src", gitUrl: fx.fileUrl, branch: "main",
      artifactPaths: { skills: ["ai/skills"] }, presetId: null,
      localClonePath: cloneDest, lastFetchedAt: null,
    });
    const { client } = await makeMcpClient(deps);
    const artifactKey = `${repo.id}:ai/skills/foo`;
    const result = await client.callTool({
      name: "read_artifact_file",
      arguments: { artifactKey, filePath: "ai/skills/foo/SKILL.md" },
    });
    expect(result.isError).toBeFalsy();
    const text = result.content[0] as { type: string; text: string };
    expect(text.text).toContain("Content here");
  });

  it("returns artifact_not_found for unknown artifactKey", async () => {
    const deps = await makeDeps();
    const { client } = await makeMcpClient(deps);
    const result = await client.callTool({
      name: "read_artifact_file",
      arguments: { artifactKey: "nope:nope", filePath: "x.md" },
    });
    expect(result.isError).toBe(true);
    expect(parseResult(result).code).toBe("artifact_not_found");
  });

  it("returns bad_input when filePath not in artifact", async () => {
    const deps = await makeDeps();
    const fx = await buildFixtureRepo([
      { message: "init", files: { "ai/skills/foo/SKILL.md": "# Foo\n" } },
    ]);
    const cloneDest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, cloneDest, "main");
    const repo = await deps.skillsRepos.add({
      name: "src", gitUrl: fx.fileUrl, branch: "main",
      artifactPaths: { skills: ["ai/skills"] }, presetId: null,
      localClonePath: cloneDest, lastFetchedAt: null,
    });
    const { client } = await makeMcpClient(deps);
    const result = await client.callTool({
      name: "read_artifact_file",
      arguments: { artifactKey: `${repo.id}:ai/skills/foo`, filePath: "ai/skills/foo/notexist.md" },
    });
    expect(result.isError).toBe(true);
    expect(parseResult(result).code).toBe("bad_input");
  });
});
```

- [ ] **Step 2: Run — expect FAIL (tools not registered yet)**

```bash
cd /workspace && npm test -- tests/integration/mcp.test.ts 2>&1 | grep -E "(FAIL|Error|not found)" | head -15
```

Expected: errors about unknown tool `search_artifacts` / `get_artifact` / `read_artifact_file`

---

## Task 5: Implement search_artifacts, get_artifact, read_artifact_file

**Files:**
- Modify: `src/mcp/tools.ts`

- [ ] **Step 1: Add search_artifacts, get_artifact, read_artifact_file to createMcpServer**

In `src/mcp/tools.ts`, replace the `// remaining tools added in Tasks 5, 7, 9` comment with:

```typescript
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
      return { content: [{ type: "text" as const, text: JSON.stringify(filtered) }] };
    },
  );

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
      const versionHistory = await recentShasTouching(repo.localClonePath, repo.branch, artifact.files);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ ...artifact, versionHistory }) }],
      };
    },
  );

  server.tool(
    "read_artifact_file",
    "Read the content of one file within an artifact at a specific SHA",
    {
      artifactKey: z.string(),
      filePath: z.string().describe("Path as it appears in artifact.files"),
      sha: z.string().optional().describe("SHA to read at; defaults to lastTouchedSha"),
    },
    async ({ artifactKey, filePath, sha }) => {
      const all = await discoverAll(deps);
      const artifact = all.find((a) => a.artifactKey === artifactKey);
      if (!artifact) return toolError("artifact_not_found", `artifact not found: ${artifactKey}`);
      if (!artifact.files.includes(filePath)) {
        return toolError("bad_input", `file not in artifact: ${filePath}`);
      }
      const repo = await deps.skillsRepos.get(artifact.sourceRepoId);
      if (!repo) return toolError("artifact_not_found", `source repo not found`);
      const resolvedSha =
        sha ?? artifact.lastTouchedSha ?? (await new GitClient().headSha(repo.localClonePath, repo.branch));
      const content = await readFileAtSha(repo.localClonePath, resolvedSha, filePath);
      return { content: [{ type: "text" as const, text: content }] };
    },
  );

  // remaining tools added in Tasks 7, 9
```

- [ ] **Step 2: Run artifact tool tests — expect PASS**

```bash
cd /workspace && npm test -- tests/integration/mcp.test.ts --reporter=verbose 2>&1 | grep -E "(✓|✗|PASS|FAIL)"
```

Expected: all tests for list_*, search_artifacts, get_artifact, read_artifact_file pass

- [ ] **Step 3: Run full suite for regressions**

```bash
cd /workspace && npm test 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add src/mcp/tools.ts
git commit -m "feat(mcp): add search_artifacts, get_artifact, read_artifact_file tools"
```

---

## Task 6: Write failing tests for list_installs

**Files:**
- Modify: `tests/integration/mcp.test.ts`

- [ ] **Step 1: Append list_installs tests**

After the `read_artifact_file` describe block, add:

```typescript
// ─── list_installs ───────────────────────────────────────────────────────────

describe("MCP list_installs", () => {
  async function seedInstall(deps: ServerDeps) {
    const fx = await buildFixtureRepo([
      { message: "init", files: { "ai/skills/foo/SKILL.md": "# Foo\n" } },
    ]);
    const cloneDest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, cloneDest, "main");
    const repo = await deps.skillsRepos.add({
      name: "src", gitUrl: fx.fileUrl, branch: "main",
      artifactPaths: { skills: ["ai/skills"] }, presetId: null,
      localClonePath: cloneDest, lastFetchedAt: null,
    });
    const wr = await makeWorkingRepo();
    const savedWr = await deps.workingRepos.add({ name: wr.name, path: wr.path, addedAt: wr.addedAt });
    const { agents, types } = deps.registries;
    const { discoverArtifacts } = await import("../../src/discovery/discover.ts");
    const { installArtifact } = await import("../../src/engine/install.ts");
    const artifacts = await discoverArtifacts(repo, types);
    const foo = artifacts.find((a) => a.name === "foo")!;
    const record = await installArtifact({
      artifact: foo, skillsRepo: repo,
      target: { type: "working-repo", workingRepoId: savedWr.id },
      workingRepo: savedWr, agent: agents.get("claude-code"),
      sha: fx.shas[0]!, autoUpdate: false, existingInstallsInTarget: [],
    });
    const install = await deps.installs.add(record);
    return { repo, wr: savedWr, install };
  }

  it("returns empty array when no installs exist", async () => {
    const deps = await makeDeps();
    const { client } = await makeMcpClient(deps);
    const result = await client.callTool({ name: "list_installs", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(parseResult(result)).toEqual([]);
  });

  it("returns installs with status field", async () => {
    const deps = await makeDeps();
    await seedInstall(deps);
    const { client } = await makeMcpClient(deps);
    const result = await client.callTool({ name: "list_installs", arguments: {} });
    expect(result.isError).toBeFalsy();
    const installs = parseResult(result);
    expect(installs).toHaveLength(1);
    expect(installs[0].status).toBe("up-to-date");
  });

  it("filters by workingRepoId", async () => {
    const deps = await makeDeps();
    const { wr } = await seedInstall(deps);
    const { client } = await makeMcpClient(deps);
    const result = await client.callTool({
      name: "list_installs",
      arguments: { workingRepoId: wr.id },
    });
    expect(result.isError).toBeFalsy();
    expect(parseResult(result)).toHaveLength(1);
  });

  it("returns empty when workingRepoId does not match", async () => {
    const deps = await makeDeps();
    await seedInstall(deps);
    const { client } = await makeMcpClient(deps);
    const result = await client.callTool({
      name: "list_installs",
      arguments: { workingRepoId: "nonexistent" },
    });
    expect(result.isError).toBeFalsy();
    expect(parseResult(result)).toHaveLength(0);
  });

  it("filters by agent", async () => {
    const deps = await makeDeps();
    await seedInstall(deps);
    const { client } = await makeMcpClient(deps);

    const ccResult = await client.callTool({
      name: "list_installs",
      arguments: { agent: "claude-code" },
    });
    expect(parseResult(ccResult)).toHaveLength(1);

    const cursorResult = await client.callTool({
      name: "list_installs",
      arguments: { agent: "cursor" },
    });
    expect(parseResult(cursorResult)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL (list_installs not registered)**

```bash
cd /workspace && npm test -- tests/integration/mcp.test.ts 2>&1 | grep -E "(list_installs|FAIL|Error)" | head -10
```

---

## Task 7: Implement list_installs

**Files:**
- Modify: `src/mcp/tools.ts`

- [ ] **Step 1: Add list_installs to createMcpServer**

Replace the `// remaining tools added in Tasks 7, 9` comment with:

```typescript
  server.tool(
    "list_installs",
    "List current installs with status; optional filters: workingRepoId, agent, type",
    {
      workingRepoId: z.string().optional(),
      agent: z.string().optional(),
      type: z.string().optional(),
    },
    async ({ workingRepoId, agent, type }) => {
      const allInstalls = await deps.installs.list();
      const filtered = allInstalls.filter((i) => {
        if (
          workingRepoId &&
          (i.target.type !== "working-repo" || i.target.workingRepoId !== workingRepoId)
        ) {
          return false;
        }
        if (agent && i.agent !== agent) return false;
        if (type && i.artifactType !== type) return false;
        return true;
      });

      const allRepos = await deps.skillsRepos.list();
      const reposById = new Map(allRepos.map((r) => [r.id, r]));
      const allWorkingRepos = await deps.workingRepos.list();
      const workingReposById = new Map(allWorkingRepos.map((r) => [r.id, r]));

      const result = await Promise.all(
        filtered.map(async (install) => {
          const sr = reposById.get(install.sourceRepoId);
          if (!sr) return { ...install, status: "up-to-date", availableSha: null };
          const updateResult = await checkForUpdates(install, sr);
          let isDrifted = false;
          if (install.target.type === "working-repo") {
            const wr = workingReposById.get(install.target.workingRepoId);
            if (wr) {
              const driftResult = await checkForDrift(install, sr, wr.path);
              isDrifted = driftResult.isDrifted;
            }
          }
          const status = computeInstallStatus(updateResult.hasUpdate, isDrifted);
          return { ...install, status, availableSha: updateResult.availableSha };
        }),
      );

      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    },
  );

  // remaining tools added in Task 9
```

- [ ] **Step 2: Run list_installs tests — expect PASS**

```bash
cd /workspace && npm test -- tests/integration/mcp.test.ts --reporter=verbose 2>&1 | grep -E "(list_installs|✓|✗)"
```

- [ ] **Step 3: Run full suite**

```bash
cd /workspace && npm test 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add src/mcp/tools.ts
git commit -m "feat(mcp): add list_installs tool"
```

---

## Task 8: Write failing tests for install_artifact (happy path + all error codes)

**Files:**
- Modify: `tests/integration/mcp.test.ts`

- [ ] **Step 1: Append install_artifact tests**

After the `list_installs` describe block, add:

```typescript
// ─── install_artifact ────────────────────────────────────────────────────────

describe("MCP install_artifact", () => {
  async function seedSource(deps: ServerDeps) {
    const fx = await buildFixtureRepo([
      { message: "init", files: { "ai/skills/foo/SKILL.md": "# Foo\n" } },
    ]);
    const cloneDest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, cloneDest, "main");
    const repo = await deps.skillsRepos.add({
      name: "src", gitUrl: fx.fileUrl, branch: "main",
      artifactPaths: { skills: ["ai/skills"] }, presetId: null,
      localClonePath: cloneDest, lastFetchedAt: null,
    });
    return { fx, repo, artifactKey: `${repo.id}:ai/skills/foo` };
  }

  it("installs an artifact into a working repo (happy path)", async () => {
    const deps = await makeDeps();
    const { artifactKey } = await seedSource(deps);
    const wr = await makeWorkingRepo();
    const savedWr = await deps.workingRepos.add({ name: wr.name, path: wr.path, addedAt: wr.addedAt });
    const { client } = await makeMcpClient(deps);

    const result = await client.callTool({
      name: "install_artifact",
      arguments: {
        artifactKey,
        target: { type: "working-repo", workingRepoId: savedWr.id },
      },
    });

    expect(result.isError).toBeFalsy();
    const install = parseResult(result);
    expect(install.id).toBeDefined();
    expect(install.artifactKey).toBe(artifactKey);
    expect(install.agent).toBe("claude-code"); // defaults to favoriteAgent
  });

  it("defaults agent to settings.favoriteAgent", async () => {
    const deps = await makeDeps();
    await deps.settings.update({ favoriteAgent: "cursor" });
    const { artifactKey } = await seedSource(deps);
    const wr = await makeWorkingRepo();
    const savedWr = await deps.workingRepos.add({ name: wr.name, path: wr.path, addedAt: wr.addedAt });
    const { client } = await makeMcpClient(deps);

    const result = await client.callTool({
      name: "install_artifact",
      arguments: {
        artifactKey,
        target: { type: "working-repo", workingRepoId: savedWr.id },
      },
    });

    expect(result.isError).toBeFalsy();
    expect(parseResult(result).agent).toBe("cursor");
  });

  it("returns already_installed when same triple exists", async () => {
    const deps = await makeDeps();
    const { artifactKey } = await seedSource(deps);
    const wr = await makeWorkingRepo();
    const savedWr = await deps.workingRepos.add({ name: wr.name, path: wr.path, addedAt: wr.addedAt });
    const { client } = await makeMcpClient(deps);
    const target = { type: "working-repo", workingRepoId: savedWr.id };

    // First install
    await client.callTool({ name: "install_artifact", arguments: { artifactKey, target } });
    // Second install of same (artifactKey, target, agent) triple
    const result = await client.callTool({ name: "install_artifact", arguments: { artifactKey, target } });

    expect(result.isError).toBe(true);
    expect(parseResult(result).code).toBe("already_installed");
  });

  it("allows two installs of same artifact for different agents", async () => {
    const deps = await makeDeps();
    const { artifactKey } = await seedSource(deps);
    const wr = await makeWorkingRepo();
    const savedWr = await deps.workingRepos.add({ name: wr.name, path: wr.path, addedAt: wr.addedAt });
    const { client } = await makeMcpClient(deps);
    const target = { type: "working-repo", workingRepoId: savedWr.id };

    const r1 = await client.callTool({
      name: "install_artifact",
      arguments: { artifactKey, target, agent: "claude-code" },
    });
    const r2 = await client.callTool({
      name: "install_artifact",
      arguments: { artifactKey, target, agent: "cursor" },
    });

    expect(r1.isError).toBeFalsy();
    expect(r2.isError).toBeFalsy();
  });

  it("returns working_repo_not_found for unknown workingRepoId", async () => {
    const deps = await makeDeps();
    const { artifactKey } = await seedSource(deps);
    const { client } = await makeMcpClient(deps);

    const result = await client.callTool({
      name: "install_artifact",
      arguments: {
        artifactKey,
        target: { type: "working-repo", workingRepoId: "nonexistent" },
      },
    });

    expect(result.isError).toBe(true);
    expect(parseResult(result).code).toBe("working_repo_not_found");
  });

  it("returns artifact_not_found for unknown artifactKey", async () => {
    const deps = await makeDeps();
    const wr = await makeWorkingRepo();
    const savedWr = await deps.workingRepos.add({ name: wr.name, path: wr.path, addedAt: wr.addedAt });
    const { client } = await makeMcpClient(deps);

    const result = await client.callTool({
      name: "install_artifact",
      arguments: {
        artifactKey: "bad-repo-id:ai/skills/nope",
        target: { type: "working-repo", workingRepoId: savedWr.id },
      },
    });

    expect(result.isError).toBe(true);
    expect(parseResult(result).code).toBe("artifact_not_found");
  });

  it("returns unsupported_combination when agent does not support type×scope", async () => {
    // claude-code does support skills at working-repo; this tests that the engine
    // error is caught and converted — use a global target with a type that is
    // always unsupported to trigger via engine.
    // Easiest: directly mutate the agent registry to register a fake agent
    // that does not support skills at working-repo.
    // Instead, verify via the AppError path: installArtifact throws AppError
    // "unsupported_combination" which the tool handler converts.
    // We can trigger this by stubbing — but since we can't easily stub adapters
    // here, we test through installArtifact engine which already has unit tests
    // for the matrix. We verify the MCP tool converts AppError correctly:
    // seed a case where the engine will throw.
    const deps = await makeDeps();
    const { artifactKey } = await seedSource(deps);
    const wr = await makeWorkingRepo();
    const savedWr = await deps.workingRepos.add({ name: wr.name, path: wr.path, addedAt: wr.addedAt });

    // Patch the claude-code agent to not support skills at working-repo
    const origAgent = deps.registries.agents.get("claude-code");
    const stubbedAgent = { ...origAgent, supports: () => false };
    // Re-register with the stub — AgentRegistry.register overwrites
    deps.registries.agents.register(stubbedAgent);

    const { client } = await makeMcpClient(deps);
    const result = await client.callTool({
      name: "install_artifact",
      arguments: { artifactKey, target: { type: "working-repo", workingRepoId: savedWr.id } },
    });

    expect(result.isError).toBe(true);
    expect(parseResult(result).code).toBe("unsupported_combination");
  });

  it("returns bad_input when workingRepoId missing for working-repo target", async () => {
    const deps = await makeDeps();
    const { artifactKey } = await seedSource(deps);
    const { client } = await makeMcpClient(deps);

    const result = await client.callTool({
      name: "install_artifact",
      // workingRepoId intentionally omitted
      arguments: { artifactKey, target: { type: "working-repo" } },
    });

    expect(result.isError).toBe(true);
    expect(parseResult(result).code).toBe("bad_input");
  });
});
```

- [ ] **Step 2: Run — expect FAIL (install_artifact not registered yet)**

```bash
cd /workspace && npm test -- tests/integration/mcp.test.ts 2>&1 | grep -E "(install_artifact|FAIL|Error)" | head -10
```

---

## Task 9: Implement install_artifact

**Files:**
- Modify: `src/mcp/tools.ts`

- [ ] **Step 1: Add install_artifact to createMcpServer**

Replace `// remaining tools added in Task 9` with:

```typescript
  server.tool(
    "install_artifact",
    "Install an artifact into a target (create-only). Agent defaults to favoriteAgent.",
    {
      artifactKey: z.string(),
      target: z.object({
        type: z.enum(["working-repo", "global"]),
        workingRepoId: z.string().optional(),
      }),
      agent: z.string().optional().describe("claude-code or cursor; defaults to favoriteAgent"),
      sha: z.string().optional().describe("Source SHA to install at; defaults to latest"),
      autoUpdate: z.boolean().optional(),
    },
    async ({ artifactKey, target, agent: agentParam, sha, autoUpdate }) => {
      try {
        const settings = await deps.settings.read();
        const agentId = (agentParam ?? settings.favoriteAgent) as AgentId | undefined;
        if (!agentId) {
          return toolError("agent_not_specified", "No agent specified and no favoriteAgent configured");
        }

        let agent;
        try {
          agent = deps.registries.agents.get(agentId);
        } catch {
          return toolError("bad_input", `unknown agent: ${agentId}`);
        }

        if (target.type === "working-repo" && !target.workingRepoId) {
          return toolError("bad_input", "workingRepoId required for working-repo target");
        }

        const installTarget: InstallTarget =
          target.type === "working-repo"
            ? { type: "working-repo", workingRepoId: target.workingRepoId! }
            : { type: "global" };

        const sources = await deps.skillsRepos.list();
        const [sourceRepoId] = artifactKey.split(":", 1);
        const skillsRepo = sources.find((s) => s.id === sourceRepoId);
        if (!skillsRepo) {
          return toolError("artifact_not_found", `source repo not found: ${sourceRepoId}`);
        }

        const allArtifacts = await discoverArtifacts(skillsRepo, deps.registries.types);
        const artifact = allArtifacts.find((a) => a.artifactKey === artifactKey);
        if (!artifact) return toolError("artifact_not_found", artifactKey);

        let workingRepo;
        if (installTarget.type === "working-repo") {
          workingRepo = await deps.workingRepos.get(installTarget.workingRepoId);
          if (!workingRepo) return toolError("working_repo_not_found", installTarget.workingRepoId);
        }

        const existing = await deps.installs.findExisting(artifactKey, installTarget, agentId);
        if (existing) {
          return toolError("already_installed", `${artifactKey} already installed for ${agentId}`);
        }

        const targetInstalls = workingRepo
          ? await deps.installs.listByWorkingRepo(workingRepo.id)
          : [];
        const resolvedSha = sha ?? artifact.lastTouchedSha;
        if (!resolvedSha) return toolError("bad_input", "could not resolve SHA for artifact");

        const record = await installArtifact({
          artifact, skillsRepo, target: installTarget, workingRepo, agent,
          sha: resolvedSha, autoUpdate: autoUpdate ?? false,
          existingInstallsInTarget: targetInstalls,
        });
        const persisted = await deps.installs.add(record);
        return { content: [{ type: "text" as const, text: JSON.stringify(persisted) }] };
      } catch (err) {
        if (err instanceof AppError) return toolError(err.code, err.message);
        throw err;
      }
    },
  );
```

- [ ] **Step 2: Run install_artifact tests — expect PASS**

```bash
cd /workspace && npm test -- tests/integration/mcp.test.ts --reporter=verbose 2>&1 | grep -E "(install_artifact|✓|✗)"
```

Expected: all install_artifact tests pass

- [ ] **Step 3: Run full test suite**

```bash
cd /workspace && npm test 2>&1 | tail -10
```

Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/mcp/tools.ts
git commit -m "feat(mcp): add install_artifact tool with all error codes"
```

---

## Task 10: HTTP transport integration — registerMcpServer + update server.ts

**Files:**
- Create: `src/mcp/server.ts`
- Modify: `src/server.ts`
- Modify: `tests/integration/mcp.test.ts` (one HTTP smoke test)

- [ ] **Step 1: Add one HTTP smoke test to mcp.test.ts**

At the top of the file, add after the existing imports:

```typescript
import { buildServer } from "../../src/server.ts";
import type { AddressInfo } from "node:net";
```

Then append this describe block after all tool tests:

```typescript
// ─── HTTP transport smoke ─────────────────────────────────────────────────────

describe("MCP HTTP transport", () => {
  it("POST /mcp responds to MCP initialize request", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    await app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = app.server.address() as AddressInfo;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "test", version: "1.0.0" },
          },
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.result?.serverInfo?.name).toBe("skills-manager");
    } finally {
      await app.close();
    }
  });
});
```

- [ ] **Step 2: Run the HTTP smoke test — expect FAIL (registerMcpServer not yet called)**

```bash
cd /workspace && npm test -- tests/integration/mcp.test.ts --reporter=verbose 2>&1 | grep -E "(HTTP transport|FAIL|Error)" | head -10
```

- [ ] **Step 3: Create `src/mcp/server.ts`**

```typescript
// src/mcp/server.ts
import type { FastifyInstance } from "fastify";
import type { ServerDeps } from "../server.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./tools.js";

export function registerMcpServer(app: FastifyInstance, deps: ServerDeps): void {
  app.post("/mcp", async (req, reply) => {
    const server = createMcpServer(deps);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    reply.hijack();
    await transport.handleRequest(req.raw, reply.raw, req.body);
    await server.close();
  });

  app.get("/mcp", async (req, reply) => {
    const server = createMcpServer(deps);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    reply.hijack();
    await transport.handleRequest(req.raw, reply.raw);
    await server.close();
  });

  app.delete("/mcp", async (_req, reply) => {
    reply.code(405).send({ code: "bad_input", message: "stateless mode: sessions not supported" });
  });
}
```

- [ ] **Step 4: Update `src/server.ts` to call registerMcpServer**

In `src/server.ts`, add the import and call:

```typescript
// Add to imports (after existing imports):
import { registerMcpServer } from './mcp/server';

// In buildServer, after registerRoutes(app, deps):
export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerRoutes(app, deps);
  registerMcpServer(app, deps);  // ← add this line
  const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web");
  if (existsSync(webRoot)) {
    await app.register(fastifyStatic, { root: webRoot, prefix: "/", decorateReply: false });
  }
  return app;
}
```

- [ ] **Step 5: Run the HTTP smoke test — expect PASS**

```bash
cd /workspace && npm test -- tests/integration/mcp.test.ts --reporter=verbose 2>&1 | grep -E "(HTTP transport|✓|✗)"
```

- [ ] **Step 6: Run full test suite**

```bash
cd /workspace && npm test 2>&1 | tail -10
```

Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add src/mcp/server.ts src/server.ts tests/integration/mcp.test.ts
git commit -m "feat(mcp): wire Streamable HTTP /mcp routes into Fastify server"
```

---

## Task 11: Settings page MCP panel

**Files:**
- Modify: `web/pages/Settings.tsx`
- Create: `tests/unit/settings-mcp.test.tsx`

- [ ] **Step 1: Write failing Settings MCP panel test**

Create `tests/unit/settings-mcp.test.tsx`:

```typescript
// tests/unit/settings-mcp.test.tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Settings } from "../../web/pages/Settings.tsx";

function makeSettingsMock(overrides: Partial<{ favoriteAgent: string; mcpPort: number }> = {}) {
  const settings = { favoriteAgent: "claude-code", mcpPort: 7747, ...overrides };
  return vi.fn(async (url: string, opts?: RequestInit) => {
    if (url === "/api/settings" && (!opts?.method || opts.method === "GET")) {
      return new Response(JSON.stringify(settings), { status: 200 });
    }
    if (url === "/api/settings" && opts?.method === "PATCH") {
      const body = JSON.parse(opts.body as string);
      return new Response(JSON.stringify({ ...settings, ...body }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
}

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe("Settings MCP panel", () => {
  it("shows 'Running' status", async () => {
    globalThis.fetch = makeSettingsMock();
    render(<Settings />);
    expect(await screen.findByText("Running")).toBeTruthy();
  });

  it("shows the MCP URL with the configured port", async () => {
    globalThis.fetch = makeSettingsMock({ mcpPort: 7747 });
    render(<Settings />);
    expect(await screen.findByText("http://127.0.0.1:7747/mcp")).toBeTruthy();
  });

  it("renders port input with current value", async () => {
    globalThis.fetch = makeSettingsMock({ mcpPort: 7747 });
    render(<Settings />);
    const input = await screen.findByLabelText("MCP port") as HTMLInputElement;
    expect(input.value).toBe("7747");
  });

  it("saves port on Save button click", async () => {
    const mockFetch = makeSettingsMock({ mcpPort: 7747 });
    globalThis.fetch = mockFetch;
    render(<Settings />);
    const input = await screen.findByLabelText("MCP port");
    fireEvent.change(input, { target: { value: "8080" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/settings",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining("8080"),
        }),
      );
    });
  });

  it("renders Claude Code copy-snippet button", async () => {
    globalThis.fetch = makeSettingsMock();
    render(<Settings />);
    const buttons = await screen.findAllByText(/Copy/);
    // At least two Copy buttons (Claude Code + Cursor)
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });

  it("copy button writes JSON snippet to clipboard", async () => {
    globalThis.fetch = makeSettingsMock({ mcpPort: 7747 });
    render(<Settings />);
    const copyButtons = await screen.findAllByText(/Copy/);
    fireEvent.click(copyButtons[0]!);
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('"url": "http://127.0.0.1:7747/mcp"'),
      );
    });
  });
});
```

- [ ] **Step 2: Run — expect FAIL (MCP panel not implemented in Settings)**

```bash
cd /workspace && npm test -- tests/unit/settings-mcp.test.tsx 2>&1 | head -20
```

Expected: test failures about "Running" text not found

- [ ] **Step 3: Implement the MCP panel in `web/pages/Settings.tsx`**

Replace the full content of `web/pages/Settings.tsx` with:

```typescript
// web/pages/Settings.tsx
import { useEffect, useState, useCallback } from "react";
import { api, Settings as SettingsT } from "../api.ts";

export function Settings() {
  const [s, setS] = useState<SettingsT | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [portInput, setPortInput] = useState<string>("");
  const [copied, setCopied] = useState<"claude-code" | "cursor" | null>(null);

  useEffect(() => {
    api.getSettings().then((settings) => {
      setS(settings);
      setPortInput(String(settings.mcpPort));
    });
  }, []);

  const mcpUrl = s ? `http://127.0.0.1:${s.mcpPort}/mcp` : "";

  const copySnippet = useCallback(
    (agent: "claude-code" | "cursor") => {
      if (!s) return;
      const snippet = JSON.stringify(
        { mcpServers: { "skills-manager": { url: mcpUrl } } },
        null,
        2,
      );
      navigator.clipboard.writeText(snippet).then(() => {
        setCopied(agent);
        setTimeout(() => setCopied(null), 2000);
      });
    },
    [s, mcpUrl],
  );

  const savePort = useCallback(async () => {
    const port = parseInt(portInput, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      setError("Port must be a number between 1 and 65535");
      return;
    }
    try {
      const updated = await api.updateSettings({ mcpPort: port });
      setS(updated);
      setPortInput(String(updated.mcpPort));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [portInput]);

  if (!s) return <p>Loading…</p>;

  return (
    <>
      <h2 style={{ marginTop: 0 }}>Settings</h2>

      <div className="card" style={{ maxWidth: 480 }}>
        <div className="field">
          <label>Favorite agent</label>
          <select
            value={s.favoriteAgent}
            onChange={async (e) => {
              try {
                setS(await api.updateSettings({ favoriteAgent: e.target.value as "claude-code" | "cursor" }));
              } catch (err) {
                setError((err as Error).message);
              }
            }}
            style={{ width: "100%" }}
          >
            <option value="claude-code">Claude Code</option>
            <option value="cursor">Cursor</option>
          </select>
        </div>
      </div>

      <h3>MCP Server</h3>
      <div className="card" style={{ maxWidth: 480 }}>
        <div className="field">
          <label>Status</label>
          <span style={{ color: "var(--success, green)" }}>Running</span>
        </div>
        <div className="field">
          <label>URL</label>
          <code>{mcpUrl}</code>
        </div>
        <div className="field">
          <label>Port</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="number"
              aria-label="MCP port"
              value={portInput}
              onChange={(e) => setPortInput(e.target.value)}
              style={{ width: 80 }}
            />
            <button onClick={savePort}>Save</button>
          </div>
        </div>
        <div className="field">
          <label>Claude Code config snippet</label>
          <div>
            <button onClick={() => copySnippet("claude-code")}>
              {copied === "claude-code" ? "Copied!" : "Copy"}
            </button>
            <p style={{ fontSize: 11, color: "var(--muted, #888)", margin: "4px 0 0" }}>
              Paste into <code>~/.claude.json</code> under <code>mcpServers</code>
            </p>
          </div>
        </div>
        <div className="field">
          <label>Cursor config snippet</label>
          <div>
            <button onClick={() => copySnippet("cursor")}>
              {copied === "cursor" ? "Copied!" : "Copy"}
            </button>
            <p style={{ fontSize: 11, color: "var(--muted, #888)", margin: "4px 0 0" }}>
              Paste into <code>~/.cursor/mcp.json</code> under <code>mcpServers</code>
            </p>
          </div>
        </div>
      </div>

      {error && (
        <p style={{ color: "var(--danger, red)", fontSize: 12, marginTop: 8 }}>{error}</p>
      )}
    </>
  );
}
```

- [ ] **Step 4: Run Settings MCP panel tests — expect PASS**

```bash
cd /workspace && npm test -- tests/unit/settings-mcp.test.tsx --reporter=verbose 2>&1 | grep -E "(✓|✗|PASS|FAIL)"
```

Expected: all 6 tests pass

- [ ] **Step 5: Run full test suite**

```bash
cd /workspace && npm test 2>&1 | tail -15
```

Expected: all tests pass

- [ ] **Step 6: Commit and tag**

```bash
git add web/pages/Settings.tsx tests/unit/settings-mcp.test.tsx
git commit -m "feat(web): Settings MCP panel — status, URL, port editor, copy-snippet buttons"
git tag slice-3
```

---

## Self-review against spec

| Requirement | Task |
|---|---|
| Streamable HTTP at `/mcp`, same Fastify instance, 127.0.0.1 only | Task 10 |
| `list_skills_repositories` | Task 3 |
| `list_working_repositories` | Task 3 |
| `search_artifacts` (q/type/sourceRepoId optional) | Task 5 |
| `get_artifact` (metadata + file list + version history) | Task 5 |
| `read_artifact_file` (file content at specific SHA) | Task 5 |
| `list_installs` (workingRepoId/agent/type filters) | Task 7 |
| `install_artifact` (create-only, favoriteAgent default) | Task 9 |
| Error code `artifact_not_found` | Tasks 4, 8 |
| Error code `working_repo_not_found` | Task 8 |
| Error code `unsupported_combination` | Task 8 |
| Error code `agent_not_specified` | Task 9 (handler returns this when agentId is empty) |
| Error code `already_installed` | Task 8 |
| Error code `bad_input` | Tasks 4, 8 |
| All tools route through same domain services | All tool tasks — no parallel impl |
| Settings MCP status + URL | Task 11 |
| Settings port (editable) | Task 11 |
| Copy-snippet Claude Code + Cursor | Task 11 |
| Tests: happy paths per tool | Tasks 2–9 |
| Tests: each error code | Tasks 4, 6, 8 |
| Transport smoke test | Task 10 |
| Commit tagged `slice-3` | Task 11 step 6 |

**Placeholder scan:** No TBD/TODO/similar-to in any step. Each step contains actual code or commands.

**Type consistency check:**
- `createMcpServer(deps: ServerDeps): McpServer` — used identically in tools.ts (definition), mcp.test.ts (import), and server.ts (call).
- `toolError(code, message)` — used only inside tools.ts; return type matches `{ content, isError }`.
- `discoverAll(deps)` — local helper in tools.ts only; not exported.
- `CommitSummary` / `recentShasTouching` — defined in log.ts, imported in tools.ts.
- `parseResult(result)` — helper inside mcp.test.ts only.
