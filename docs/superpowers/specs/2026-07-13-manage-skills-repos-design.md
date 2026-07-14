# Managing Registered Skills Repositories — Design

> Adds the ability to modify already-registered skills (artifact source) repositories: rename, add/remove artifact paths per type, and remove the whole repo. Realizes the product-spec promise (§ "Edit, refresh … and remove registered skills repositories") that is currently only partially met (remove exists but is unguarded; edit does not exist).

Date: 2026-07-13.
Status: approved through brainstorming; ready to translate into an implementation plan.

---

## 1. Goals

- **Rename** a registered repo. Purely cosmetic — no behavior change, because installs key off `sourceRepoId`, never the name.
- **Add** artifact paths (skills and/or rules). Newly discoverable artifacts are seeded silently as "existing" so they do not fire new-artifact notifications — matching how registering a repo behaves.
- **Remove** artifact paths, and **remove** the whole repo. Both are **guarded**: blocked if any artifact originating from the affected path/repo is currently installed anywhere (working-repo **or** global install). When blocked, the blocking artifacts are listed with links to their artifact detail pages, and nothing is changed.
- On a **successful** removal, purge all state related to the removed path/repo, as if it had never existed.

## 2. Non-goals

- MCP tool coverage for edit/remove (the MCP surface is out of scope for this slice; only the REST API + web UI change).
- Changing the git URL or branch of a registered repo (would require re-cloning; out of scope).
- Editing working repos (separate concern).

## 2a. Known limitation — overlapping path strings across types

Path-based blocking and purge are type-agnostic, because `artifactKey` carries no artifact type. If a user configures the **same directory string** for both `skills` and `rules` (an unusual configuration), removing one type's path will (a) block on the sibling type's installs under that directory — the safe direction, and (b) on a successful removal, purge the sibling type's favorites/snapshot/dismissed entries under that directory. No installs and no on-disk files are ever affected. This is inherent to the artifactKey model and accepted for this slice.

## 3. Key facts about the existing system

- `artifactKey` = `` `${sourceRepoId}:${rootRelativePath}` `` and `rootRelativePath` = `` `${configuredPath}/${name-or-filename}` `` for both the skills and rules adapters. Therefore an install originates from configured path `P` (of repo `id`) **iff** `install.sourceRepoId === id` and the install's `rootRelativePath` starts with `` `${P}/` ``.
- `SkillsRepoStore.update(id, patch)` already exists and applies a partial patch. No PATCH **route** is exposed yet.
- `DELETE /api/skills-repos/:id` already exists but performs **no** install check — it removes the clone and the entry unconditionally. This route is tightened by this design.
- State stores keyed by repo/artifact:
  - `favorites.json` — `Record<artifactKey, true>`.
  - `artifact-snapshots.json` — `Record<sourceRepoId, artifactKey[]>`.
  - `artifact-sha-baseline.json` — `Record<`` `${sourceRepoId}:${artifactKey}` ``, sha>`.
  - `dismissed-notifications.json` — `Record<key, true>`, where key = `` `newArtifact:${sourceRepoId}:${artifactKey}:${sha}` `` or `` `updatedArtifact:${sourceRepoId}:${artifactKey}:${sha}` ``.
  - `installs.json` — never needs cleanup here: an install's existence blocks removal.

## 4. Backend

### 4.1 `PATCH /api/skills-repos/:id` (new route — rename + path edits)

Body (all fields optional; at least one required):

```jsonc
{
  "name": "new display name",
  "artifactPaths": { "skills": ["ai/skills"], "rules": ["ai/rules"] }
}
```

Semantics — the handler treats `artifactPaths` as the **desired full set** per type (same shape the Register modal already sends), and diffs it against the current repo:

1. Load the repo (404 `skills_repo_not_found` if missing).
2. If `artifactPaths` is present, for each type compute:
   - **removed paths** = present in current, absent in desired.
   - **added paths** = present in desired, absent in current.
