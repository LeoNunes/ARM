import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildRegistries } from "../../src/adapters/index.ts";
import { SettingsStore } from "../../src/state/settings.ts";
import { SkillsRepoStore } from "../../src/state/skills-repos.ts";
import { WorkingRepoStore } from "../../src/state/working-repos.ts";
import { InstallsStore } from "../../src/state/installs.ts";
import { ArtifactSnapshotsStore } from "../../src/state/artifact-snapshots.ts";
import { DismissedNotificationsStore } from "../../src/state/notifications.ts";
import { ActivityLogStore } from "../../src/state/activity-log.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";
import { buildFixtureRepo } from "../helpers/build-fixture-repo.ts";
import { GitClient } from "../../src/git/client.ts";
import { simpleGit } from "simple-git";
import path from "node:path";
import type { ServerDeps } from "../../src/server.ts";
import type { WorkingRepo } from "../../src/state/schema.ts";
import { createMcpServer } from "../../src/mcp/tools.ts";
import { buildServer } from "../../src/server.ts";
import type { AddressInfo } from "node:net";

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
    snapshots: new ArtifactSnapshotsStore(stateDir),
    dismissed: new DismissedNotificationsStore(stateDir),
    activityLog: new ActivityLogStore(stateDir),
  };
}

async function makeMcpClient(deps: ServerDeps) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(deps);
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "1.0.0" }, {});
  await client.connect(clientTransport);
  return { client };
}

function parseResult(result: unknown) {
  const r = result as { content?: Array<{ type: string; text?: string }> };
  const first = r.content?.[0];
  if (!first || first.type !== "text" || !first.text) throw new Error("no text content");
  return JSON.parse(first.text);
}

async function makeWorkingRepo(): Promise<WorkingRepo> {
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
    const text = (result as { content: Array<{ type: string; text: string }> }).content[0]!;
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

    await client.callTool({ name: "install_artifact", arguments: { artifactKey, target } });
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
    const deps = await makeDeps();
    const { artifactKey } = await seedSource(deps);
    const wr = await makeWorkingRepo();
    const savedWr = await deps.workingRepos.add({ name: wr.name, path: wr.path, addedAt: wr.addedAt });

    // Stub claude-code to not support any combination
    const origAgent = deps.registries.agents.get("claude-code");
    const stubbedAgent = { ...origAgent, supports: () => false };
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
      arguments: { artifactKey, target: { type: "working-repo" } },
    });

    expect(result.isError).toBe(true);
    expect(parseResult(result).code).toBe("bad_input");
  });
});

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
      const body = await res.json() as { result?: { serverInfo?: { name?: string } } };
      expect(body.result?.serverInfo?.name).toBe("skills-manager");
    } finally {
      await app.close();
    }
  });
});
