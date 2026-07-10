# Artifact Source: Repo Name Instead of ID — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the truncated `sourceRepoId` shown as "Source" on the Browse table and Artifact Detail page with the source repo's human-readable name, linked to that repo's detail page.

**Architecture:** The `/api/artifacts` (list) and `/api/artifacts/:artifactKey` (detail) routes in `src/api/artifacts.ts` already have access to the full `SkillsRepo[]` list. Both routes get a new `sourceName` field on each returned artifact, resolved via a small repo-id-to-name map. The `Artifact` TypeScript type gains `sourceName: string`, and `Browse.tsx` / `ArtifactDetail.tsx` render it as a `<Link to="/skills-repos/:id">` instead of the sliced UUID.

**Tech Stack:** Fastify (backend routes), React + react-router-dom (frontend), Vitest + Testing Library (tests).

## Global Constraints

- Every artifact's `sourceRepoId` always corresponds to a currently-registered `SkillsRepo` at request time (artifacts are only ever discovered by iterating `deps.skillsRepos.list()`) — no missing-repo fallback needed in the resolver.
- No changes to `artifactKey` format, `sourceRepoId` itself, or any SHA-based display (version dropdown, history table, installed-version links) — only the repo-identifying "Source" field changes.
- `docs/product-specification.md` already describes this field as "source repo name" — no product-specification.md edits needed.

---

### Task 1: Backend — resolve `sourceName` on artifact list and detail routes

**Files:**
- Modify: `src/api/artifacts.ts`
- Test: `tests/integration/api.test.ts`

**Interfaces:**
- Produces: every object returned by `GET /api/artifacts` and `GET /api/artifacts/:artifactKey` now includes `sourceName: string` (the matching `SkillsRepo.name`), alongside the existing `sourceRepoId`, `isFavorite`, etc.

- [ ] **Step 1: Write the failing test**

Add this test inside the existing `describe("API /artifacts", ...)` block in `tests/integration/api.test.ts` (after the `"lists artifacts across registered sources"` test, before the closing `});` of that describe block):

```ts
  it("includes sourceName resolved from the registered repo's name", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const fx = await buildFixtureRepo([
      { message: "init", files: { "ai/skills/foo/SKILL.md": "# Foo\n" } },
    ]);
    await app.inject({
      method: "POST", url: "/api/skills-repos",
      payload: { name: "my-skills-repo", gitUrl: fx.fileUrl, branch: "main", artifactPaths: { skills: ["ai/skills"] } },
    });
    const list = await app.inject({ method: "GET", url: "/api/artifacts" });
    const [foo] = list.json();
    expect(foo.sourceName).toBe("my-skills-repo");

    const detail = await app.inject({
      method: "GET", url: `/api/artifacts/${encodeURIComponent(foo.artifactKey)}`,
    });
    expect(detail.json().sourceName).toBe("my-skills-repo");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/api.test.ts -t "includes sourceName"`
Expected: FAIL — `expected undefined to be 'my-skills-repo'`

- [ ] **Step 3: Implement the repo-name resolver and wire it into both routes**

In `src/api/artifacts.ts`, add a helper function after the imports (before `registerArtifactsRoutes`):

```ts
async function repoNameMap(deps: ServerDeps): Promise<Map<string, string>> {
  const repos = await deps.skillsRepos.list();
  return new Map(repos.map((r) => [r.id, r.name]));
}
```

Then update the list route's return statement:

```ts
      const favorites = await deps.favorites.listFavorites();
      const sorted = sortByFavorite(filtered, favorites);
      const repoNames = await repoNameMap(deps);
      return sorted.map((a) => ({
        ...a,
        isFavorite: favorites.has(a.artifactKey),
        sourceName: repoNames.get(a.sourceRepoId)!,
      }));
```

And the detail route:

```ts
  app.get<{ Params: { artifactKey: string } }>("/api/artifacts/:artifactKey", async (req, reply) => {
    const a = (await discoverAll(deps)).find((x) => x.artifactKey === decodeURIComponent(req.params.artifactKey));
    if (!a) return reply.code(404).send({ code: "artifact_not_found" });
    const isFavorite = await deps.favorites.isFavorite(a.artifactKey);
    const repoNames = await repoNameMap(deps);
    return { ...a, isFavorite, sourceName: repoNames.get(a.sourceRepoId)! };
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/api.test.ts`
Expected: PASS (all tests in the file, including the new one)

- [ ] **Step 5: Commit**

```bash
git add src/api/artifacts.ts tests/integration/api.test.ts
git commit -m "feat: resolve sourceName on artifact list and detail routes"
```

---

### Task 2: Frontend — Browse table Source column links to the repo

**Files:**
- Modify: `web/api.ts:31-36` (`Artifact` interface)
- Modify: `web/pages/Browse.tsx:61`
- Test: `tests/unit/browse.test.tsx`

**Interfaces:**
- Consumes: `sourceName: string` field on `Artifact`, produced by Task 1.
- Produces: `Artifact` TypeScript interface now declares `sourceName: string`, consumed by Task 3 as well.

- [ ] **Step 1: Write the failing test**

