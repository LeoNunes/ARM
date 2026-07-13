# Browse Table: Column Sizing and Sortable Headers — Design

**Date:** 2026-07-13
**Status:** Approved

## 1. Goal

In `web/pages/Browse.tsx`, tighten the **Type** and **Install** columns to shrink-wrap their contents, give **Description** a visibly larger share of the row than the other text columns, and make **Name**, **Type**, and **Source** sortable by clicking their headers. Scoped entirely to Browse — the shared `.table` class in `web/styles/theme.css` (used by five other pages) is not touched.

## 2. Column widths

Add a `<colgroup>` to the Browse table (none exists today; columns currently size implicitly via inline `maxWidth`/content):

| Column | Width |
|---|---|
| Favorite star | fixed narrow (~32px) |
| Name | 20% |
| Type | `1%` + `white-space: nowrap` on header/cell (shrink-to-fit trick — collapses to the badge's width) |
| Source | 15% |
| Description | 45% (raised from today's ~320px cap; the largest text column) |
| Install | `1%` + `white-space: nowrap` (collapses to the button's width) |

The Description cell keeps its existing `description-clamp` line-clamp behavior for long text, just with more room.

## 3. Sorting

- Name, Type, and Source `<th>` become clickable (button-like, `cursor: pointer`).
- State: `sortKey: "name" | "type" | "source" | null` and `sortDir: "asc" | "desc"`, both local `useState` in `Browse`.
- Click behavior: clicking the active column's header flips `sortDir`; clicking a different sortable header sets it as `sortKey` with `sortDir` reset to `"asc"`.
- Active column shows a ▲ (asc) / ▼ (desc) marker next to its label; inactive sortable columns show no marker.
- Sorting is client-side over the already-fetched `artifacts` array (`useMemo`, recomputed when `artifacts`, `sortKey`, or `sortDir` change), via `localeCompare`:
  - Name → `a.name`
  - Type → the rendered label (`"skill"` / `"rule"`), not the raw `a.type`, so grouping matches what the user sees
  - Source → `a.sourceName`
- No backend/API changes. Description and the two icon-only columns remain unsortable.
- Sort state resets implicitly on remount only; it is not persisted across search/type-filter changes (changing `q` or `typeFilter` just re-sorts the new result set with the same `sortKey`/`sortDir`).

## 4. Out of scope

- Multi-column sort.
- Persisting sort choice across page reloads or navigation.
- Sorting Description or the star/install columns.
- Changes to any other page using the shared `.table` class.
