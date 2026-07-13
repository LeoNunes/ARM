# Browse Table: Column Sizing and Sortable Headers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten the Browse table's Type and Install columns to shrink-wrap their content, give Description a visibly larger share of row width, and make the Name/Type/Source headers clickable to sort the table client-side.

**Architecture:** Both changes live entirely in `web/pages/Browse.tsx` (plus one small CSS addition in `web/styles/theme.css` for the sort-button reset). Column widths are set via a `<colgroup>` scoped to this table only — the shared `.table` class in `theme.css` used by five other pages is untouched. Sorting is a `useMemo`-derived array computed from the already-fetched `artifacts` state; no API or backend changes.

**Tech Stack:** React + TypeScript, Vitest + @testing-library/react (jsdom) for tests, plain CSS (no Tailwind/CSS-in-JS).

## Global Constraints

- Do not modify the shared `.table` class in `web/styles/theme.css` in a way that affects `SkillsRepoDetail.tsx`, `WorkingRepos.tsx`, `SkillsRepos.tsx`, `WorkingRepoDetail.tsx`, or `ArtifactDetail.tsx` — all of which reuse it.
- Column widths: favorite-star fixed ~32px, Name 20%, Type `1%` + `white-space: nowrap` (shrink-to-fit), Source 15%, Description 45%, Install `1%` + `white-space: nowrap` (shrink-to-fit).
- Sort UX: click a sortable header (Name, Type, Source) → ascending; click the same header again → descending; click a different sortable header → that column, ascending. Active column shows `▲` (asc) or `▼` (desc) appended to its label. Description and the icon-only columns are not sortable.
- Sorting is client-side (`localeCompare`) over the fetched `artifacts` array; Type sorts by the rendered label (`"skill"`/`"rule"`), not the raw `a.type`; Source sorts by `a.sourceName`.
- Test file: `tests/unit/browse.test.tsx` (existing file, extend it — do not create a parallel test file). Run with `npx vitest run tests/unit/browse.test.tsx`.

---

### Task 1: Column widths — shrink-wrap Type/Install, enlarge Description

**Files:**
- Modify: `web/pages/Browse.tsx:53-108` (the `<table>` element)
- Test: `tests/unit/browse.test.tsx` (add a new `describe` block)