In `tests/unit/browse.test.tsx`, add `sourceName: "acme-skills",` to both entries in `mockArtifacts`:

```ts
const mockArtifacts = [
  {
    artifactKey: "src1:skills/bravo", sourceRepoId: "src1", sourceName: "acme-skills", type: "skills" as const,
    name: "bravo", description: "Bravo skill.", rootRelativePath: "skills/bravo",
    files: [], lastTouchedSha: "sha1", isFavorite: false,
  },
  {
    artifactKey: "src1:skills/alpha", sourceRepoId: "src1", sourceName: "acme-skills", type: "skills" as const,
    name: "alpha", description: "Alpha skill.", rootRelativePath: "skills/alpha",
    files: [], lastTouchedSha: "sha2", isFavorite: true,
  },
];
```

Then add a new describe block at the end of the file:

```tsx
describe("Browse — source column", () => {
  it("renders the source repo name as a link to the repo detail page", async () => {
    renderBrowse();
    await screen.findByText("alpha");
    const links = screen.getAllByRole("link", { name: "acme-skills" });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/skills-repos/src1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/browse.test.tsx -t "source column"`
Expected: FAIL — no elements found with role "link" and name "acme-skills" (the cell still renders plain text `src1`)

- [ ] **Step 3: Add `sourceName` to the `Artifact` type**

In `web/api.ts`, change:

```ts
export interface Artifact {
  artifactKey: string; sourceRepoId: string; type: "skills";
  name: string; description: string | null;
  rootRelativePath: string; files: string[]; lastTouchedSha: string | null;
  isFavorite: boolean;
}
```

to:

```ts
export interface Artifact {
  artifactKey: string; sourceRepoId: string; sourceName: string; type: "skills";
  name: string; description: string | null;
  rootRelativePath: string; files: string[]; lastTouchedSha: string | null;
  isFavorite: boolean;
}
```

- [ ] **Step 4: Render the Source cell as a link**

In `web/pages/Browse.tsx`, change:

```tsx
              <td style={{ color: "var(--muted)" }}>{a.sourceRepoId.slice(0, 8)}</td>
```

to:

```tsx
              <td style={{ color: "var(--muted)" }}>
                <Link to={`/skills-repos/${a.sourceRepoId}`} style={{ color: "inherit" }}>
                  {a.sourceName}
                </Link>
              </td>
```

(`Link` is already imported at the top of this file.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/browse.test.tsx`
Expected: PASS (all tests in the file)

- [ ] **Step 6: Commit**

```bash
git add web/api.ts web/pages/Browse.tsx tests/unit/browse.test.tsx
git commit -m "feat: link Browse source column to the repo detail page"
```

---

### Task 3: Frontend — Artifact Detail page Source line links to the repo

**Files:**
- Modify: `web/pages/ArtifactDetail.tsx:109-111`
- Test: `tests/unit/artifact-detail.test.tsx`

**Interfaces:**
- Consumes: `sourceName: string` field on `Artifact`, produced by Task 1 and declared in the type by Task 2.

- [ ] **Step 1: Write the failing test**

In `tests/unit/artifact-detail.test.tsx`, add `sourceName: "acme-skills",` to `mockArtifact`:

```ts
const mockArtifact = {
  artifactKey: "src1:skills/foo",
  sourceRepoId: "src1",
  sourceName: "acme-skills",
  type: "skills" as const,
  name: "foo",
  description: "Does foo things.",
  rootRelativePath: "skills/foo",
  files: ["skills/foo/SKILL.md", "skills/foo/helper.sh"],
  lastTouchedSha: "abc1234567890123",
};
```

Then add a new test inside the existing `describe("ArtifactDetail — Header", ...)` block:

```tsx
  it("renders source repo name as a link to the repo detail page", async () => {
    renderDetail();
    const link = await screen.findByRole("link", { name: "acme-skills" });
    expect(link).toHaveAttribute("href", "/skills-repos/src1");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/artifact-detail.test.tsx -t "source repo name"`
Expected: FAIL — no element found with role "link" and name "acme-skills" (the line still renders plain text `src1`)

- [ ] **Step 3: Render the Source line as a link**

In `web/pages/ArtifactDetail.tsx`, change:

```tsx
      <p style={{ color: "var(--muted)", fontSize: 12, marginBottom: 20 }}>
        Source: {artifact.sourceRepoId.slice(0, 8)}
      </p>
```

to:

```tsx
      <p style={{ color: "var(--muted)", fontSize: 12, marginBottom: 20 }}>
        Source: <Link to={`/skills-repos/${artifact.sourceRepoId}`} style={{ color: "inherit" }}>{artifact.sourceName}</Link>
      </p>
```

(`Link` is already imported at the top of this file.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/artifact-detail.test.tsx`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Commit**

```bash
git add web/pages/ArtifactDetail.tsx tests/unit/artifact-detail.test.tsx
git commit -m "feat: link Artifact Detail source line to the repo detail page"
```

---

## Final verification

- [ ] Run the full test suite: `npx vitest run`
- [ ] Expected: all tests PASS, including the three new tests added above.
