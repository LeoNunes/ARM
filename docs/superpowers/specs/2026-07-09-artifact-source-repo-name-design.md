# Artifact Source: Repo Name Instead of ID — Design

**Date:** 2026-07-09
**Status:** Approved, ready for implementation plan

---

## 1. Goal

The "Source" field shown for artifacts (Browse table, Artifact Detail page) currently renders `sourceRepoId.slice(0, 8)` — the first 8 characters of the skills repo's internal UUID. It reads like a meaningless hash and gives the user no way to identify or reach the actual source repo. It should show the repo's human-readable name instead, linked to that repo's detail page.

Note: `docs/product-specification.md` §4.9 already describes the Artifact Detail header as showing "source repo name" — the current UI is out of sync with the existing spec. This change brings the implementation in line with it; no product-specification.md edits are needed.

---

## 2. Data flow

`DiscoveredArtifact` (and the API's `Artifact` response) currently carries only `sourceRepoId`. The `/api/artifacts` and `/api/artifacts/:artifactKey` handlers already have the full `SkillsRepo[]` list in scope (via `deps.skillsRepos.list()`, used inside `discoverAll`), so each response entry can be enriched with `sourceName: repo.name` before being returned — the same join `notifications.ts` already does (`sourceName: source.name`).

Since artifacts are only ever discovered by iterating over currently-registered `SkillsRepo` records, every artifact's `sourceRepoId` always has a matching repo at request time. No missing-repo fallback is needed.

---

## 3. Backend changes

**`src/api/artifacts.ts`**

- `discoverAll(deps)` changes to also return, or be accompanied by, the repo name per artifact. Simplest approach: build a `Map<string, string>` of `repoId → repo.name` from `deps.skillsRepos.list()` once per request, and map over discovered artifacts to attach `sourceName` alongside the existing `isFavorite` attachment in the list route (`sorted.map((a) => ({ ...a, isFavorite: ..., sourceName: ... }))`).
- Apply the same enrichment in the single-artifact route (`GET /api/artifacts/:artifactKey`).

No changes to `discoverArtifacts`/`DiscoveredArtifact` itself — the enrichment happens at the API boundary, consistent with how `isFavorite` is already attached there rather than inside discovery.

---

## 4. Types

**`web/api.ts`** — `Artifact` interface gains:

```ts
sourceName: string;
```

---

## 5. Frontend changes

| File | Change |
|---|---|
| `web/pages/Browse.tsx` | "Source" cell: `{a.sourceRepoId.slice(0, 8)}` → `<Link to={`/skills-repos/${a.sourceRepoId}`}>{a.sourceName}</Link>` |
| `web/pages/ArtifactDetail.tsx` | "Source: ..." line: same replacement, linking to the repo detail page |

Both pages already import or can import `Link` from `react-router-dom` (already used elsewhere in `Browse.tsx`). Styling matches the existing muted-text treatment used for the current source cell/line.

---

## 6. Testing

- `tests/unit/browse.test.tsx` — update assertions to expect the repo name text and a link to `/skills-repos/:id` instead of the truncated ID substring.
- `tests/unit/artifact-detail.test.tsx` — same update for the "Source:" line.
- `tests/integration/api.test.ts` — if it asserts the shape of `/api/artifacts` or `/api/artifacts/:artifactKey` responses, extend fixtures/assertions to cover `sourceName`.

---

## 7. Out of scope

- Changing `artifactKey` format or `sourceRepoId` itself (internal identifier, unaffected).
- Any change to how SHAs are displayed elsewhere (version dropdown, history table, installed-version links) — those remain SHA-based by design; only the repo-identifying "Source" field changes.
