# Artifact Detail Page — Design

**Date:** 2026-06-18
**Status:** Approved, ready for implementation plan

---

## 1. Goal

Add a dedicated detail page for each artifact. Users need a single place to inspect an artifact's files at any version, browse its version history, compare versions, and manage all installs of that artifact — without jumping across multiple pages.

---

## 2. Route

```
/artifacts/:artifactKey
```

`artifactKey` is URL-encoded (the key format is `<sourceRepoId>:<relativePath>`).

---

## 3. Entry points

All surfaces that currently show an artifact name gain a link to this page:

| Surface | Change |
|---|---|
| **Browse** | Artifact name cell becomes a `<Link>`. Install button stays in the row. |
| **SkillsRepoDetail** | Artifact name cell in the "Discovered artifacts" table becomes a `<Link>`. |
| **WorkingRepoDetail** | Artifact name cell in the installs table becomes a `<Link>`. |
| **Dashboard new-artifact notifications** | "Dismiss"-only button replaced with two buttons: **View** (navigates to artifact detail) and **Dismiss** (existing behavior). |

---

## 4. Page sections

The page is a single scrollable column with four sections.

### 4.1 Header

- Breadcrumb: `Browse / {artifact name}`
- Artifact name (h2)
- Type badge (e.g., "skill") — visible, makes type explicit for when multiple types exist
- Description (muted text, or "—" if absent)
- Source repo name
- **Install button** — opens the existing `InstallModal`

Type differentiation: for MVP the structure is identical for all artifact types; the type badge distinguishes them. Future artifact types can add type-specific sections without changing the shared structure.

### 4.2 File Viewer

- **Version dropdown** (at top of section) — lists the artifact's version history. Each option shows: `{short SHA} · {date} · {commit subject}`. Default: the artifact's `lastTouchedSha` (latest). Changing the selection re-fetches all file contents at that SHA. The dropdown holds a raw SHA as its value; if a SHA is set (e.g., from clicking an installed version in the Installs section) that is not present in the 20-commit history list, it is shown as a standalone selected option labeled with its short SHA.
- **File picker** (left sidebar, narrow) — lists all files belonging to the artifact. Clicking a file selects it. Selected file highlighted. Same visual pattern as the Diff page's file list.
- **Content area** (right) — raw text in a `<pre>` / monospace block. No syntax highlighting for MVP (supports mixed file types including shell scripts). A small label above shows the selected file's full path.

APIs used (both already exist):
- `GET /api/artifacts/:artifactKey/history` — populates the version dropdown
- `GET /api/artifacts/:artifactKey/files/*?sha=<sha>` — fetches file content

### 4.3 Version History

- Table with columns: **SHA** (7 chars), **Date**, **Commit subject**, **Actions**
- **Cross-link with File Viewer:** clicking a row's SHA updates the File Viewer's version dropdown to that version
- **Compare flow (two-step):** clicking "Compare" on a row marks it (row highlighted); a "Compare with this" button appears on all other rows. Clicking a second row navigates to the existing `/diff` page with `mode=version-vs-version&artifactKey=...&fromSha=...&toSha=...`
- **Limit:** 20 commits (API default), no pagination for MVP

API used (already exists): `GET /api/artifacts/:artifactKey/history?limit=20`

### 4.4 Installs

- Table with columns: **Target** (working repo name or "Global"), **Agent**, **Installed version** (short SHA — clicking navigates the File Viewer above to that version), **Status** (existing `StatusPill`), **Auto-update** (on/off), **Actions**
- Action logic mirrors WorkingRepoDetail exactly:
  - `up-to-date` → Uninstall
  - `update-available` → View diff · Update · Uninstall
  - `drifted` → View drift · Re-apply · Uninstall
  - `update-available+drifted` → View diff · View drift · Disable auto-update · Discard & update · Uninstall
- **Empty state:** "Not installed anywhere" message with a prompt to use the Install button

---

## 5. Backend changes

### New API endpoint

```
GET /api/installs?artifactKey=<key>
```

Returns `InstallWithStatus[]` — all installs for the given artifact key, across all working repos and global installs, with status computed for each (update availability + drift check).

Implementation follows the same pattern as `GET /api/working-repos/:id/installs`, but filters by `artifactKey` instead of `workingRepoId`. For working-repo installs, the working repo path is resolved from `WorkingReposStore` for drift checking. For global installs, drift checking is not applicable — their status is computed from update availability only (status is either `up-to-date` or `update-available`).

### No other backend changes required

All other APIs this page uses already exist.

---

## 6. Frontend changes

| File | Change |
|---|---|
| `web/routes.tsx` | Add route `/artifacts/:artifactKey → <ArtifactDetail />` |
| `web/pages/ArtifactDetail.tsx` | **New file** — full page component |
| `web/api.ts` | Add `listInstallsByArtifact(artifactKey)` and `getArtifact(artifactKey)` client methods |
| `web/pages/Browse.tsx` | Artifact name cell → `<Link to="/artifacts/...">` |
| `web/pages/SkillsRepoDetail.tsx` | Artifact name cell → `<Link to="/artifacts/...">` |
| `web/pages/WorkingRepoDetail.tsx` | Artifact name cell → `<Link to="/artifacts/...">` |
| `web/pages/Dashboard.tsx` | Notification cards: replace single Dismiss with View + Dismiss buttons |

---

## 7. Product specification updates

The following changes to `docs/product-specification.md` are needed:

- **§4.3 Browsing** — note that artifact rows are clickable and lead to an artifact detail page
- **§4.4 Installing** — note that install can also be initiated from the artifact detail page
- **§4.6 Version history and diffs** — update to reflect that version history is surfaced on the artifact detail page (not just as a diff flow)
- **§4.8 Dashboard** — update new-artifact notification description: buttons are now "View" and "Dismiss"
- **New §4.X Artifact detail page** — describe the page and its four sections

---

## 8. Out of scope

- Pagination of version history (20-commit limit is sufficient for MVP)
- Syntax highlighting in the file viewer
- Markdown rendering (keeping raw text to support mixed file types)
- Type-specific sections beyond the type badge (deferred until a second artifact type is added)
