import { describe, it, expect } from "vitest";
import { formatUnifiedDiff } from "../../src/services/unified-diff.ts";

describe("formatUnifiedDiff", () => {
  it("emits a unified hunk for a changed file", () => {
    const out = formatUnifiedDiff(
      [{ path: "SKILL.md", fromContent: "line one\nline two\n", toContent: "line one\nline TWO\n" }],
      { fromLabel: "installed", toLabel: "working-repo" },
    );

    expect(out).toContain("SKILL.md");
    expect(out).toContain("-line two");
    expect(out).toContain("+line TWO");
  });

  it("omits files whose content is identical", () => {
    const out = formatUnifiedDiff(
      [
        { path: "same.md", fromContent: "unchanged\n", toContent: "unchanged\n" },
        { path: "changed.md", fromContent: "before\n", toContent: "after\n" },
      ],
      { fromLabel: "installed", toLabel: "working-repo" },
    );

    expect(out).not.toContain("same.md");
    expect(out).toContain("changed.md");
  });

  it("returns an empty string when nothing changed", () => {
    const out = formatUnifiedDiff(
      [{ path: "same.md", fromContent: "unchanged\n", toContent: "unchanged\n" }],
      { fromLabel: "installed", toLabel: "working-repo" },
    );

    expect(out).toBe("");
  });

  it("marks a file that is missing on the from side as added", () => {
    const out = formatUnifiedDiff(
      [{ path: "new.md", fromContent: null, toContent: "brand new\n" }],
      { fromLabel: "installed", toLabel: "working-repo" },
    );

    expect(out).toContain("new.md (added)");
    expect(out).toContain("+brand new");
  });

  it("marks a file that is missing on the to side as deleted", () => {
    const out = formatUnifiedDiff(
      [{ path: "gone.md", fromContent: "was here\n", toContent: null }],
      { fromLabel: "installed", toLabel: "working-repo" },
    );

    expect(out).toContain("gone.md (deleted)");
    expect(out).toContain("-was here");
  });
});