3. **Guard removed paths.** For every removed path, find blocking installs: `sourceRepoId === id` and `installRootRelativePath(install).startsWith(`` `${path}/` ``)`. If any removed path has blockers, respond `409`:

   ```jsonc
   {
     "code": "paths_in_use",
     "blockers": [
       { "type": "skills", "path": "ai/skills",
         "artifacts": [ { "artifactKey": "…:ai/skills/foo", "name": "foo" } ] }
     ]
   }
   ```

   No changes are written (all-or-nothing across the whole patch).
4. Apply `name` and/or `artifactPaths` via `SkillsRepoStore.update`.
5. **Seed added paths silently.** For each added path, discover artifacts under just that path (a targeted call using the type adapter's `discoverAt`, or `discoverArtifacts` on the updated repo filtered to the new keys) and `snapshots.addToSnapshot(id, newKeys)`. This prevents the next refresh from surfacing them as new-artifact notifications.
6. **Purge state for removed paths** (paths that passed the guard) by prefix — no key enumeration needed (see § 4.3). The artifactKey prefix for a removed path is `` `${id}:${path}/` ``.
7. Return the updated repo (200).

`installRootRelativePath(install)` derives the path from `install.artifactKey` by stripping the `` `${sourceRepoId}:` `` prefix (everything after the first `:`).

Rename-only patches skip all path logic and just write `name`.

### 4.2 `DELETE /api/skills-repos/:id` (tightened)

1. Load the repo (404 if missing).
2. Find blocking installs: any `install.sourceRepoId === id`. If any, respond `409`:

   ```jsonc
   {
     "code": "repo_in_use",
     "blockers": [ { "artifactKey": "…:ai/skills/foo", "name": "foo" } ]
   }
   ```

   Nothing removed.
3. Otherwise: purge all repo state (§ 4.3), remove the clone (`removeClone`), remove the entry (`skillsRepos.remove`), return 204.

### 4.3 State purge helpers

Blocker `name` is derived from the artifactKey's last path segment (reuse the existing `artifactDisplayName(artifactKey)` helper in `src/api/installs.ts` — extract it to a shared util). No re-discovery is needed to name a blocker, so blockers list correctly even if the artifact is no longer on disk.

Both repo purge and path purge are prefix/substring based over the existing JSON, so the same small set of store methods serves both. Each is a filter-and-write:

- `FavoritesStore.removeByKeyPrefix(prefix)` — drop keys starting with `prefix`.
  - repo purge: `` `${sourceRepoId}:` `` · path purge: `` `${sourceRepoId}:${path}/` ``.
- `ArtifactSnapshotsStore.removeRepo(sourceRepoId)` — delete the whole entry (repo purge).
- `ArtifactSnapshotsStore.removeByKeyPrefix(sourceRepoId, keyPrefix)` — drop array members starting with `keyPrefix` (path purge, keyPrefix = `` `${sourceRepoId}:${path}/` ``).
- `ArtifactShaBaselineStore.removeByKeyPrefix(prefix)` — drop keys starting with `prefix`. Baseline keys are `` `${sourceRepoId}:${artifactKey}` `` = `` `${sourceRepoId}:${sourceRepoId}:${rootRelativePath}` ``, so repo purge uses `` `${sourceRepoId}:` `` and path purge uses `` `${sourceRepoId}:${sourceRepoId}:${path}/` ``.
- `DismissedNotificationsStore.removeBySubstring(substr)` — drop keys containing `substr`. Dismissed keys are `` `<kind>:${sourceRepoId}:${artifactKey}:${sha}` ``, so repo purge uses `` `:${sourceRepoId}:` `` and path purge uses `` `:${sourceRepoId}:${path}/` ``.

Two thin orchestrators in the skills-repos API module (or a small `src/engine/purge.ts`):

- `purgeRepoState(deps, sourceRepoId)` — applies the repo-purge prefixes/substring above.
- `purgePathState(deps, sourceRepoId, path)` — applies the path-purge prefixes/substring above.

## 5. Frontend

### 5.1 `EditSkillsRepoModal` (new component)

Mirrors `RegisterSkillsRepoModal`'s fields, pre-filled from the repo: Name, Skills paths (comma-separated), Rules paths (comma-separated). Git URL and Branch are shown read-only (not editable in this slice). On **Save** → `api.updateSkillsRepo(id, { name, artifactPaths })`.

- On `409 paths_in_use`: render blockers inline and keep the modal open — for each blocked path: "Can't remove `<path>` — still installed:" followed by artifact links to `` `/artifacts?artifactKey=${encodeURIComponent(k)}` ``. The user can restore the path text and save the rest.
- Opened from an **Edit** button on both `SkillsRepos.tsx` (list row) and `SkillsRepoDetail.tsx`.

### 5.2 Remove repo (guarded)

The existing "Remove" buttons on the list page and detail page now handle `409 repo_in_use`: instead of a bare failure, show the blocking artifacts as links (a small inline panel / confirm block, replacing the current `await api.deleteSkillsRepo(...)` one-liner). Removal proceeds only when unblocked.

### 5.3 `web/api.ts`

- Add `updateSkillsRepo(id, patch: { name?: string; artifactPaths?: { skills?: string[]; rules?: string[] } })` → `PATCH /api/skills-repos/:id`.
- `deleteSkillsRepo` already exists; callers must now surface the 409 body (`code`, `blockers`). The shared `req` helper already attaches `code` and parsed error body to the thrown error; blockers need to be read from the response, so `deleteSkillsRepo`/`updateSkillsRepo` callers read `err` — extend the thrown error to carry `blockers` (attach the parsed body in `req`).

## 6. Error handling

- All guards are all-or-nothing: a `409` means **zero** state mutated.
- Missing repo → `404 skills_repo_not_found`.
- Empty/invalid patch (no `name` and no `artifactPaths`) → `400 bad_input`.
- Purge helpers are best-effort but run only after the guard passes and the primary mutation (path removal / repo delete) succeeds; a purge failure is logged, not surfaced as a user error, since the authoritative removal already happened.

## 7. Testing

Backend (Vitest, following existing `tests/` end-to-end style):

- **Rename**: PATCH `name`; existing installs still resolve and function; artifacts still discoverable.
- **Add path**: PATCH adds a path; artifacts under it become discoverable; they are seeded into the snapshot so a subsequent notifications pass reports **no** new artifacts for them.
- **Remove unused path**: PATCH drops a path with no installs; succeeds; favorites/snapshot/baseline/dismissed entries for that path's artifacts are gone.
- **Remove path in use**: install an artifact under path P, then PATCH dropping P → `409 paths_in_use` with the correct blocker (artifactKey + name); repo unchanged; install intact.
- **Remove repo in use**: install any artifact, DELETE repo → `409 repo_in_use` with blockers; repo, clone, and install all intact.
- **Global install blocks**: a `target: { type: "global" }` install blocks path and repo removal identically to a working-repo install.
- **Remove repo success**: DELETE with no installs → 204; clone dir gone; favorites/snapshot/baseline/dismissed entries for that repo all purged.

Frontend: light coverage of the modal's 409 rendering can be manual, given the existing test balance leans backend/e2e.

## 8. Files touched

- `src/api/skills-repos.ts` — new PATCH route; tighten DELETE; wire purge.
- `src/state/favorites.ts`, `artifact-snapshots.ts`, `artifact-sha-baseline.ts`, `notifications.ts` — add purge methods.
- `src/api/installs.ts` — extract `artifactDisplayName` to a shared util (e.g. `src/util/artifact-key.ts`) reused by blocker construction.
- (optional) `src/engine/purge.ts` — purge orchestrators, if not inlined in the API module.
- `web/api.ts` — `updateSkillsRepo`; carry `blockers` on thrown errors.
- `web/components/EditSkillsRepoModal.tsx` — new.
- `web/pages/SkillsRepos.tsx`, `web/pages/SkillsRepoDetail.tsx` — Edit button + guarded Remove handling.
- `tests/` — new coverage per § 7.
