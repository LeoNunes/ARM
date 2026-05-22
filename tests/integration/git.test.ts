import { describe, it, expect } from "vitest";
import { buildFixtureRepo } from "../helpers/build-fixture-repo.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";
import { GitClient } from "../../src/git/client.ts";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { readFileAtSha } from "../../src/git/show.ts";
import { lastSHATouching, hasCommitsTouching } from "../../src/git/log.ts";

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
