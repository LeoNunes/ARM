# Updated-Artifact Notifications — Design Spec

## Overview

Extend the Dashboard notification system to surface dismissible cards when any artifact in a registered source repo receives new commits — not just when entirely new artifacts appear. Covers all artifacts (installed or not). Uses per-SHA dismissal so a future commit on the same artifact generates a fresh notification.

## Scope

- **In scope:** new state store, extended API endpoint, extended frontend notification types, Dashboard card rendering.
- **Out of scope:** push-style alerts outside the app, notifications on non-Dashboard pages, any change to the existing install update-available flow.

---

## 1. State Layer

### New file: `src/state/artifact-sha-baseline.ts`

Persists to `<stateDir>/artifact-sha-baseline.json`.

Schema: `Record<string, string>` — flat map of `"${sourceRepoId}:${artifactKey}"` → `lastSeenSha`.

**API:**

```ts
getBaseline(sourceRepoId: string, artifactKey: string): Promise<string | null>
setBaseline(sourceRepoId: string, artifactKey: string, sha: string): Promise<void>
setBulkBaseline(sourceRepoId: string, entries: { artifactKey: string; sha: string }[]): Promise<void>
```

`ArtifactShaBaselineStore` is instantiated in `src/server.ts` alongside the existing stores and added to `ServerDeps`.

---

## 2. Backend Notification Logic

### Extended: `GET /api/notifications`

Returns `{ newArtifacts: [...], updatedArtifacts: [...] }`.

For each source repo, for each discovered artifact, the updated-artifact check runs as follows:

1. Look up `baseline = await shaBaseline.getBaseline(sourceRepoId, artifact.artifactKey)`.
2. If `baseline` is `null` (first time this artifact has been seen in the SHA baseline store): call `shaBaseline.setBaseline(sourceRepoId, artifactKey, lastTouchedSha)` and **skip** — this is the initial baseline, no notification fires. This applies both on first repo registration and when a brand-new artifact appears.
3. If `lastTouchedSha` is `null`, skip.
4. If `lastTouchedSha === baseline`, skip (no change).
5. Otherwise: build key `updatedArtifact:<sourceRepoId>:<artifactKey>:<lastTouchedSha>`. If the key is not in the dismissed set, emit an `updated-artifact` notification.

#### `UpdatedArtifactNotification` shape

```ts
{
  kind: "updated-artifact";
  key: string;            // "updatedArtifact:<sourceRepoId>:<artifactKey>:<toSha>"
  artifactKey: string;
  sourceRepoId: string;
  sourceName: string;
  fromSha: string;        // the stored baseline SHA (user's last acknowledged version)
  toSha: string;          // the new SHA (current lastTouchedSha)
  name: string;
  description: string | null;
}
```

### Extended: `POST /api/notifications/dismiss`

Existing behaviour (mark key as dismissed in `DismissedNotificationsStore`) is unchanged.

For `updatedArtifact:` keys, additionally advance the SHA baseline:

```
key = "updatedArtifact:<sourceRepoId>:<artifactKey>:<toSha>"
```

Parse `sourceRepoId` (second segment), `toSha` (last segment), and `artifactKey` (everything in between) using the same last-colon parsing strategy already applied for `newArtifact:` keys. Then call `shaBaseline.setBaseline(sourceRepoId, artifactKey, toSha)`.

This ensures the baseline advances on each dismiss, so a future commit to the same artifact generates a fresh notification.

### Coexistence with new-artifact notifications

A new artifact that appears and is then updated before the user dismisses the new-artifact card can legitimately produce both a `new-artifact` card and an `updated-artifact` card simultaneously. The two notification systems are independent and both cards may be dismissed independently.

Dismissing the `new-artifact` card does **not** change the SHA baseline (already initialised when the artifact was first seen in the baseline store).

---

## 3. Frontend

### `web/api.ts`

Add `UpdatedArtifactNotification` interface:

```ts
export interface UpdatedArtifactNotification {
  kind: "updated-artifact";
  key: string;
  artifactKey: string;
  sourceRepoId: string;
  sourceName: string;
  fromSha: string;
  toSha: string;
  name: string;
  description: string | null;
}
```

Extend `NotificationsResponse`:

```ts
export interface NotificationsResponse {
  newArtifacts: NewArtifactNotification[];
  updatedArtifacts: UpdatedArtifactNotification[];
}
```

### `web/pages/Dashboard.tsx`

Add `updatedArtifacts` state alongside `newArtifacts`. Load from `notifs.updatedArtifacts` in the `load()` function.

**Section header label** — derived from which arrays are non-empty:

| newArtifacts | updatedArtifacts | Label |
|---|---|---|
| non-empty | empty | `NEW SKILLS` |
| empty | non-empty | `UPDATED SKILLS` |
| both non-empty | both non-empty | `NEW & UPDATED SKILLS` |

Both card types render in the same horizontal scroll row. New-artifact cards are unchanged.

**Updated-artifact card** — same dimensions and layout as new-artifact cards, with two differences:

1. A small `UPDATED` badge (styled inline, e.g. amber/yellow tint) in place of any "NEW" implicit treatment.
2. Action row: **View diff** (links to `/diff?mode=version-vs-version&artifactKey=…&fromSha=…&toSha=…`) and **Dismiss**.

The `fromSha` and `toSha` are already in the notification payload — no extra fetch needed to build the diff URL. `handleDismiss` works generically by key and requires no changes.

The count label (e.g. `"3 new · install or dismiss"`) is updated to reflect the combined total and kinds present.

---

## 4. Data Flow Summary

```
App start / poll tick
  └─ GET /api/notifications
       For each source repo artifact:
         baseline null?  → setBaseline(current SHA), skip
         SHA unchanged?  → skip
         SHA changed, not dismissed? → emit updated-artifact notification
       Return { newArtifacts, updatedArtifacts }

User clicks Dismiss on updated-artifact card
  └─ POST /api/notifications/dismiss { key: "updatedArtifact:…:newSha" }
       → mark key as dismissed
       → setBaseline(sourceRepoId, artifactKey, newSha)   ← baseline advances
  └─ Frontend removes card from state
```

---

## 5. Files Affected

| File | Change |
|------|--------|
| `src/state/artifact-sha-baseline.ts` | **New** — `ArtifactShaBaselineStore` |
| `src/server.ts` | Instantiate store, add to `ServerDeps` |
| `src/api/notifications.ts` | Updated-artifact detection + dismiss handler extension |
| `web/api.ts` | New type + extended `NotificationsResponse` |
| `web/pages/Dashboard.tsx` | Render updated-artifact cards |
| `tests/unit/notifications-stores.test.ts` | Tests for new store |
| `tests/integration/notifications-api.test.ts` | Integration tests for updated-artifact path |
| `tests/unit/dashboard.test.tsx` | Dashboard rendering tests for new card type |
