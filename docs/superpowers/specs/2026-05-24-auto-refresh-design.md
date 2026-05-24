# Auto-Refresh & Activity Log — Design Spec

**Date:** 2026-05-24  
**Status:** Approved

## Overview

Add two related capabilities to AI Resources Manager:

1. **Auto-refresh** — the backend periodically fetches all registered skills repositories and runs the auto-update pass on a configurable interval; the frontend re-polls the API on a fixed short interval to keep displayed state current.
2. **Activity log** — a persistent, categorized record of all write operations (installs, uninstalls, re-applies, refreshes, auto-updates), surfaced on the Dashboard and on a dedicated Activity page.

---

## 1. Data Model

### 1.1 Settings additions

Two new fields added to `SettingsFile` in `src/state/schema.ts`:

```ts
autoRefreshEnabled: boolean        // default: true
autoRefreshIntervalMinutes: number // default: 30, min: 1
```

### 1.2 Activity log entry

New types added to `src/state/schema.ts`:

```ts
type ActivityCategory =
  | "auto-update"
  | "install"
  | "uninstall"
  | "re-apply"
  | "refresh";

interface ActivityLogEntry {
  id: string;
  ts: string;               // ISO 8601 timestamp
  category: ActivityCategory;
  summary: string;          // human-readable one-liner
  detail?: string;          // optional extra context (e.g. "abc123 → def456")
  artifactKey?: string;
  workingRepoId?: string;
  sourceRepoId?: string;
}
```

### 1.3 Activity log store

New `src/state/activity-log.ts` — an `ActivityLogStore` class backed by `JsonStore<ActivityLogEntry[]>`, stored at `activityLog.json` in the state directory.

- Entries are kept newest-first.
- Capped at **500 entries**; oldest are pruned on each write.
- Exposes: `list(filter?)`, `add(entry)`, `delete(id)`.
- `ActivityLogStore` is added to `ServerDeps` and instantiated in `src/index.ts` alongside existing stores.

---

## 2. Backend Refresh Loop

### 2.1 New module

`src/engine/refresh-loop.ts` exports `startRefreshLoop(deps)`, called from `src/index.ts` after the server starts (after the existing one-shot `runAutoUpdatePass`).

### 2.2 Loop behavior

Each tick:

1. Read `autoRefreshEnabled` and `autoRefreshIntervalMinutes` from settings.
2. If disabled, schedule next tick in 1 minute (so re-enabling from the UI takes effect quickly without restart).
3. If enabled:
   a. Fetch each registered skills repo via `GitClient.fetchAndReset`. Each fetch is individually try/caught — a failure on one repo does not abort the others.
   b. Update `lastFetchedAt` for each successfully fetched repo.
   c. Write a `category: "refresh"` `ActivityLogEntry` per repo (success or failure; failures include a message in `detail`).
   d. Run `runAutoUpdatePass`, which is updated to return `AppliedUpdate[]` (each entry carries `install`, `oldSha`, `newSha`). Write a `category: "auto-update"` `ActivityLogEntry` for each returned update with `detail` showing old SHA → new SHA.
4. After the pass completes, schedule the next tick with `setTimeout` reading the interval fresh from settings (so interval changes take effect on the next tick without restart).

### 2.3 Error handling

- Per-repo fetch errors are caught, logged to stderr, and recorded as a `"refresh"` activity entry with a failure summary.
- The overall pass does not throw; errors are never fatal to the server.

---

## 3. Activity Log API

