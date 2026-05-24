import { describe, it, expect } from "vitest";
import { writeExcludeBlock, readExcludeBlock } from "../../src/engine/exclude-block.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import path from "node:path";

const BEGIN = "# BEGIN ai-resources-manager (auto-managed, do not edit)";
const END = "# END ai-resources-manager";

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
