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
