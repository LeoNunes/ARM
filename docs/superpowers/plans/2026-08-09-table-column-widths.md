# Table Column Widths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every table in the app (7 tables across 6 page files) consistent, purposeful column widths — icon/badge/action columns shrink to their content, free-text columns truncate with an ellipsis + hover tooltip, and Description columns keep their existing multi-line clamp.

**Architecture:** Add four shared CSS utility classes to `web/styles/theme.css` (`.col-icon`, `.col-shrink`, `.col-truncate`, `.col-actions-wrap`). Apply them via a `<colgroup>` + `className` on `<col>`/`<th>`/`<td>` in each table, refactoring `Browse.tsx`'s existing ad-hoc inline-style colgroup onto the shared classes first, then extending the same pattern to the other five tables (`WorkingRepos.tsx`, `SkillsRepos.tsx`, `SkillsRepoDetail.tsx`, `WorkingRepoDetail.tsx`, `ArtifactDetail.tsx` ×2 tables).

**Tech Stack:** React 18 + TypeScript, plain HTML `<table>` markup (no table library), Vitest + React Testing Library + jsdom for tests.

## Global Constraints

- No table library is introduced — all tables remain plain HTML `<table>`/`<colgroup>`/`<col>` markup, per the existing codebase convention.
- Shared CSS classes live only in `web/styles/theme.css`; no per-page CSS files are created.
- `.col-truncate` cells always get a `title={fullValue}` attribute so the untruncated value is visible on hover.
- Artifact Description columns keep the existing `.description-clamp` class (4-line clamp, not single-line truncation) — never `.col-truncate`.
- Test command for a single file: `npx vitest run tests/unit/<file>.test.tsx`. Full suite: `npx vitest run`.
- **Spec correction found during planning:** the approved spec (`docs/superpowers/specs/2026-08-09-table-column-widths-design.md`) lists `.col-actions-wrap` with a baked-in `width: 22%`, but the per-table section assigns that column 26% in `WorkingRepoDetail.tsx` and 30% in `ArtifactDetail.tsx`'s Installs table — two different values can't both come from one fixed-width class. Resolution used throughout this plan: `.col-actions-wrap` carries no width (just `vertical-align: top`, needed once a multi-button cell wraps onto multiple lines); the actual percentage is set per table via an inline `style={{ width }}` on the `<col>`, exactly like `.col-truncate` columns already do. This mirrors how `.col-truncate` was already designed (class has no width; width is always per-table/inline) and produces the same visual result the spec intended.

---

### Task 1: Add shared CSS classes and refactor `Browse.tsx` onto them

**Files:**
- Modify: `web/styles/theme.css:22-23` (insert new rules after the existing `.table` rules)
- Modify: `web/pages/Browse.tsx:78-162` (table markup)
- Modify: `tests/unit/browse.test.tsx:91-114` (replace the existing "Browse — column widths" describe block)

**Interfaces:**
- Produces: CSS classes `.col-icon`, `.col-shrink`, `.col-truncate`, `.col-actions-wrap` in `web/styles/theme.css`, consumed by className in every later task.

- [ ] **Step 1: Update the failing test**

Replace the existing `describe("Browse — column widths", ...)` block (lines 91-114 of `tests/unit/browse.test.tsx`) with:

```tsx
describe("Browse — column widths", () => {
  it("gives the favorite-star column a fixed icon width via col-icon", async () => {
    const { container } = renderBrowse();
    await screen.findByText("alpha");
    const cols = container.querySelectorAll("table.table > colgroup > col");
    expect(cols).toHaveLength(6);
    expect(cols[0]).toHaveClass("col-icon");
  });

  it("shrinks the Type and Install columns to fit their content", async () => {
    const { container } = renderBrowse();
    await screen.findByText("alpha");
    const cols = container.querySelectorAll("table.table > colgroup > col");
    expect(cols[2]).toHaveClass("col-shrink");
    expect(cols[5]).toHaveClass("col-shrink");
    const headerRow = container.querySelector("thead tr")!;
    expect(headerRow.children[2]).toHaveClass("col-shrink");
    expect(headerRow.children[5]).toHaveClass("col-shrink");
  });

  it("gives Description the largest share of the row, ahead of Name and Source", async () => {
    const { container } = renderBrowse();
    await screen.findByText("alpha");
    const cols = container.querySelectorAll("table.table > colgroup > col");
    const widths = Array.from(cols).map((c) => (c as HTMLElement).style.width);
    // [favorite, name, type, source, description, install]
    expect(widths[4]).toBe("45%");
    expect(parseFloat(widths[4])).toBeGreaterThan(parseFloat(widths[1]));
    expect(parseFloat(widths[4])).toBeGreaterThan(parseFloat(widths[3]));
  });

  it("truncates the Name and Source cells with an ellipsis and exposes the full value via title", async () => {
    const { container } = renderBrowse();
    await screen.findByText("alpha");
    const rows = container.querySelectorAll("tbody tr");
    const firstRow = rows[0]!;
    const nameCell = firstRow.children[1] as HTMLElement;
    const sourceCell = firstRow.children[3] as HTMLElement;
    expect(nameCell).toHaveClass("col-truncate");
    expect(nameCell).toHaveAttribute("title", "bravo");
    expect(sourceCell).toHaveClass("col-truncate");
    expect(sourceCell).toHaveAttribute("title", "acme-skills");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/browse.test.tsx`
