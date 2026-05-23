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
import type { WorkingRepo } from "../../src/state/schema.ts";
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
  return { client };
}

function parseResult(result: { content: Array<{ type: string; text?: string }> }) {
  const first = result.content[0];
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
