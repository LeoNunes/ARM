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
