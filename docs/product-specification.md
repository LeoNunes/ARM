# Skills Manager — Product Specification

> A locally-run application for managing AI-agent artifacts (skills, rules, and similar) across multiple source repositories and multiple working repositories, without polluting those working repositories' git history.

## 1. Purpose

Developers accumulate AI-agent artifacts — skills, rules, and similar pieces — across multiple source repositories, and want to install selected pieces into the repositories they actively work in.

Skills Manager solves four problems at once:

1. **Selective installation.** Choose which artifacts from which source repos go into which working repos, rather than installing everything en masse.
2. **Version tracking.** Know which version of each artifact is installed where, and when newer versions become available upstream.
3. **Drift awareness.** Detect when an installed artifact has been changed locally in the working repo, and let the user reconcile.
4. **Invisible to the working repo's git history.** Installed artifacts are present on disk for the AI agent to use, but produce no tracked changes in the working repo.

## 2. Target user

A single developer running on their own machine. Out of scope for MVP: multi-user, team sharing, remote sync.

## 3. Concepts and terminology

- **Artifact.** A discrete, installable unit. MVP supports two artifact types: **skills** and **rules**. The system is designed so additional artifact types (agent files such as CLAUDE.md / AGENTS.md, MCP server configurations, allowlist command lists, etc.) can be added later without redesigning the core.
- **Agent.** A target AI tool that consumes artifacts. MVP supports two agents: **Cursor** and **Claude Code**. The system is designed for additional agents to be added later.
- **Skills repository (source).** A git repository containing one or more artifacts available for installation. The user registers these. Each registration records the branch to track (default `main`) and the path(s) inside the repo where artifacts live.
- **Working repository (target).** A git repository the user works in, where they want artifacts installed.
- **Global install.** Installing an artifact at user level (in each agent's standard user-global location) rather than into a specific working repo.
- **Install record.** The system's memory of what is installed where, at what version. It records the source commit SHA the install came from; drift is computed by comparing against the file at that SHA in the source repository.
- **Version of an artifact.** Identified by the most recent commit in its source repository that touched its files. ("Latest" therefore means "current HEAD of the tracked branch, scoped to commits that touch this artifact's files.")
- **Update available.** The source repository has new commits that touch the installed artifact's files.
- **Drift.** The installed file in the working repo differs from what was originally installed.

## 4. Functional capabilities

### 4.1 Registering sources

- Add a skills repository by providing its **git URL**, the branch to track (default `main`), and **per-artifact-type path lists** (e.g., one list of paths where skills live, another for rules, and so on as artifact types are added).
- The product ships **preset configurations** for well-known skills repositories so the user can register them in one click.
- Edit, refresh (fetch latest), and remove registered skills repositories.

### 4.2 Registering targets

- Add a working repository by providing its local path.
- Edit and remove registered working repositories.

### 4.3 Browsing

- Browse all artifacts (skills + rules) across all registered skills repositories.
- Search and filter artifacts by name, source repository, and type.
- Inspect an artifact's content before installing.

### 4.4 Installing

- Install an artifact into a registered working repository. The user selects:
  - The **target agent** for the install (pre-filled from the global **favorite agent** setting — see §4.10 — and overridable per install).
  - The **version** to install (default: latest).
  - Whether to enable **auto-update** for this install.
- Install an artifact at the **user-global location** for an agent (rather than into a specific working repo). The agent selector here is also pre-filled from the favorite-agent setting.
- Installation copies the artifact's files into the target's agent-specific location (for example, the Claude Code skills directory inside the working repo, or the Cursor rules directory).
- **Filename mapping** is applied where needed. MVP includes the case where files named `CLAUDE.md` become `AGENTS.md` when the target is Cursor.
- For MVP, file content is copied **as-is** otherwise (no frontmatter or structural translation between agent formats).
- After installation, the system arranges for the installed files to be ignored by git in the working repo **without modifying any tracked file in that repo** (no edits to the repo's `.gitignore`). Developers using the working repo see no Skills Manager output in `git status`.
- Uninstall removes the installed files and the install record.

### 4.5 Update detection

- The backend fetches new commits from registered skills repositories (on demand, on app launch, and on a configurable background interval — see §4.10).
- For each install, the system determines whether new commits exist in the source repo that touch the installed artifact's files.
- If yes, the install is marked **update available**, surfaced in the UI.
- **Auto-update behavior:**
  - If the install has **auto-update** enabled and the install is **not drifted**, the system re-applies the latest version automatically.
  - If the install has **auto-update** enabled and the install **is drifted**, auto-update is paused for that install — the new version is not applied automatically. The user must either:
    - **Disable auto-update** for that install (and accept the drift), or
    - **Discard the local changes and re-apply the new version**, which clears the drift and lets future auto-updates proceed.
- If auto-update is disabled, the update remains pending until the user accepts or dismisses it.

### 4.6 Version history and diffs

- For any artifact, view the chronological list of commits in its source repository that touched its files (its **version history**).
- View a side-by-side / unified diff between any two of those versions.
- View a side-by-side diff between the installed version and the latest available version.
- View a side-by-side diff between the installed-version content and the current file content in the working repo (drift diff).

### 4.7 Drift detection

- At install time, the system records the **source commit SHA** the install came from.
- To check for drift, the system compares the file in the working repo to the file at the recorded SHA in the source repository (which it can read out of its local clone of that repo).
- Drifted installs are surfaced in the UI.
- The user can re-apply the install to overwrite local changes, or take no action and keep the drift visible.
- Drift also gates auto-update (see section 4.5).

### 4.8 Dashboard

A single overview page surfaces:

- All registered skills repositories and working repositories.
- For each working repository, the artifacts installed in it and their status: up-to-date, update available, or drifted. Working repos with non-up-to-date installs show a notification dot.
- **New artifacts** that have appeared in registered skills repositories, shown as dismissible cards. On first registration of a source repo, all current artifacts are considered "known"; only artifacts that appear after registration are surfaced as new.
- Notifications for new source-repo artifacts can be **dismissed**.
- **Recent activity panel** showing the 10 most recent activity log entries (see §4.11), with a category filter and a link to the full Activity page.
- The page re-polls the API every 5 seconds to keep displayed state current while the app is open.

### 4.9 Local MCP server (for AI agents)

The backend exposes a local Model Context Protocol server so AI agents can interact with Skills Manager directly. The MCP server is available at `/mcp` while the Skills Manager application is running, and exposes the following tools:

- `list_skills_repositories` — list all registered source repositories.
- `list_working_repositories` — list all registered working repositories.
- `search_artifacts` — search artifacts across all sources, with optional filters by query string, type, and source repo.
- `get_artifact` — retrieve artifact metadata, file list, and version history.
- `read_artifact_file` — read the content of a specific file within an artifact at a given SHA.
- `list_installs` — list current installs with status, filterable by working repo, agent, and type.
- `install_artifact` — install an artifact into a working repository or globally. Agent defaults to the favorite-agent setting.

### 4.10 Application settings

The product stores a small set of user-level settings that influence default behavior across the application.

- **Favorite agent.** The user picks one of the supported agents (e.g., Cursor or Claude Code) as their default. Any UI flow that needs an agent to be selected — installing into a working repo, installing globally, MCP install calls — pre-fills with this agent. The user can override the agent on any individual install.
- **Auto-refresh enabled.** Toggles the background refresh loop (default: on). When enabled, the backend periodically fetches all registered skills repositories and runs the auto-update pass.
- **Refresh interval.** How often the background refresh loop runs, in minutes (default: 30, minimum: 1). Changes take effect at the next tick without restarting the app.
- Settings can be viewed and changed from a dedicated settings area in the UI.

### 4.11 Activity log

A persistent record of all write operations performed by the application, kept on disk across sessions and capped at 500 entries (oldest pruned first).

Each entry records a timestamp, a category, a human-readable summary, and optional detail (e.g. old SHA → new SHA for auto-updates). Categories:

| Category | When written |
|----------|-------------|
| `install` | An artifact is installed or manually updated |
| `uninstall` | An artifact is uninstalled |
| `re-apply` | An install is re-applied to overwrite local drift |
| `refresh` | A skills repository is fetched (manual or background) |
| `auto-update` | An install with auto-update enabled is updated by the background loop |

The activity log is surfaced in two places:
- **Dashboard panel** — the 10 most recent entries with a category filter and a "View all" link.
- **Activity page** — the full log (up to 500 entries) with a category filter and per-entry delete.

## 5. Capabilities by surface

### 5.1 Backend supports

- Storing and managing all state: registered skills repos, registered working repos, install records (including the source commit SHA for each install), dismissed notifications, per-install auto-update flags, application settings (e.g., favorite agent, auto-refresh interval), presets, artifact snapshots, activity log.
- Performing all git operations against skills repositories (clone, fetch, commit walking, file lookup at a SHA) and computing per-artifact "last touched commit" SHAs.
- Performing install, uninstall, update, re-apply, and drift-check operations against working repositories.
- Implementing the file-level "ignore in working repo" mechanism without touching tracked files in those repos.
- Running a configurable background refresh loop that periodically fetches skills repos and applies auto-updates.
- Writing categorized activity log entries for all write operations.
- Exposing an API for the frontend.
- Exposing the local MCP server.

### 5.2 Frontend supports

- Browsing and searching artifacts.
- Managing registered skills repositories: add by git URL or by preset, configure per-artifact-type paths, edit, refresh, remove.
- Managing registered working repositories: add, edit, remove.
- Installing, uninstalling, and updating artifacts to working repositories or to the user-global location; toggling auto-update per install; choosing the target agent (pre-filled from the favorite-agent setting).
- Viewing artifact version history and side-by-side diffs (version-to-version, installed-vs-latest, installed-vs-drifted).
- Dashboard with status indicators, dismissible new-artifact notifications, and a recent activity panel.
- Activity page showing the full activity log with category filter and per-entry delete.
- Viewing and editing application settings (favorite agent, auto-refresh interval, etc.).
- Viewing MCP server status and the configuration snippet to paste into an agent's MCP configuration.

## 6. Non-functional requirements

- **Cross-platform.** Windows, macOS, and Linux.
- **Local-only.** Runs entirely on the user's machine. No external services required for core functionality.
- **On-demand.** The application runs only when the user opens it and stops when the user closes it. There is no always-on background service. When the application is running, a configurable background refresh loop periodically fetches skills repositories and applies auto-updates.
- **Non-intrusive to working repos.** Installation must not produce any tracked git changes in the working repo (the repo's `.gitignore` and other tracked files are not modified).

## 7. Out of scope for MVP

- Cross-agent format translation beyond filename mapping (e.g., rewriting frontmatter, rule structure, or trigger metadata between Cursor and Claude Code formats). The architecture leaves room for translators to be added later.
- Artifact types other than skills and rules (agent files like CLAUDE.md / AGENTS.md, MCP server configurations as managed artifacts, allowlist command lists).
- Multi-user, remote synchronization, team-level sharing.
- Background updates or notifications while the application is not running.
- Notifications surfaced outside the application UI.
