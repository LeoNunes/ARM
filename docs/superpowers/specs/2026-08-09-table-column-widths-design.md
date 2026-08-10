# Table Column Widths Across All Pages — Design

**Date:** 2026-08-09
**Status:** Approved

## 1. Goal

Every table in the app (`web/pages/*.tsx`) is a plain HTML `<table className="table">`. Only `Browse.tsx` currently constrains column widths (via `<colgroup>`, added in the [2026-07-13 Browse design](./2026-07-13-browse-table-columns-and-sort-design.md)). The other six table instances size columns implicitly by content, which lets icon-only, badge, and action-button columns grow wider than their content needs, and gives no guaranteed room to free-text columns (names, paths, URLs).

This design introduces a small set of shared width utility classes in `web/styles/theme.css` and applies them, via a `<colgroup>`, to every table in the app — including refactoring `Browse.tsx` onto the shared classes so the pattern lives in one place instead of being reinvented per page.

## 2. Shared CSS utility classes

Added to `web/styles/theme.css`, next to the existing `.table` rules:

| Class | Rule | Purpose |
|---|---|---|
| `.col-icon` | `width: 1%; white-space: nowrap; text-align: center;` | Icon-only columns with no header label (favorite-star toggle). Uses the same shrink-to-fit trick as `.col-shrink` (a fixed `px` width is only a hint in auto table layout and can be stretched by leftover space) plus centering for the icon. |
| `.col-shrink` | `width: 1%; white-space: nowrap;` | Shrink-to-fit columns: badges/pills, short fixed-format values (on/off, short SHAs, dates), and single/double-button action cells. Same "1% + nowrap" trick already used for Browse's Type/Install columns. |
| `.col-truncate` | `max-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;` | Free-text columns that can run long (names, paths, URLs, commit subjects). Paired with a `%` width on the corresponding `<col>`. The cell also gets a `title={value}` attribute so the full value is visible on hover. |
| `.col-actions-wrap` | `width: 22%;` (cell content keeps its existing `display: flex; flexWrap: wrap` inline style) | Action cells that can render multiple buttons and already wrap internally. Wider than `.col-shrink` so 2+ buttons sit per row instead of stacking into a tall single column. |

`.description-clamp` (existing, unchanged) continues to be used for artifact Description columns — 4-line clamp with ellipsis, not single-line truncation, per explicit product decision that descriptions should wrap rather than truncate to one line.

## 3. Per-table widths

All widths are set via a `<colgroup>` added to each table (mirroring the existing Browse pattern). Percentages are relative weights across a table's flexible columns, not required to sum to exactly 100 — `.col-shrink`/`.col-icon` columns take their minimum/fixed space first and the `%` columns split the remainder.

### `WorkingRepos.tsx` — Name, Path, [Remove]
| Column | Width | Class |
|---|---|---|
| Name | 30% | `col-truncate` |
| Path | 65% | `col-truncate` |
| *(action)* | shrink | `col-shrink` |

### `Browse.tsx` — refactor onto shared classes (values unchanged)
| Column | Width | Class |
|---|---|---|
| ★ favorite | 32px | `col-icon` |
| Name | 20% | `col-truncate` |
| Type | shrink | `col-shrink` |
| Source | 15% | `col-truncate` |
| Description | 45% | `description-clamp` |
| *(action)* | shrink | `col-shrink` |

### `SkillsRepos.tsx` — Name, Git URL, Branch, Skills paths, Rules paths, [Edit/Remove]
| Column | Width | Class |
|---|---|---|
| Name | 16% | `col-truncate` |
| Git URL | 28% | `col-truncate` |
| Branch | 10% | `col-truncate` |
| Skills paths | 18% | `col-truncate` |
| Rules paths | 18% | `col-truncate` |
| *(action)* | shrink | `col-shrink` |

### `SkillsRepoDetail.tsx` — ★, Name, Type, Description, Path
| Column | Width | Class |
|---|---|---|
| ★ favorite | 32px | `col-icon` |
| Name | 20% | `col-truncate` |
| Type | shrink | `col-shrink` |
| Description | 45% | `description-clamp` (drop the current hardcoded `maxWidth: 320` inline style on the wrapping `<div>` — the column `%` now controls the width, matching Browse) |
| Path | 25% | `col-truncate` |

### `WorkingRepoDetail.tsx` — Skill, Source, Agent, Version, Status, Auto-update, [multi-button actions]
| Column | Width | Class |
|---|---|---|
| Skill | 26% | `col-truncate` |
| Source | shrink | `col-shrink` (fixed 8-char id) |
| Agent | shrink | `col-shrink` |
| Version | shrink | `col-shrink` (fixed 7-char sha) |
| Status | shrink | `col-shrink` (pill) |
| Auto-update | shrink | `col-shrink` |
| *(actions)* | 26% | `col-actions-wrap` |

### `ArtifactDetail.tsx` — Version History table: SHA, Date, Subject, [Compare]
| Column | Width | Class |
|---|---|---|
| SHA | shrink | `col-shrink` |
| Date | shrink | `col-shrink` |
| Subject | remaining (≈70%) | `col-truncate` |
| *(action)* | shrink | `col-shrink` |

### `ArtifactDetail.tsx` — Installs table: Target, Agent, Installed version, Status, Auto-update, [multi-button actions]
| Column | Width | Class |
|---|---|---|
| Target | 24% | `col-truncate` |
| Agent | shrink | `col-shrink` |
| Installed version | shrink | `col-shrink` |
| Status | shrink | `col-shrink` |
| Auto-update | shrink | `col-shrink` |
| *(actions)* | 30% | `col-actions-wrap` (widest — this cell can render up to 5 buttons: View diff, View drift, Disable auto-update, Discard & update, Uninstall) |

## 4. Truncation behavior

Every `.col-truncate` cell gets:
- A `title={fullValue}` attribute on the cell (or its content wrapper) so the untruncated value shows on hover, matching the existing Source-column pattern in Browse.
- Single-line ellipsis truncation — no wrapping.

Description columns are the only exception: they keep `.description-clamp` (wrap, clamped to 4 lines, ellipsis after that), per explicit decision that descriptions should remain readable rather than collapse to one line.

## 5. Out of scope

- Sorting behavior (already handled for Browse; not extended to other tables here).
- Any change to table libraries or a move away from plain `<table>` markup.
- Responsive/mobile-specific column behavior (e.g. hiding columns at narrow widths).
- Row height/vertical padding changes — only column width is addressed.

Final pixel/percentage values are expected to be tuned visually once implemented (per user request to test in-browser and adjust), but the class taxonomy and which columns get which treatment are locked in by this design.
