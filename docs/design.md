# AI Resources Manager — Design

> Engineering design for the product described in [`product-specification.md`](./product-specification.md). This document captures architectural decisions, the data model, the adapter layers, the MCP surface, UI structure, error handling, and the testing strategy. It does not restate product capabilities — read the product spec first.

Date: 2026-05-20.
Status: approved through brainstorming; ready to translate into an implementation plan.

---

## 1. Architecture overview

### Process shape

A single Node.js + TypeScript backend process exposes:

- An **HTTP API** for the React SPA (localhost-only).
- An **MCP server** over **Streamable HTTP**, served on the same port at `/mcp`.
- The built React assets (the SPA is bundled in and served by the same process).

Startup is launched by a small `arm` CLI that:

1. Reads the saved port (or picks a free one), boots the BE.
2. Opens the user's default browser to the UI URL.

When the user closes the launcher (or hits Quit in the UI), the BE shuts down. There is **no background daemon** and **no OS service registration**.

### State location

All state lives in an OS-appropriate user-data directory (resolved via the `env-paths` npm package):

- Windows: `%APPDATA%\arm\`
- macOS: `~/Library/Application Support/arm/`
- Linux: `$XDG_CONFIG_HOME/arm/` (defaulting to `~/.config/arm/`)

Inside:

```
<state-dir>/
  settings.json
  skills-repos.json
  working-repos.json
  installs.json
  dismissed-notifications.json
  presets.json          # bundled with the app, read-only
  cache/<sourceRepoId>/ # full clones of registered skills repositories
  logs/arm.log     # rotating log file
```

All persistence is JSON files. No database in MVP. Volumes are small (handfuls of repos, dozens-to-low-hundreds of installs).

### Communication

- **FE ↔ BE:** plain HTTP/JSON on `http://127.0.0.1:<port>/api/...`.
- **Agents ↔ BE:** MCP over Streamable HTTP at `http://127.0.0.1:<port>/mcp`.
- An optional `arm-mcp` stdio shim is reserved for future agents that don't support HTTP MCP transport (out of scope for slice 1).

### Cross-platform