**Interfaces:**
- Consumes: existing `artifacts` state and JSX structure in `Browse` (no changes to props/state shape).
- Produces: no new exports. Task 2 will further edit the same `<thead>` block this task introduces, so keep the column order (favorite, Name, Type, Source, Description, Install) exactly as today.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/browse.test.tsx`, after the existing `describe("Browse — artifact type", ...)` block:

```tsx
describe("Browse — column widths", () => {
  it("declares a colgroup with Type/Install shrink-to-fit and Description the largest column", async () => {
    const { container } = renderBrowse();
    await screen.findByText("alpha");
    const cols = container.querySelectorAll("table.table > colgroup > col");
    expect(cols).toHaveLength(6);
    const widths = Array.from(cols).map((c) => (c as HTMLElement).style.width);
    // [favorite, name, type, source, description, install]
    expect(widths[2]).toBe("1%");
    expect(widths[5]).toBe("1%");
    expect(widths[4]).toBe("45%");
    expect(parseFloat(widths[4])).toBeGreaterThan(parseFloat(widths[1]));
    expect(parseFloat(widths[4])).toBeGreaterThan(parseFloat(widths[3]));
  });

  it("prevents the Type and Install cells from wrapping", async () => {
    const { container } = renderBrowse();
    await screen.findByText("alpha");
    const headerRow = container.querySelector("thead tr")!;
    const typeHeader = headerRow.children[2] as HTMLElement;
    const installHeader = headerRow.children[5] as HTMLElement;
    expect(typeHeader.style.whiteSpace).toBe("nowrap");
    expect(installHeader.style.whiteSpace).toBe("nowrap");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/browse.test.tsx`
Expected: FAIL — no `<colgroup>` exists yet, so `cols` has length 0 and the length/width assertions fail.

- [ ] **Step 3: Implement the column widths**

In `web/pages/Browse.tsx`, replace the `<table className="table">...</table>` block (lines 53-108) with:

```tsx
      <table className="table">
        <colgroup>
          <col style={{ width: 32 }} />
          <col style={{ width: "20%" }} />
          <col style={{ width: "1%" }} />
          <col style={{ width: "15%" }} />
          <col style={{ width: "45%" }} />
          <col style={{ width: "1%" }} />
        </colgroup>
        <thead>
          <tr>
            <th></th>
            <th>Name</th>
            <th style={{ whiteSpace: "nowrap" }}>Type</th>
            <th>Source</th>
            <th>Description</th>
            <th style={{ whiteSpace: "nowrap" }}></th>
          </tr>
        </thead>
        <tbody>
          {artifacts.map((a) => (
            <tr key={a.artifactKey}>
              <td>
                <FavoriteStar favorited={a.isFavorite} onToggle={() => handleToggleFavorite(a)} />
              </td>
              <td>
                <Link
                  to={`/artifacts?artifactKey=${encodeURIComponent(a.artifactKey)}`}
                  style={{ color: "inherit", textDecoration: "none", fontWeight: 500 }}
                >
                  {a.name}
                </Link>
              </td>
              <td style={{ whiteSpace: "nowrap" }}>
                <span style={{
                  fontSize: 11, padding: "2px 8px", borderRadius: 10,
                  background: "rgba(255,255,255,0.08)", color: "var(--muted)",
                }}>
                  {a.type === "skills" ? "skill" : "rule"}
                </span>
              </td>
              <td style={{ color: "var(--muted)" }}>
                <Link
                  to={`/skills-repos/${a.sourceRepoId}`}
                  title={a.sourceName}
                  style={{
                    color: "inherit",
                    textDecoration: "none",
                    display: "inline-block",
                    maxWidth: "100%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    verticalAlign: "bottom",
                  }}
                >
                  {a.sourceName}
                </Link>
              </td>
              <td style={{ color: "var(--muted)" }}>
                {a.description ? (
                  <div className="description-clamp" title={a.description}>
                    {a.description}
                  </div>
                ) : (
                  "—"
                )}
              </td>
              <td style={{ whiteSpace: "nowrap" }}><button className="btn" onClick={() => setInstalling(a)}>Install</button></td>
            </tr>
          ))}
        </tbody>
      </table>
```

Note what changed from the original: added the `<colgroup>`; added `whiteSpace: "nowrap"` to the Type and Install header/data cells; changed the Source link's `maxWidth` from a fixed `200` to `"100%"` (so it fills whatever the 15% column gives it); removed the Description div's fixed `maxWidth: 320` (so it fills the 45% column instead).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/browse.test.tsx`
Expected: PASS (all tests, including the two new ones, and the 5 pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add web/pages/Browse.tsx tests/unit/browse.test.tsx
git commit -m "feat: shrink-wrap Type/Install columns and enlarge Description in Browse table"
```

---

### Task 2: Sortable Name/Type/Source headers

**Files:**
- Modify: `web/pages/Browse.tsx` (add sort state, a memoized sorted array, and clickable headers — builds on Task 1's `<thead>`/`<tbody>`)
- Modify: `web/styles/theme.css` (add a `.th-sort` button-reset class)
- Test: `tests/unit/browse.test.tsx` (add a new `describe` block)

**Interfaces:**
- Consumes: `Artifact` type from `web/api.ts` (`name: string`, `type: "skills" | "rules"`, `sourceName: string`); the `artifacts` state from Task 1.
- Produces: no new exports; `sortedArtifacts` (local `const`) replaces `artifacts` as the source for `tbody.map(...)`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/browse.test.tsx`, after the `describe("Browse — column widths", ...)` block. First add this helper near the top of the file, right after the `renderBrowse` function:

```tsx
function nameOrder(container: HTMLElement) {
  return Array.from(container.querySelectorAll('a[href^="/artifacts?"]')).map((el) => el.textContent);
}
```

Then add the sorting tests:

```tsx
describe("Browse — sorting", () => {
  it("defaults to the order returned by the API (unsorted)", async () => {
    const { container } = renderBrowse();
    await screen.findByText("alpha");
    expect(nameOrder(container)).toEqual(["bravo", "alpha", "style"]);
  });

  it("sorts by Name ascending on first click and descending on second click", async () => {
    const { container } = renderBrowse();
    await screen.findByText("alpha");

    fireEvent.click(screen.getByRole("button", { name: /^Name/ }));
    expect(nameOrder(container)).toEqual(["alpha", "bravo", "style"]);
    expect(screen.getByRole("button", { name: "Name ▲" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Name/ }));
    expect(nameOrder(container)).toEqual(["style", "bravo", "alpha"]);
    expect(screen.getByRole("button", { name: "Name ▼" })).toBeTruthy();
  });

  it("sorts by Type ascending, using the rendered label and a stable order within ties", async () => {
    const { container } = renderBrowse();
    await screen.findByText("alpha");
    fireEvent.click(screen.getByRole("button", { name: /^Type/ }));
    // "rule" < "skill"; the two skills (bravo, alpha) keep their original relative order.
    expect(nameOrder(container)).toEqual(["style", "bravo", "alpha"]);
  });

  it("sorts by Source ascending using the source display name", async () => {
    const { api } = await import("../../web/api.ts");
    vi.mocked(api.listArtifacts).mockResolvedValueOnce([
      { ...mockArtifacts[0], sourceName: "zeta-skills" },
      { ...mockArtifacts[1], sourceName: "acme-skills" },
      { ...mockArtifacts[2], sourceName: "middle-skills" },
    ]);
    const { container } = renderBrowse();
    await screen.findByText("alpha");
    fireEvent.click(screen.getByRole("button", { name: /^Source/ }));
    expect(nameOrder(container)).toEqual(["alpha", "style", "bravo"]);
  });

  it("switching to a different sortable column resets direction to ascending", async () => {
    const { container } = renderBrowse();
    await screen.findByText("alpha");
    fireEvent.click(screen.getByRole("button", { name: /^Name/ })); // asc
    fireEvent.click(screen.getByRole("button", { name: /^Name/ })); // desc
    fireEvent.click(screen.getByRole("button", { name: /^Type/ })); // switch column -> asc
    expect(screen.getByRole("button", { name: "Type ▲" })).toBeTruthy();
    expect(nameOrder(container)).toEqual(["style", "bravo", "alpha"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/browse.test.tsx`
Expected: FAIL — there are no `role="button"` elements named "Name"/"Type"/"Source" yet (headers are plain text), so every `getByRole("button", { name: /^Name/ })`-style lookup throws.

- [ ] **Step 3: Implement sorting**

In `web/pages/Browse.tsx`:

1. Update the import line to add `useMemo`:

```tsx
import { useEffect, useMemo, useState } from "react";
```

2. Add sort state right after the existing `useState` declarations (after the `installing` state, before the first `useEffect`):

```tsx
  const [sortKey, setSortKey] = useState<"name" | "type" | "source" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
```

3. Add the sort handler and memoized sorted array right after `handleToggleFavorite` (before the `return`):

```tsx
  const handleSort = (key: "name" | "type" | "source") => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sortArrow = (key: "name" | "type" | "source") =>
    sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  const sortedArtifacts = useMemo(() => {
    if (!sortKey) return artifacts;
    const dir = sortDir === "asc" ? 1 : -1;
    const valueOf = (a: Artifact) => {
      if (sortKey === "name") return a.name;
      if (sortKey === "type") return a.type === "skills" ? "skill" : "rule";
      return a.sourceName;
    };
    return [...artifacts].sort((a, b) => valueOf(a).localeCompare(valueOf(b)) * dir);
  }, [artifacts, sortKey, sortDir]);
```

4. Replace the `<thead>` block (written in Task 1) with:

```tsx
        <thead>
          <tr>
            <th></th>
            <th>
              <button type="button" className="th-sort" onClick={() => handleSort("name")}>
                Name{sortArrow("name")}
              </button>
            </th>
            <th style={{ whiteSpace: "nowrap" }}>
              <button type="button" className="th-sort" onClick={() => handleSort("type")}>
                Type{sortArrow("type")}
              </button>
            </th>
            <th>
              <button type="button" className="th-sort" onClick={() => handleSort("source")}>
                Source{sortArrow("source")}
              </button>
            </th>
            <th>Description</th>
            <th style={{ whiteSpace: "nowrap" }}></th>
          </tr>
        </thead>
```

5. Change `{artifacts.map((a) => (` to `{sortedArtifacts.map((a) => (` in the `<tbody>`.

6. In `web/styles/theme.css`, add this rule after the existing `.description-clamp` block:

```css
.th-sort {
  background: none;
  border: none;
  font: inherit;
  color: inherit;
  padding: 0;
  cursor: pointer;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/browse.test.tsx`
Expected: PASS (all tests, including the 5 sorting tests, the 2 column-width tests from Task 1, and the 5 pre-existing tests — 12 total).

- [ ] **Step 5: Commit**

```bash
git add web/pages/Browse.tsx web/styles/theme.css tests/unit/browse.test.tsx
git commit -m "feat: make Browse table sortable by Name, Type, and Source"
```

---

## Final verification

- [ ] Run the full test suite to confirm no other test relying on `.table`/`Browse.tsx` regressed:

Run: `npx vitest run`
Expected: all test files pass.