Expected: FAIL — `cols[0]` has no `col-icon` class (current markup uses inline `style={{ width: 32 }}` with no className), and the Name/Source cells have no `col-truncate` class or `title` attribute.

- [ ] **Step 3: Add the shared CSS classes**

In `web/styles/theme.css`, immediately after line 23 (`.table th, .table td { padding: 8px 10px; border-bottom: 1px solid var(--border); text-align: left; }`), insert:

```css
.col-icon { width: 32px; text-align: center; }
.col-shrink { width: 1%; white-space: nowrap; }
.col-truncate { max-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.col-actions-wrap { vertical-align: top; }
```

- [ ] **Step 4: Refactor `Browse.tsx`'s table onto the shared classes**

Replace the `<table className="table">...</table>` block (lines 78-162 of `web/pages/Browse.tsx`) with:

```tsx
      <table className="table">
        <colgroup>
          <col className="col-icon" />
          <col style={{ width: "20%" }} />
          <col className="col-shrink" />
          <col style={{ width: "15%" }} />
          <col style={{ width: "45%" }} />
          <col className="col-shrink" />
        </colgroup>
        <thead>
          <tr>
            <th></th>
            <th>
              <button type="button" className="th-sort" onClick={() => handleSort("name")}>
                Name{sortArrow("name")}
              </button>
            </th>
            <th className="col-shrink">
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
            <th className="col-shrink"></th>
          </tr>
        </thead>
        <tbody>
          {sortedArtifacts.map((a) => (
            <tr key={a.artifactKey}>
              <td className="col-icon">
                <FavoriteStar favorited={a.isFavorite} onToggle={() => handleToggleFavorite(a)} />
              </td>
              <td className="col-truncate" title={a.name}>
                <Link
                  to={`/artifacts?artifactKey=${encodeURIComponent(a.artifactKey)}`}
                  style={{ color: "inherit", textDecoration: "none", fontWeight: 500 }}
                >
                  {a.name}
                </Link>
              </td>
              <td className="col-shrink">
                <span style={{
                  fontSize: 11, padding: "2px 8px", borderRadius: 10,
                  background: "rgba(255,255,255,0.08)", color: "var(--muted)",
                }}>
                  {a.type === "skills" ? "skill" : "rule"}
                </span>
              </td>
              <td className="col-truncate" title={a.sourceName} style={{ color: "var(--muted)" }}>
                <Link
                  to={`/skills-repos/${a.sourceRepoId}`}
                  style={{ color: "inherit", textDecoration: "none" }}
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
              <td className="col-shrink"><button className="btn" onClick={() => setInstalling(a)}>Install</button></td>
            </tr>
          ))}
        </tbody>
      </table>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/browse.test.tsx`
Expected: PASS (all tests in the file, 12+ tests)

- [ ] **Step 6: Commit**

```bash
git add web/styles/theme.css web/pages/Browse.tsx tests/unit/browse.test.tsx
git commit -m "refactor: move Browse table widths onto shared col-* utility classes"
```

---

### Task 2: Apply column widths to `WorkingRepos.tsx`

**Files:**
- Modify: `web/pages/WorkingRepos.tsx:18-29`
- Create: `tests/unit/working-repos.test.tsx`

**Interfaces:**
- Consumes: `.col-truncate`, `.col-shrink` CSS classes from `web/styles/theme.css` (Task 1).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/working-repos.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";
import { WorkingRepos } from "../../web/pages/WorkingRepos.tsx";

afterEach(cleanup);

const repo = { id: "w1", name: "My Repo", path: "/home/dev/very/long/path/to/repo", addedAt: "2024-01-01T00:00:00.000Z" };

vi.mock("../../web/api.ts", () => ({
  api: {
    listWorkingRepos: vi.fn(async () => [repo]),
    deleteWorkingRepo: vi.fn(async () => undefined),
  },
}));

function renderPage() {
  return render(<MemoryRouter><WorkingRepos /></MemoryRouter>);
}