- No native non-portable APIs.
- Git operations via `simple-git` (which shells out to the user's installed `git`). The launcher detects missing `git` at startup and surfaces a clear error.
- Path handling exclusively via `node:path`. No shell-specific commands.

### Stack summary

| Layer | Choice |
| --- | --- |
| BE language/runtime | Node.js + TypeScript |
| Frontend | React + Vite + TypeScript |
| Persistence | JSON files (no database) |
| Git | `simple-git` shelling to local `git` binary |
| MCP | Streamable HTTP, official MCP TypeScript SDK |
| Cross-platform paths | `env-paths` + `node:path` |
| Diff rendering | `react-diff-viewer` (or equivalent) |

---

## 2. Data model

All files JSON. Schemas described informally; concrete TypeScript types live in `src/state/schema.ts` (to be created).

### `settings.json`

```jsonc
{
  "favoriteAgent": "claude-code" | "cursor",
  "mcpPort": 7747            // configurable default; reassigned if taken
  // additional global settings added here as they appear
}
```

### `skills-repos.json`

Array of registered sources. Each entry:

```jsonc
{
  "id": "uuid",
  "name": "display name",
  "gitUrl": "https://github.com/...",     // git URL only — local-path sources not supported
  "branch": "main",                       // default "main"
  "artifactPaths": {                      // per-type, not a flat list
    "skills":  ["ai/skills", ".claude/skills"],
    "rules":   [".cursor/rules", "ai/rules"]
    // future types add their own keys; existing repos default to [] for new keys
  },
  "presetId": "string | null",
  "localClonePath": "<state-dir>/cache/<id>",
  "lastFetchedAt": "ISO timestamp"
}
```

### `working-repos.json`

```jsonc
{
  "id": "uuid",
  "name": "display name",
  "path": "absolute path",
  "addedAt": "ISO timestamp"
}
```

### `installs.json`

```jsonc
{
  "id": "uuid",
  "artifactKey": "<sourceRepoId>:<relative/path>",
  "sourceRepoId": "uuid",
  "target": { "type": "working-repo", "workingRepoId": "uuid" }
            | { "type": "global" },
  "agent": "claude-code" | "cursor",
  "installedCommitSha": "abc123...",      // source SHA the install was sourced from
  "autoUpdate": true,
  "installedFiles": [
    { "sourcePath": "ai/skills/foo/SKILL.md", "targetPath": ".claude/skills/foo/SKILL.md" }
  ],
  "installedAt": "ISO timestamp"
}
```

**Drift detection stores no local file content.** The `installedCommitSha` plus the source repo's local clone is sufficient — drift is computed by reading the file at that SHA via `git show` and byte-comparing.

### `dismissed-notifications.json`

Keys identifying dismissed notifications, so re-occurrence of the same event does not re-pop:

```jsonc
{
  "newArtifact:<sourceRepoId>:<artifactKey>:<firstSeenSha>": true,
  "updatedArtifact:<sourceRepoId>:<artifactKey>:<newSha>": true
}
```

### `presets.json`

Bundled with the app (read-only). Each preset declares a registration template:

```jsonc
{
  "id": "anthropic-superpowers",
  "name": "Anthropic Superpowers",
  "gitUrl": "https://github.com/...",
  "branch": "main",
  "artifactPaths": { "skills": ["skills"] }
}
```

### Discovery (not persisted)

Artifact discovery is rebuilt in memory after each fetch. The rule:

- For each registered source, for each artifact type, for each configured path under `artifactPaths[type]`, list each **immediate child** of that path in the clone.
- Each immediate child is one artifact of that type.
- The artifact-type adapter optionally filters its discovered children (e.g., the `rules` adapter may count only `.mdc` files, regardless of which configured path they were found under).
- Each discovered artifact yields metadata: display name (from folder/file basename, or first heading of `SKILL.md` if present), file list (relative paths within the artifact root), and the latest commit SHA that touched any of its files.

---

## 3. Install / update / drift mechanics

### Install flow

1. Caller supplies: `artifactKey`, `target`, `agent` (default: `settings.favoriteAgent`), `sha` (default: latest), `autoUpdate` (default: false).
2. Engine resolves: source clone → list of files at SHA (via `git show`); agent adapter → target root via the matrix (Section 4); agent adapter → filename mapping for each file.
3. Engine writes files to the resolved target paths in the working repo (or user-global location for `global` targets).
4. Engine updates the working repo's `.git/info/exclude` block (see "Ignore mechanism" below) — only applicable to `working-repo` targets.
5. Engine appends the install record to `installs.json`.
6. Result returned to caller.

### Update detection

For each install: run `git log <branch> <installedSha>..HEAD -- <artifact-files>` in the source clone. If non-empty → update available; new SHA = HEAD of that branch. Runs as a batch pass after each fetch (on app launch and on manual refresh).

### Drift detection

For each install, for each `installedFiles` entry: read the source-repo content at `installedCommitSha` via `git show <sha>:<sourcePath>` and byte-compare with the working-repo file at `targetPath`. Filename mapping does not change content, so direct byte compare is correct. Drift result is per-install boolean plus a per-file diff list for the diff view.

### Auto-update + drift gate

When the scheduled update pass finds an install with `autoUpdate=true` and an update available, it first runs the drift check for that install. If drifted, the auto-update is skipped and the install is left in `update-available + drifted` state. The UI surfaces the gate and its two resolution paths (disable auto-update, or discard-and-reapply).

### Ignore mechanism

Per working repo, the BE manages a fenced block in `<workingRepo>/.git/info/exclude`:

```
# BEGIN ai-resources-manager (auto-managed, do not edit)
.claude/skills/superpowers/
.cursor/rules/foo.mdc
# END ai-resources-manager
```

`.git/info/exclude` is a git-native local-only ignore file — not tracked, not synced, supported on every git version. The block is rewritten in full on each install/uninstall by aggregating the `targetPath`s of all current installs into that working repo. No other tracked files in the working repo are touched.

---

## 4. Adapter layers

Two independent extension points: **agent adapters** (one per target tool — Claude Code, Cursor, …) and **artifact-type adapters** (one per type — skills, rules, …). Both are static registrations in code (a module + a line in a registry) — not a dynamic plugin runtime. Sufficient modularization for the stated goal without overengineering.

### Agent adapter — declared shape

Each agent adapter exposes:

1. **Identifier and display name** (e.g., `claude-code`, "Claude Code").
2. **`targetRoot(scope, type, name)`** → directory to write files into. Scopes: `working-repo` (path relative to repo root) and `global` (absolute, resolved per-OS).
3. **`mapFileName(name)`** → name. Identity for Claude Code; for Cursor maps `CLAUDE.md` → `AGENTS.md`. (This is also the seam for future content translation: a `transformContent(file)` hook that is a no-op in MVP.)
4. **Supported `(type, scope)` combinations.** Combinations the adapter does not declare are treated as **unsupported** and produce a clear UI/MCP error.

### Artifact-type adapter — declared shape

Each artifact-type adapter exposes:

1. **Identifier and display name** (e.g., `skills`, "Skills").
2. **Config key** in `skills-repos.json` under `artifactPaths` (e.g., `artifactPaths.skills`). The registration UI uses this to render the per-type path input.
3. **Discovery rule.** Given the local clone and a configured path, list artifacts directly under it. Default: each immediate child = one artifact. The adapter may further filter (e.g., `.mdc` only for rules).
4. **Metadata read.** Display name, optional description, file list (relative paths within the artifact root).

### Composition at install time

The engine asks the **artifact-type adapter** for the artifact's file list, then asks the **agent adapter** for (a) the target root for `(scope, type, name)` and (b) the mapped name per file, then writes. Adapters never call each other; only the engine composes them.

### Default {agent × artifact-type} matrix (MVP)

Working-repo targets shown relative to repo root.

| Agent       | Artifact-type | Working-repo target              | Global target                          |
|-------------|---------------|----------------------------------|----------------------------------------|
| claude-code | skills        | `.claude/skills/<name>/`         | `<home>/.claude/skills/<name>/`        |
| claude-code | rules         | `.claude/rules/<name>`           | `<home>/.claude/rules/<name>`          |
| cursor      | skills        | `.cursor/skills/<name>/`         | `<home>/.cursor/skills/<name>/`        |
| cursor      | rules         | `.cursor/rules/<name>.mdc`       | `<home>/.cursor/rules/<name>.mdc`      |

Notes:

- The **cross-type rows** (Claude → rules, Cursor → skills) are *staging locations*. Neither agent natively reads them today. We write there because MVP is copy-as-is + filename mapping (no content translation yet); the user is responsible for wiring the agent to consume them. These two rows are the ones most likely to be revised once translators are added.
- The matrix is the authoritative answer to "can I install X to Y at scope Z?" — no special-casing elsewhere.

### Adding new things

- **New agent** = one adapter module + one registry entry.
- **New artifact type** = one adapter module + one registry entry + one new key under `artifactPaths` (existing source repos default to `[]` for the new key).

---

## 5. MCP surface

### Transport, port, lifecycle

- Streamable HTTP at `/mcp` on the same localhost port the BE uses. Bound to `127.0.0.1` only.
- No auth (single-user, localhost).
- Server runs only while the BE runs.
- Port defaults to a configurable value (e.g., 7747) saved in `settings.json`. If the port is in use at startup, the launcher picks the next free port and writes it back; the UI shows the current URL prominently.

### Agent wiring

The Settings → MCP panel renders a copy-ready config snippet per supported agent (Claude Code, Cursor). The user pastes the snippet into their agent's MCP config once.

### Tools (MVP)

| Tool                          | Dir.  | Purpose                                                                       |
|-------------------------------|-------|-------------------------------------------------------------------------------|
| `list_skills_repositories`    | read  | List registered sources                                                       |
| `list_working_repositories`   | read  | List registered targets                                                       |
| `search_artifacts`            | read  | Search across registered sources; optional `query`, `type`, `sourceRepoId`    |
| `get_artifact`                | read  | Metadata + file list + version history (no contents)                          |
| `read_artifact_file`          | read  | One file's content at a specific SHA                                          |
| `list_installs`               | read  | Current installs with status; filters: `workingRepoId?`, `agent?`, `type?`    |
| `install_artifact`            | write | Create-only install; respects matrix + favorite-agent default + drift gate    |

`install_artifact` defaults the `agent` parameter to `settings.favoriteAgent` when omitted. Errors `agent_not_specified` if both are missing. Errors `already_installed` if an install already exists for the same `(artifactKey, target, agent)` triple — so a global Claude Code install and a global Cursor install of the same artifact can coexist (no `force` in MVP — users re-apply via the UI).

### Error model

Structured tool errors with stable codes:

- `artifact_not_found`, `working_repo_not_found`
- `unsupported_combination` (matrix consulted)
- `agent_not_specified`
- `already_installed`
- `bad_input` (schema validation, with offending field name)

Each error includes a human-readable message.

### Composition with the rest of the system

All MCP tools route through the **same domain services** as the HTTP API (registries, engine, discovery). No parallel implementation.

---

## 6. UI surface

### Navigation

Persistent left sidebar: **Dashboard** · **Browse** · **Skills repos** · **Working repos** · **Settings**.

### Dashboard

Top: row of **New skill** cards (artifact name, source repo, short description, Install / Dismiss buttons).
Middle: **Working repos** — each repo as a card showing its installed-skill chips and a notification dot when updates or drift exist; entire card clickable to the working-repo detail page.
Bottom: **Skills repos** — thin list (repo name, artifact count, last-fetched); each row clickable to the skills-repo detail page.

No global activity feed. Updates and drift counts surface as the dot on each working-repo card; the working-repo detail page is where actions live.

### Working-repo detail

Header: repo name, path, Edit / Remove.
Filter chips: All / Update available / Drifted.
Single table of installs — columns: Skill, Source, Version (short SHA), Status (Up to date / Update / Drifted / Update + drift), Auto-update, Actions.
"+ Install skill" button opens the install modal.

### Install flow

Centered modal. Fields: Skill (pre-filled from entry point), Target (Working repo / Global, pre-filled from context), Agent (pre-filled from favorite agent, overridable), Version (default latest, dropdown of source-repo commits that touched the artifact), Auto-update toggle. Footer line shows the resolved target path and notes that the working repo's local `.git/info/exclude` will be updated.

### Diff view

Own route (`/diff?...`). Header: artifact name, "from-SHA → to-SHA" plus the comparison label (installed vs latest / two history versions / installed vs working-file).
Left pane: file list within the artifact (changed-file markers).
Right pane: side-by-side diff (toggle to unified).
Footer: Close + the relevant primary action (Update / Re-apply / Discard).

### Other pages

- **Browse** — search input + type/source filter chips, virtualized artifact list, row Install → install modal, row click → artifact detail.
- **Skills repos** — full-page list of registered sources with "+ Register skills repo" button (modal asks for git URL, branch, per-type paths, or a preset).
- **Skills repo detail** — header (URL/branch/per-type paths/last-fetched + Refresh/Edit/Remove); body lists discovered artifacts.
- **Working repos** — full-page list with "+ Register working repo" (asks for local path).
- **Artifact detail** — metadata, file list, version-history table, Install, Compare versions (opens diff view).
- **Settings** — General (favorite agent), MCP server (status, URL, port, copy-snippet per agent), About (version, state directory path, log file reveal).

---

## 7. Error handling

### Categories

1. **Git failures.** Clone (auth/URL/network), fetch, missing-SHA (history rewrite upstream). Surfaced per skills-repo with a clear error state and a re-clone option. Operations against a missing SHA fail with "version not available; refresh source repo or pick a different version."
2. **Non-git working repo.** Detected at registration and at install. Registration refuses; install surfaces inline.
3. **Unsupported `(agent × type × scope)`.** Engine consults the adapter matrix. UI disables the option in selectors; MCP returns `unsupported_combination`.
4. **Drift blocking auto-update.** A state, not an error. UI shows the row with two-button resolution. Background pass logs the skip and continues.
5. **Concurrent install collisions.** MCP returns `already_installed`. UI offers Update/Uninstall instead of a new install when the pair is already taken.
6. **Empty/missing per-type discovery paths.** Not an error. Shown as "0 artifacts found at this path" with the path printed.
7. **File-write failures.** Roll back: delete any partially-written files, restore `.git/info/exclude` to pre-install content, do not write the install record. UI shows the OS error.
8. **Port in use at launch.** Launcher tries next free port, writes back to `settings.json`. UI shows active URL.
9. **MCP `bad_input`.** Returned with the offending field name and reason.

### Logging

Rotating log at `<state-dir>/logs/arm.log`. Settings → About has a "Reveal log file" button.

### No silent failures

Every failure path surfaces on the relevant resource (repo card, install row, settings panel). Background pass failures aggregate into one dismissible banner: "X background operations failed — view log."

---

## 8. Testing strategy

Tests focus on what's hardest to get right: filesystem behavior of installs, drift comparing against the right SHAs, `.git/info/exclude` coherence across install/uninstall cycles. Pure functions get unit tests; UI gets light coverage.

### Layers

1. **Unit (BE).** Adapter functions (`targetRoot` for every matrix cell; `mapFileName` for both agents; discovery rules), data transforms (version-history diff, drift-check, exclude-block serializer/parser). No I/O.

2. **Integration (BE).** Largest layer. Each test creates throwaway tmp dirs and uses the real `git` binary — no `simple-git` mocking. Coverage:
   - Registration: clone a fresh fixture repo (created by helper), assert discovered artifacts and SHAs.
   - Install / uninstall / re-install: assert files at target paths, exclude block contents, `installs.json`.
   - Update detection: install at `C1`; add commits touching/not touching the artifact; assert `update-available` / `up-to-date` correctly.
   - Drift detection: install; mutate working-repo file; assert drift with per-file diff.
   - Auto-update drift gate: drifted + upstream-update → install unchanged, state is `update-available + drifted`.
   - Adapter matrix: unsupported combinations error clearly.
   - Filename mapping: `CLAUDE.md` → `AGENTS.md` for Cursor target; drift correctly compares source `CLAUDE.md` to target `AGENTS.md`.
   - Exclude-block coherence: A install + B install + A uninstall + C install → block contains exactly {B, C}.
   - Rollback on write failure: simulate write failure; assert no record, no leftover files, exclude block unchanged.

3. **MCP.** Each tool: valid call, `bad_input`, `unsupported_combination`, `already_installed`, `agent_not_specified`. Transport itself gets one happy-path test; SDK is trusted for the rest.

4. **Frontend.** Vitest + React Testing Library for components with logic: status-pill rendering for every install status, filter-chip behavior, install-modal defaults (favorite-agent pre-fill, target pre-fill), notification-dot computation. Purely structural components skipped.

5. **E2E smoke (optional in slice 1).** Playwright booting BE + browser, walking through register-fixture-source → register-tmp-working-repo → install one artifact → verify file landed + exclude block. Catches wiring regressions. Optional in slice 1; required by slice 2.

### Fixtures and isolation

- `tests/fixtures/build-skills-repo.ts` helper creates a fresh fixture git repo on demand from a manifest (commits + files), returning path and SHAs.
- All git URLs in tests are `file://...` URIs — no real network.
- CI runs the suite on Windows, macOS, and Linux.

---

## 9. Delivery slicing

Walking-skeleton approach (chosen during brainstorming). Each slice independently shippable.

- **Slice 1 — Walking skeleton.** Register skills repos (git URL + per-type paths) and working repos; browse; manual install end-to-end for a single agent. Establishes the data model, the adapter wiring, the install engine, the exclude-block mechanism, and the FE shell.
- **Slice 2 — Updates and drift.** Per-artifact version tracking; update detection on fetch and refresh; drift detection; auto-update with drift gate; status pills, filter chips, "Needs attention" surfacing in the working-repo detail.
- **Slice 3 — MCP server.** Streamable HTTP at `/mcp`. All seven tools. Settings panel snippets.
- **Slice 4 — Dashboard and diff polish.** Full dashboard (new-skill cards, working-repo cards with notification dots, skills-repo list), dismissible notifications, full-page diff view across version-vs-version / installed-vs-latest / installed-vs-drifted.

---

## 10. Open items deferred past MVP

These are explicitly out of scope for the MVP build but the design accommodates them without re-architecture:

- **Content translation between agent formats** (frontmatter/structure rewrites). The agent-adapter `transformContent(file)` hook is the seam.
- **Additional artifact types**: agent files (CLAUDE.md/AGENTS.md), MCP configurations, allowlist command lists. Each = one new artifact-type adapter + a new key under `artifactPaths`.
- **Additional agents** beyond Claude Code and Cursor. Each = one new agent adapter + its matrix entries.
- **Stdio MCP shim** for agents lacking HTTP MCP transport.
- **Background daemon / scheduled updates** while the app is closed.
- **`force` parameter** on MCP `install_artifact` (or a separate `update_install` tool) for re-applying over drift.
- **`list_installs` enhancements** (sort, pagination) if usage warrants.
