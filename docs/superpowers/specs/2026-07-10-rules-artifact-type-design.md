# Rules as an Artifact Type — Design

**Date:** 2026-07-10
**Status:** Approved

## 1. Goal

Add **rules** as a second artifact type alongside skills, end to end: discovery in source repos, browsing, installing to Claude Code and Cursor (with correct per-agent locations and file extensions), updates, drift, uninstall, MCP, and UI. The adapter architecture was built for this; the work is a new `ArtifactTypeAdapter`, agent-adapter support entries, and fixes to the few places that assume "artifact = directory of files".

## 2. Rule semantics

- A **rule** is a **single markdown file** (`.md` or `.mdc`) located directly under a configured rules path in a source repo (non-recursive; subdirectories are ignored).
- `README.md` files (case-insensitive) are skipped during discovery — a folder README is not an installable rule.
- **Name** = filename without extension (e.g. `testing-style.md` → `testing-style`).
- **Description** = the `description:` value from the file's own YAML frontmatter, or null if absent. Reuses the frontmatter parser currently embedded in the skills adapter (extracted to a shared helper).
- `artifactKey` = `<sourceRepoId>:<path/to/file.md>`; `rootRelativePath` = the file's repo-relative path; `files` = `[that one path]`.
- Version history semantics are unchanged: last commit touching the file.

## 3. Agent support matrix and install locations

| | working repo | global |
|---|---|---|
| **Claude Code** | `<repo>/.claude/rules/<file>` | `~/.claude/rules/<file>` |
| **Cursor** | `<repo>/.cursor/rules/<file>` | **not supported** — Cursor user-global rules live in app settings, not files |

- `targetRoot` for rules is the shared rules directory (not a per-artifact subdirectory like skills).
- **Extension mapping** via `mapFileName`, which gains the artifact type as a parameter:
  - Cursor + rules: `*.md` → `*.mdc`
  - Claude Code + rules: `*.mdc` → `*.md`
  - Skills keep existing behavior (Cursor: `CLAUDE.md` → `AGENTS.md`; no extension changes).
- Content is copied as-is; no frontmatter translation (existing out-of-scope rule stands).
- The `unsupported_combination` check in `installArtifact` already gates on `agent.supports(type, scope)`; Cursor's `SUPPORTED` map simply omits `rules: global`.

## 4. Engine adjustments (single-file artifacts)

| File | Problem today | Change |
|---|---|---|
| `src/engine/install.ts` | `relativeToArtifact = sourcePath.slice(rootRelativePath.length + 1)` yields `""` when the artifact **is** the file | When `sourcePath === rootRelativePath`, use `path.basename(sourcePath)` |
| `src/engine/apply-update.ts` | Same slicing pattern (line ~50) | Same fix; `listFilesAtSha` on a file path already returns just that file |
| `src/engine/install.ts` `computeExcludePatterns` | Excludes the parent **directory** — for rules that is the shared `.claude/rules/` / `.cursor/rules/`, which would hide the user's own untracked rules from `git status` | Patterns become per-exact-file for rules installs; stay directory-level for skills. `computeExcludePatterns` input widens to `Pick<Install, "installedFiles" \| "artifactType">`, and all call sites (install, uninstall, apply-update) pass records that carry `artifactType` |
| `src/engine/uninstall.ts` | — | Already safe: removes exact files, then best-effort non-recursive `rmdir` (fails silently when the shared rules dir still has other rules) |

Drift check, update check, notifications, favorites, snapshots, and the SHA-baseline store are all keyed on `artifactKey`/`installedFiles` and need no changes.

## 5. Type and adapter changes

- `src/state/schema.ts`: `ArtifactTypeId = "skills" | "rules"`.
- New `src/adapters/artifact-types/rules.ts` implementing `ArtifactTypeAdapter` per §2; registered in `src/adapters/index.ts`.
- `src/adapters/types.ts`: `mapFileName(fileName: string, type: ArtifactTypeId): string`.
- `src/adapters/agents/claude-code.ts` and `cursor.ts`: add `rules` to `SUPPORTED`, extend `targetRoot`, extend `mapFileName` per §3.
- Shared frontmatter-description helper extracted from the skills adapter (e.g. `src/adapters/artifact-types/frontmatter.ts`) and used by both adapters.

## 6. API and MCP

- No new endpoints. `artifactPaths` is already `Partial<Record<ArtifactTypeId, string[]>>` — widening the union makes `{ rules: [...] }` valid on register/edit.
- MCP: `search_artifacts` and `list_installs` `type` parameter descriptions updated to mention `skills | rules`. `install_artifact` already flows through the engine's `supports()` gate; Cursor+global+rules returns `unsupported_combination`.

## 7. Frontend changes

| File | Change |
|---|---|
| `web/api.ts` | `artifactPaths` type gains `rules?: string[]`; register body likewise |
| `web/components/RegisterSkillsRepoModal.tsx` | Add "Rules paths (comma-separated)" field (default empty); include `rules` in `artifactPaths` when non-empty |
| `web/pages/SkillsRepos.tsx`, `SkillsRepoDetail.tsx` | Show rules paths alongside skills paths |
| `web/pages/Browse.tsx` | Add a **Type** column (badge) and an All / Skills / Rules filter dropdown wired to the existing `type` query param of `/api/artifacts` |
| `web/components/InstallModal.tsx` | Type-aware title ("Install rule" / "Install skill"); when artifact type is `rules` and scope is `global`, the Cursor option is disabled and selection falls back to Claude Code |
| `web/pages/ArtifactDetail.tsx` | Type badge maps `rules` → "rule" (alongside existing `skills` → "skill") |

## 8. Testing

- **Unit:** rules adapter discovery (flat files, README skipped, subdirs ignored, description from frontmatter, `.mdc` accepted); `mapFileName` extension mapping both agents; `computeExcludePatterns` per-file for rules / per-dir for skills.
- **Integration:** install a rule to Claude Code working repo (target path, exclude block contains the exact file, not the dir); install to Cursor working repo (`.md` → `.mdc` rename); Cursor+global rejection; uninstall a rule leaves a sibling installed rule and its exclude entry intact; update + drift flow on a rule.
- Existing skills tests must pass unchanged (skills exclude behavior is untouched).

## 9. Out of scope

- Frontmatter/content translation between Cursor and Claude Code rule formats.
- Legacy `.cursorrules` single-file format.
- Other artifact types (agent files, MCP configs, allowlists).
- Recursive rule discovery under configured paths.