New route file `src/api/activity-log.ts`, registered in `src/api/routes.ts`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/activity-log` | Return entries newest-first. Query params: `category` (filter), `limit` (default 50). |
| `DELETE` | `/api/activity-log/:id` | Delete a single entry by id. Returns 204. |

### 3.1 Write-operation instrumentation

Each existing API route handler that performs a write calls `deps.activityLog.add(entry)` after the operation succeeds. Logging stays in the API layer — no changes to engine functions.

| Route | Category | Summary example |
|-------|----------|-----------------|
| `POST /api/skills-repos/:id/refresh` | `"refresh"` | `"Refreshed 'superpowers'"` |
| `POST /api/installs` | `"install"` | `"Installed 'brainstorming' into my-repo"` |
| `DELETE /api/installs/:id` | `"uninstall"` | `"Uninstalled 'brainstorming' from my-repo"` |
| `POST /api/installs/:id/reapply` | `"re-apply"` | `"Re-applied 'brainstorming' in my-repo"` |
| Refresh loop (per updated install) | `"auto-update"` | `"Auto-updated 'brainstorming' in my-repo (abc123 → def456)"` |

---

## 4. Frontend

### 4.1 Settings page

Two new fields added to the existing settings card in `web/pages/Settings.tsx`:

- Checkbox: **Auto-refresh enabled** (maps to `autoRefreshEnabled`)
- Number input: **Refresh interval (minutes)** (maps to `autoRefreshIntervalMinutes`; disabled when auto-refresh is off; min 1)

Both saved immediately on change, matching the pattern of the existing favorite-agent select.

### 4.2 Frontend polling hook

New `web/hooks/useAutoRefresh.ts` — a custom hook using a recursive `setTimeout` pattern:

```ts
function useAutoRefresh(callback: () => void, intervalMs = 5000): void
```

Applied at the page level on:
- `Dashboard` — re-fetches installs, notifications, and activity log
- `Browse` — re-fetches artifact list and install statuses
- `WorkingRepoDetail` — re-fetches installs for the repo

Pages re-fetch their data independently; no global state bus needed. The 5-second FE interval is fixed (not user-configurable).

### 4.3 Dashboard activity panel

Added below existing Dashboard content in `web/pages/Dashboard.tsx`:

- **Header:** "Recent activity" + category filter dropdown (All / Auto-update / Install / Uninstall / Re-apply / Refresh)
- **Entries:** 10 most recent matching entries, each showing:
  - Relative timestamp (e.g. "2 min ago")
  - Category pill (styled like `StatusPill`)
  - Summary text
  - Trash icon button (calls `DELETE /api/activity-log/:id`, removes entry from local state on success)
- **"View all" link** navigates to `/activity`

### 4.4 Activity page

New `web/pages/ActivityLog.tsx` registered at `/activity` in the router.

- Same category filter as the Dashboard panel
- Full list of entries (all 500 max), newest-first
- Each row has the same shape as the Dashboard panel rows (timestamp, category pill, summary, trash icon)
- New "Activity" entry added to the sidebar (`web/components/Sidebar.tsx`)

### 4.5 Frontend API additions (`web/api.ts`)

```ts
getActivityLog(params?: { category?: ActivityCategory; limit?: number }): Promise<ActivityLogEntry[]>
deleteActivityLogEntry(id: string): Promise<void>
getSettings(): Promise<Settings>       // already exists
updateSettings(patch): Promise<Settings> // already exists
```

---

## 5. File Changelist

| File | Change |
|------|--------|
| `src/state/schema.ts` | Add `autoRefreshEnabled`, `autoRefreshIntervalMinutes` to `SettingsFile`; add `ActivityCategory`, `ActivityLogEntry` types |
| `src/state/settings.ts` | Update `DEFAULTS` with new fields |
| `src/state/activity-log.ts` | New — `ActivityLogStore` |
| `src/engine/update-pass.ts` | Update `runAutoUpdatePass` to return `AppliedUpdate[]` instead of `void` |
| `src/engine/refresh-loop.ts` | New — `startRefreshLoop` |
| `src/index.ts` | Instantiate `ActivityLogStore`; call `startRefreshLoop` |
| `src/server.ts` | Add `activityLog` to `ServerDeps` |
| `src/api/activity-log.ts` | New — GET and DELETE routes |
| `src/api/routes.ts` | Register new activity-log routes |
| `src/api/skills-repos.ts` | Add activity log write on refresh |
| `src/api/installs.ts` | Add activity log writes on install, uninstall, re-apply |
| `web/api.ts` | Add `ActivityLogEntry`, `ActivityCategory` types; add `getActivityLog`, `deleteActivityLogEntry`; add settings fields |
| `web/hooks/useAutoRefresh.ts` | New — polling hook |
| `web/pages/Settings.tsx` | Add auto-refresh fields |
| `web/pages/Dashboard.tsx` | Add activity panel |
| `web/pages/ActivityLog.tsx` | New — full activity log page |
| `web/components/Sidebar.tsx` | Add "Activity" nav entry |

---

## 6. Out of Scope

- Push notifications or OS-level alerts when auto-updates occur.
- Per-install or per-repo refresh interval overrides.
- Activity log export.
- Making the FE polling interval configurable.
