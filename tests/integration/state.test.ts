import { describe, it, expect } from "vitest";
import { resolveStateDir } from "../../src/state/paths.ts";
import { JsonStore } from "../../src/state/store.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";
import path from "node:path";

describe("resolveStateDir", () => {
  it("returns an absolute path under the OS user-data dir for 'arm'", () => {
    const dir = resolveStateDir();
    expect(dir).toBeTypeOf("string");
    expect(dir.length).toBeGreaterThan(0);
    expect(dir).toMatch(/arm/i);
  });
});

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
      artifactType: "skills",
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

describe("InstallsStore.update()", () => {
  it("updates fields on an existing install record", async () => {
    const dir = await tmpDir("arm-state-");
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
    const dir = await tmpDir("arm-state-");
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