describe("WorkingRepos — column widths", () => {
  it("declares a colgroup with Name and Path sized, and the action column shrunk", async () => {
    const { container } = renderPage();
    await screen.findByText("My Repo");
    const cols = container.querySelectorAll("table.table > colgroup > col");
    expect(cols).toHaveLength(3);
    expect((cols[0] as HTMLElement).style.width).toBe("30%");
    expect((cols[1] as HTMLElement).style.width).toBe("65%");
    expect(cols[2]).toHaveClass("col-shrink");
  });

  it("truncates the Name and Path cells with an ellipsis and exposes the full value via title", async () => {
    const { container } = renderPage();
    await screen.findByText("My Repo");
    const row = container.querySelector("tbody tr")!;
    const nameCell = row.children[0] as HTMLElement;
    const pathCell = row.children[1] as HTMLElement;
    expect(nameCell).toHaveClass("col-truncate");
    expect(nameCell).toHaveAttribute("title", "My Repo");
    expect(pathCell).toHaveClass("col-truncate");
    expect(pathCell).toHaveAttribute("title", repo.path);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/working-repos.test.tsx`
Expected: FAIL — no `<colgroup>` exists yet in `WorkingRepos.tsx`.

- [ ] **Step 3: Apply widths to `WorkingRepos.tsx`**

Replace the `<table className="table">...</table>` block (lines 18-29) with:

```tsx
      <table className="table">
        <colgroup>
          <col style={{ width: "30%" }} />
          <col style={{ width: "65%" }} />
          <col className="col-shrink" />
        </colgroup>
        <thead><tr><th>Name</th><th>Path</th><th></th></tr></thead>
        <tbody>
          {repos.map((r) => (
            <tr key={r.id}>
              <td className="col-truncate" title={r.name}><Link to={`/working-repos/${r.id}`}>{r.name}</Link></td>
              <td className="col-truncate" title={r.path} style={{ color: "var(--muted)" }}>{r.path}</td>
              <td className="col-shrink"><button className="btn secondary" onClick={async () => { await api.deleteWorkingRepo(r.id); reload(); }}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/working-repos.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add web/pages/WorkingRepos.tsx tests/unit/working-repos.test.tsx
git commit -m "feat: size WorkingRepos table columns"
```

---

### Task 3: Apply column widths to `SkillsRepos.tsx`

**Files:**
- Modify: `web/pages/SkillsRepos.tsx:45-62`
- Create: `tests/unit/skills-repos.test.tsx`

**Interfaces:**
- Consumes: `.col-truncate`, `.col-shrink` CSS classes from `web/styles/theme.css` (Task 1).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/skills-repos.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";
import { SkillsRepos } from "../../web/pages/SkillsRepos.tsx";

afterEach(cleanup);

const repo = {
  id: "r1", name: "superpowers", gitUrl: "https://github.com/example/superpowers.git", branch: "main",
  artifactPaths: { skills: ["ai/skills"], rules: ["ai/rules"] },
  presetId: null, localClonePath: "/tmp/r1", lastFetchedAt: null,
};

vi.mock("../../web/api.ts", () => ({
  api: {
    listSkillsRepos: vi.fn(async () => [repo]),
    deleteSkillsRepo: vi.fn(),
  },
}));

function renderPage() {
  return render(<MemoryRouter><SkillsRepos /></MemoryRouter>);
}

describe("SkillsRepos — column widths", () => {
  it("declares a colgroup sizing Name, Git URL, Branch, Skills paths, and Rules paths, with the action column shrunk", async () => {
    const { container } = renderPage();
    await screen.findByText("superpowers");
    const cols = container.querySelectorAll("table.table > colgroup > col");
    expect(cols).toHaveLength(6);
    const widths = Array.from(cols).map((c) => (c as HTMLElement).style.width);
    expect(widths).toEqual(["16%", "28%", "10%", "18%", "18%", ""]);
    expect(cols[5]).toHaveClass("col-shrink");
  });

  it("truncates the free-text cells with an ellipsis and exposes the full value via title", async () => {
    const { container } = renderPage();
    await screen.findByText("superpowers");
    const row = container.querySelector("tbody tr")!;
    const [nameCell, gitUrlCell, branchCell, skillsCell, rulesCell] = Array.from(row.children) as HTMLElement[];
    expect(nameCell).toHaveClass("col-truncate");
    expect(nameCell).toHaveAttribute("title", "superpowers");
    expect(gitUrlCell).toHaveClass("col-truncate");
    expect(gitUrlCell).toHaveAttribute("title", repo.gitUrl);
    expect(branchCell).toHaveClass("col-truncate");
    expect(branchCell).toHaveAttribute("title", "main");
    expect(skillsCell).toHaveClass("col-truncate");
    expect(skillsCell).toHaveAttribute("title", "ai/skills");
    expect(rulesCell).toHaveClass("col-truncate");
    expect(rulesCell).toHaveAttribute("title", "ai/rules");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/skills-repos.test.tsx`
Expected: FAIL — no `<colgroup>` exists yet in `SkillsRepos.tsx`.

- [ ] **Step 3: Apply widths to `SkillsRepos.tsx`**

Replace the `<table className="table">...</table>` block (lines 45-62) with:

```tsx
      <table className="table">
        <colgroup>
          <col style={{ width: "16%" }} />
          <col style={{ width: "28%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "18%" }} />
          <col style={{ width: "18%" }} />
          <col className="col-shrink" />
        </colgroup>
        <thead><tr><th>Name</th><th>Git URL</th><th>Branch</th><th>Skills paths</th><th>Rules paths</th><th></th></tr></thead>
        <tbody>
          {repos.map((r) => {
            const skillsPaths = (r.artifactPaths.skills ?? []).join(", ");
            const rulesPaths = (r.artifactPaths.rules ?? []).join(", ");
            return (
              <tr key={r.id}>
                <td className="col-truncate" title={r.name}><Link to={`/skills-repos/${r.id}`}>{r.name}</Link></td>
                <td className="col-truncate" title={r.gitUrl} style={{ color: "var(--muted)" }}>{r.gitUrl}</td>
                <td className="col-truncate" title={r.branch}>{r.branch}</td>
                <td className="col-truncate" title={skillsPaths}>{skillsPaths}</td>
                <td className="col-truncate" title={rulesPaths}>{rulesPaths}</td>
                <td className="col-shrink">
                  <button className="btn secondary" onClick={() => setEditRepo(r)}>Edit</button>{" "}
                  <button className="btn secondary" onClick={() => remove(r)}>Remove</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/skills-repos.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the pre-existing remove-guard test to confirm no regression**

Run: `npx vitest run tests/unit/skills-repos-remove-guard.test.tsx`
Expected: PASS (1 test) — this file exercises the same page and must still pass unchanged.

- [ ] **Step 6: Commit**

```bash
git add web/pages/SkillsRepos.tsx tests/unit/skills-repos.test.tsx
git commit -m "feat: size SkillsRepos table columns"
```

---

### Task 4: Apply column widths to `SkillsRepoDetail.tsx`

**Files:**
- Modify: `web/pages/SkillsRepoDetail.tsx:78-108`
- Modify: `tests/unit/skills-repo-detail.test.tsx` (append a new describe block)

**Interfaces:**
- Consumes: `.col-icon`, `.col-shrink`, `.col-truncate` CSS classes from `web/styles/theme.css` (Task 1).

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/skills-repo-detail.test.tsx` (after the existing `"SkillsRepoDetail — artifact paths"` describe block):

```tsx
describe("SkillsRepoDetail — column widths", () => {
  it("declares a colgroup with the favorite column fixed-width, Description largest, and Path truncating", async () => {
    const { container } = renderDetail();
    await screen.findByText("alpha");
    const cols = container.querySelectorAll("table.table > colgroup > col");
    expect(cols).toHaveLength(5);
    expect(cols[0]).toHaveClass("col-icon");
    const widths = Array.from(cols).map((c) => (c as HTMLElement).style.width);
    expect(widths[1]).toBe("20%");
    expect(widths[3]).toBe("45%");
    expect(widths[4]).toBe("25%");
    expect(cols[2]).toHaveClass("col-shrink");
  });

  it("truncates the Path cell with an ellipsis and exposes the full value via title", async () => {
    const { container } = renderDetail();
    await screen.findByText("alpha");
    const rows = container.querySelectorAll("tbody tr");
    const pathCell = rows[0]!.children[4] as HTMLElement;
    expect(pathCell).toHaveClass("col-truncate");
    expect(pathCell).toHaveAttribute("title", "skills/bravo");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/skills-repo-detail.test.tsx`
Expected: FAIL — no `<colgroup>` exists yet in `SkillsRepoDetail.tsx`.

- [ ] **Step 3: Apply widths to `SkillsRepoDetail.tsx`**

Replace the `<table className="table">...</table>` block (lines 78-108) with:

```tsx
      <table className="table">
        <colgroup>
          <col className="col-icon" />
          <col style={{ width: "20%" }} />
          <col className="col-shrink" />
          <col style={{ width: "45%" }} />
          <col style={{ width: "25%" }} />
        </colgroup>
        <thead><tr><th></th><th>Name</th><th>Type</th><th>Description</th><th>Path</th></tr></thead>
        <tbody>
          {artifacts.map((a) => (
            <tr key={a.artifactKey}>
              <td className="col-icon">
                <FavoriteStar favorited={a.isFavorite} onToggle={() => handleToggleFavorite(a)} />
              </td>
              <td className="col-truncate" title={a.name}>
                <Link
                  to={`/artifacts?artifactKey=${encodeURIComponent(a.artifactKey)}`}
                  style={{ color: "inherit", textDecoration: "none", fontWeight: 500 }}
                >
                  {a.name}
                </Link>
              </td>
              <td className="col-shrink">{a.type}</td>
              <td style={{ color: "var(--muted)" }}>
                {a.description ? (
                  <div className="description-clamp" title={a.description}>
                    {a.description}
                  </div>
                ) : (
                  "—"
                )}
              </td>
              <td className="col-truncate" title={a.rootRelativePath} style={{ color: "var(--muted)" }}>{a.rootRelativePath}</td>
            </tr>
          ))}
        </tbody>
      </table>
```

Note: this drops the previous hardcoded `style={{ maxWidth: 320 }}` on the description `<div>` — the column's own 45% width now controls how much room the clamp has, matching the Browse table.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/skills-repo-detail.test.tsx`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Commit**

```bash
git add web/pages/SkillsRepoDetail.tsx tests/unit/skills-repo-detail.test.tsx
git commit -m "feat: size SkillsRepoDetail table columns"
```

---

### Task 5: Apply column widths to `WorkingRepoDetail.tsx`

**Files:**
- Modify: `web/pages/WorkingRepoDetail.tsx:76-218`
- Modify: `tests/unit/working-repo-detail.test.tsx` (append a new describe block)

**Interfaces:**
- Consumes: `.col-shrink`, `.col-truncate`, `.col-actions-wrap` CSS classes from `web/styles/theme.css` (Task 1).

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/working-repo-detail.test.tsx` (after the existing `describe("WorkingRepoDetail", ...)` block):

```tsx
describe("WorkingRepoDetail — column widths", () => {
  it("declares a colgroup sizing Skill and the actions column, with the rest shrunk", async () => {
    const { container } = renderDetail();
    await screen.findByText("Status");
    const cols = container.querySelectorAll("table.table > colgroup > col");
    expect(cols).toHaveLength(7);
    const widths = Array.from(cols).map((c) => (c as HTMLElement).style.width);
    expect(widths[0]).toBe("26%");
    expect(widths[6]).toBe("26%");
    [1, 2, 3, 4, 5].forEach((i) => expect(cols[i]).toHaveClass("col-shrink"));
  });

  it("truncates the Skill cell with an ellipsis and exposes the full value via title", async () => {
    const { container } = renderDetail();
    await screen.findByText("Status");
    const rows = container.querySelectorAll("tbody tr");
    const skillCell = rows[0]!.children[0] as HTMLElement;
    expect(skillCell).toHaveClass("col-truncate");
    expect(skillCell).toHaveAttribute("title", "foo");
  });

  it("gives the actions cell the wrap class so multiple buttons flow onto new rows", async () => {
    const { container } = renderDetail();
    await screen.findByText("Status");
    const rows = container.querySelectorAll("tbody tr");
    const actionsCell = rows[0]!.children[6] as HTMLElement;
    expect(actionsCell).toHaveClass("col-actions-wrap");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/working-repo-detail.test.tsx`
Expected: FAIL — no `<colgroup>` exists yet in `WorkingRepoDetail.tsx`.

- [ ] **Step 3: Apply widths to `WorkingRepoDetail.tsx`**

Replace the `<table className="table">...</table>` block (lines 76-218) with (the four conditional button groups inside the actions cell are unchanged from the current file — only the `<colgroup>`, `<th>`, and non-actions `<td>` elements gain classes):

```tsx
      <table className="table">
        <colgroup>
          <col style={{ width: "26%" }} />
          <col className="col-shrink" />
          <col className="col-shrink" />
          <col className="col-shrink" />
          <col className="col-shrink" />
          <col className="col-shrink" />
          <col style={{ width: "26%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>Skill</th>
            <th>Source</th>
            <th>Agent</th>
            <th>Version</th>
            <th>Status</th>
            <th>Auto-update</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((i) => {
            const [, rel] = i.artifactKey.split(":", 2);
            const name = rel?.split("/").pop() ?? rel;
            return (
              <tr key={i.id}>
                <td className="col-truncate" title={name}>
                  <Link
                    to={`/artifacts?artifactKey=${encodeURIComponent(i.artifactKey)}`}
                    style={{ color: "inherit", textDecoration: "none", fontWeight: 500 }}
                  >
                    {name}
                  </Link>
                </td>
                <td className="col-shrink" style={{ color: "var(--muted)" }}>{i.sourceRepoId.slice(0, 8)}</td>
                <td className="col-shrink">{i.agent}</td>
                <td className="col-shrink" style={{ color: "var(--muted)" }}>{i.installedCommitSha.slice(0, 7)}</td>
                <td className="col-shrink"><StatusPill status={i.status} /></td>
                <td className="col-shrink">{i.autoUpdate ? "on" : "off"}</td>
                <td className="col-actions-wrap" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {(i.status === "update-available+drifted") && (
                    <>
                      <Link
                        to={`/diff?mode=installed-vs-latest&installId=${i.id}`}
                        style={{ fontSize: 12, padding: "4px 8px", background: "transparent", color: "var(--muted)", textDecoration: "none", border: "1px solid var(--border)", borderRadius: 4 }}
                      >
                        View diff
                      </Link>
                      <Link
                        to={`/diff?mode=installed-vs-drifted&installId=${i.id}`}
                        style={{ fontSize: 12, padding: "4px 8px", background: "transparent", color: "var(--muted)", textDecoration: "none", border: "1px solid var(--border)", borderRadius: 4 }}
                      >
                        View drift
                      </Link>
                      <button
                        className="btn secondary"
                        style={{ fontSize: 12 }}
                        onClick={async () => {
                          try {
                            await api.updateInstall(i.id, { autoUpdate: false });
                            reload();
                          } catch (err) {
                            alert((err as Error).message);
                          }
                        }}
                      >
                        Disable auto-update
                      </button>
                      <button
                        className="btn secondary"
                        style={{ fontSize: 12 }}
                        onClick={async () => {
                          try {
                            await api.applyInstallUpdate(i.id);
                            reload();
                          } catch (err) {
                            alert((err as Error).message);
                          }
                        }}
                      >
                        Discard & update
                      </button>
                    </>
                  )}
                  {i.status === "update-available" && (
                    <>
                      <Link
                        to={`/diff?mode=installed-vs-latest&installId=${i.id}`}
                        style={{ fontSize: 12, padding: "4px 8px", background: "transparent", color: "var(--muted)", textDecoration: "none", border: "1px solid var(--border)", borderRadius: 4 }}
                      >
                        View diff
                      </Link>
                      <button
                        className="btn secondary"
                        style={{ fontSize: 12 }}
                        onClick={async () => {
                          try {
                            await api.applyInstallUpdate(i.id);
                            reload();
                          } catch (err) {
                            alert((err as Error).message);
                          }
                        }}
                      >
                        Update
                      </button>
                    </>
                  )}
                  {i.status === "drifted" && (
                    <>
                      <Link
                        to={`/diff?mode=installed-vs-drifted&installId=${i.id}`}
                        style={{ fontSize: 12, padding: "4px 8px", background: "transparent", color: "var(--muted)", textDecoration: "none", border: "1px solid var(--border)", borderRadius: 4 }}
                      >
                        View drift
                      </Link>
                      <button
                        className="btn secondary"
                        style={{ fontSize: 12 }}
                        onClick={async () => {
                          try {
                            await api.reapplyInstall(i.id);
                            reload();
                          } catch (err) {
                            alert((err as Error).message);
                          }
                        }}
                      >
                        Re-apply
                      </button>
                    </>
                  )}
                  <button
                    className="btn secondary"
                    onClick={async () => {
                      try {
                        await api.deleteInstall(i.id);
                        reload();
                      } catch (err) {
                        alert((err as Error).message);
                      }
                    }}
                  >
                    Uninstall
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/working-repo-detail.test.tsx`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Commit**

```bash
git add web/pages/WorkingRepoDetail.tsx tests/unit/working-repo-detail.test.tsx
git commit -m "feat: size WorkingRepoDetail table columns"
```

---

### Task 6: Apply column widths to both `ArtifactDetail.tsx` tables

**Files:**
- Modify: `web/pages/ArtifactDetail.tsx:183-230` (Version History table) and `:241-298` (Installs table)
- Modify: `tests/unit/artifact-detail.test.tsx` (append two new describe blocks)

**Interfaces:**
- Consumes: `.col-shrink`, `.col-truncate`, `.col-actions-wrap` CSS classes from `web/styles/theme.css` (Task 1).

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/artifact-detail.test.tsx` (after the existing `"ArtifactDetail — Installs"` describe block):

```tsx
describe("ArtifactDetail — Version History column widths", () => {
  it("declares a colgroup shrinking SHA/Date/action and giving Subject the remaining space", async () => {
    renderDetail();
    await screen.findByText("add retry logic");
    const table = screen.getByText("SHA").closest("table")!;
    const cols = table.querySelectorAll("colgroup > col");
    expect(cols).toHaveLength(4);
    expect(cols[0]).toHaveClass("col-shrink");
    expect(cols[1]).toHaveClass("col-shrink");
    expect((cols[2] as HTMLElement).style.width).toBe("70%");
    expect(cols[3]).toHaveClass("col-shrink");
  });

  it("truncates the Subject cell with an ellipsis and exposes the full value via title", async () => {
    renderDetail();
    await screen.findByText("add retry logic");
    const table = screen.getByText("SHA").closest("table")!;
    const row = table.querySelector("tbody tr")!;
    const subjectCell = row.children[2] as HTMLElement;
    expect(subjectCell).toHaveClass("col-truncate");
    expect(subjectCell).toHaveAttribute("title", "add retry logic");
  });
});

describe("ArtifactDetail — Installs column widths", () => {
  it("declares a colgroup sizing Target and the actions column, with the rest shrunk", async () => {
    renderDetail();
    await screen.findByText("my-repo");
    const table = screen.getByText("Target").closest("table")!;
    const cols = table.querySelectorAll("colgroup > col");
    expect(cols).toHaveLength(6);
    expect((cols[0] as HTMLElement).style.width).toBe("24%");
    [1, 2, 3, 4].forEach((i) => expect(cols[i]).toHaveClass("col-shrink"));
    expect((cols[5] as HTMLElement).style.width).toBe("30%");
  });

  it("truncates the Target cell with an ellipsis and exposes the full value via title", async () => {
    renderDetail();
    await screen.findByText("my-repo");
    const table = screen.getByText("Target").closest("table")!;
    const row = table.querySelector("tbody tr")!;
    const targetCell = row.children[0] as HTMLElement;
    expect(targetCell).toHaveClass("col-truncate");
    expect(targetCell).toHaveAttribute("title", "my-repo");
  });

  it("gives the actions cell the wrap class so multiple buttons flow onto new rows", async () => {
    renderDetail();
    await screen.findByText("my-repo");
    const table = screen.getByText("Target").closest("table")!;
    const row = table.querySelector("tbody tr")!;
    const actionsCell = row.children[5] as HTMLElement;
    expect(actionsCell).toHaveClass("col-actions-wrap");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/artifact-detail.test.tsx`
Expected: FAIL — neither table has a `<colgroup>` yet.

- [ ] **Step 3: Apply widths to the Version History table**

Replace the Version History `<table className="table">...</table>` block (lines 183-230) with:

```tsx
        <table className="table">
          <colgroup>
            <col className="col-shrink" />
            <col className="col-shrink" />
            <col style={{ width: "70%" }} />
            <col className="col-shrink" />
          </colgroup>
          <thead>
            <tr><th>SHA</th><th>Date</th><th>Subject</th><th></th></tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr
                key={h.sha}
                style={{ background: comparingSha === h.sha ? "rgba(255,255,255,0.06)" : "" }}
              >
                <td className="col-shrink">
                  <span
                    style={{ fontFamily: "monospace", fontSize: 12, cursor: "pointer", color: "var(--muted)" }}
                    onClick={() => setSelectedSha(h.sha)}
                    title="View files at this version"
                  >
                    {h.sha.slice(0, 7)}
                  </span>
                </td>
                <td className="col-shrink" style={{ color: "var(--muted)", fontSize: 12 }}>{h.date.slice(0, 10)}</td>
                <td className="col-truncate" title={h.subject} style={{ fontSize: 13 }}>{h.subject}</td>
                <td className="col-shrink">
                  {comparingSha === null ? (
                    <button className="btn secondary" style={{ fontSize: 11 }} onClick={() => setComparingSha(h.sha)}>
                      Compare
                    </button>
                  ) : comparingSha === h.sha ? (
                    <button className="btn secondary" style={{ fontSize: 11 }} onClick={() => setComparingSha(null)}>
                      Cancel
                    </button>
                  ) : (
                    <button
                      className="btn secondary"
                      style={{ fontSize: 11 }}
                      onClick={() => {
                        navigate(
                          `/diff?mode=version-vs-version&artifactKey=${encodeURIComponent(artifactKey)}&fromSha=${comparingSha}&toSha=${h.sha}`
                        );
                      }}
                    >
                      Compare with this
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
```

- [ ] **Step 4: Apply widths to the Installs table**

Replace the Installs `<table className="table">...</table>` block (lines 241-298) with:

```tsx
          <table className="table">
            <colgroup>
              <col style={{ width: "24%" }} />
              <col className="col-shrink" />
              <col className="col-shrink" />
              <col className="col-shrink" />
              <col className="col-shrink" />
              <col style={{ width: "30%" }} />
            </colgroup>
            <thead>
              <tr><th>Target</th><th>Agent</th><th>Installed version</th><th>Status</th><th>Auto-update</th><th></th></tr>
            </thead>
            <tbody>
              {installs.map((i) => {
                const targetName = i.target.type === "working-repo"
                  ? (wrById.get(i.target.workingRepoId)?.name ?? i.target.workingRepoId)
                  : "Global";
                return (
                  <tr key={i.id}>
                    <td className="col-truncate" title={targetName}>{targetName}</td>
                    <td className="col-shrink">{i.agent}</td>
                    <td className="col-shrink">
                      <span
                        style={{ fontFamily: "monospace", fontSize: 12, cursor: "pointer", color: "var(--muted)" }}
                        onClick={() => setSelectedSha(i.installedCommitSha)}
                        title="View files at this version"
                      >
                        {i.installedCommitSha.slice(0, 7)}
                      </span>
                    </td>
                    <td className="col-shrink"><StatusPill status={i.status} /></td>
                    <td className="col-shrink" style={{ fontSize: 12, color: "var(--muted)" }}>{i.autoUpdate ? "on" : "off"}</td>
                    <td className="col-actions-wrap" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {(i.status === "update-available+drifted") && (<>
                        <Link to={`/diff?mode=installed-vs-latest&installId=${i.id}`}
                          style={{ fontSize: 12, padding: "4px 8px", background: "transparent", color: "var(--muted)", textDecoration: "none", border: "1px solid var(--border)", borderRadius: 4 }}>
                          View diff
                        </Link>
                        <Link to={`/diff?mode=installed-vs-drifted&installId=${i.id}`}
                          style={{ fontSize: 12, padding: "4px 8px", background: "transparent", color: "var(--muted)", textDecoration: "none", border: "1px solid var(--border)", borderRadius: 4 }}>
                          View drift
                        </Link>
                        <button className="btn secondary" style={{ fontSize: 12 }} onClick={() => handleDisableAutoUpdate(i.id)}>Disable auto-update</button>
                        <button className="btn secondary" style={{ fontSize: 12 }} onClick={() => handleUpdate(i.id)}>Discard & update</button>
                      </>)}
                      {i.status === "update-available" && (<>
                        <Link to={`/diff?mode=installed-vs-latest&installId=${i.id}`}
                          style={{ fontSize: 12, padding: "4px 8px", background: "transparent", color: "var(--muted)", textDecoration: "none", border: "1px solid var(--border)", borderRadius: 4 }}>
                          View diff
                        </Link>
                        <button className="btn secondary" style={{ fontSize: 12 }} onClick={() => handleUpdate(i.id)}>Update</button>
                      </>)}
                      {i.status === "drifted" && (<>
                        <Link to={`/diff?mode=installed-vs-drifted&installId=${i.id}`}
                          style={{ fontSize: 12, padding: "4px 8px", background: "transparent", color: "var(--muted)", textDecoration: "none", border: "1px solid var(--border)", borderRadius: 4 }}>
                          View drift
                        </Link>
                        <button className="btn secondary" style={{ fontSize: 12 }} onClick={() => handleReapply(i.id)}>Re-apply</button>
                      </>)}
                      <button className="btn secondary" onClick={() => handleUninstall(i.id)}>Uninstall</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/artifact-detail.test.tsx`
Expected: PASS (all tests in the file)

- [ ] **Step 6: Commit**

```bash
git add web/pages/ArtifactDetail.tsx tests/unit/artifact-detail.test.tsx
git commit -m "feat: size both ArtifactDetail table columns"
```

---

### Task 7: Full-suite verification and visual pass

**Files:** none (verification only)

**Interfaces:** none — final check after Tasks 1-6.

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — all test files green, including the six modified/created above and every previously-passing file (no regressions).

- [ ] **Step 2: Type-check the frontend**

Run: `npx tsc -p tsconfig.fe.json --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual visual check**

Run: `npm run dev:fe` (and `npm run dev:be` in a second terminal if the app needs the backend for data). Open each of the 6 pages (`/browse`, `/working-repos`, `/skills-repos`, a skills-repo detail page, a working-repo detail page, an artifact detail page) and confirm columns look right at a typical window width — this is the point where percentages from the spec get hand-tuned if anything looks off, per the user's request to test and adjust visually.

- [ ] **Step 4: Commit any visual tuning adjustments**

If Step 3 prompts width tweaks, edit the relevant `<col style={{ width }}>` values directly (no test changes needed unless the tweaked value is one asserted in a test — update the matching assertion if so), then:

```bash
git add -A
git commit -m "fix: tune table column widths after visual review"
```

If no tweaks are needed, skip this step.
