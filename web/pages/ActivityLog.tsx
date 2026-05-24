import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { ActivityLogEntry, ActivityCategory } from "../api.ts";

const CATEGORY_LABELS: Record<ActivityCategory, string> = {
  "auto-update": "Auto-update",
  "install":     "Install",
  "uninstall":   "Uninstall",
  "re-apply":    "Re-apply",
  "refresh":     "Refresh",
};

const CATEGORY_STYLES: Record<ActivityCategory, React.CSSProperties> = {
  "auto-update": { background: "#cce5ff", color: "#004085" },
  "install":     { background: "#d4edda", color: "#155724" },
  "uninstall":   { background: "#f8d7da", color: "#721c24" },
  "re-apply":    { background: "#fff3cd", color: "#856404" },
  "refresh":     { background: "rgba(255,255,255,0.08)", color: "var(--muted)" },
};

function formatRelative(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export function ActivityLog() {
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [category, setCategory] = useState<ActivityCategory | "all">("all");
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api
      .getActivityLog({ category: category === "all" ? undefined : category })
      .then(setEntries)
      .catch((e) => setError((e as Error).message));
  };

  useEffect(load, [category]);

  const handleDelete = async (id: string) => {
    try {
      await api.deleteActivityLogEntry(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch {
      // silently ignore
    }
  };

  return (
    <>
      <h2 style={{ marginTop: 0 }}>Activity</h2>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>Filter:</label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as ActivityCategory | "all")}
          style={{ fontSize: 12 }}
        >
          <option value="all">All</option>
          {(Object.keys(CATEGORY_LABELS) as ActivityCategory[]).map((c) => (
            <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
          ))}
        </select>
      </div>

      {entries.length === 0 && <p style={{ color: "var(--muted)" }}>No activity yet.</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {entries.map((e) => (
          <div
            key={e.id}
            style={{
              display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
              background: "rgba(255,255,255,0.03)", borderRadius: 4, fontSize: 12,
            }}
          >
            <span style={{ color: "var(--muted)", minWidth: 72, flexShrink: 0 }}>
              {formatRelative(e.ts)}
            </span>
            <span style={{
              ...CATEGORY_STYLES[e.category],
              padding: "1px 7px", borderRadius: 10,
              fontWeight: 600, whiteSpace: "nowrap", fontSize: 11,
            }}>
              {CATEGORY_LABELS[e.category]}
            </span>
            <span style={{ flex: 1 }}>{e.summary}</span>
            {e.detail && (
              <span style={{ color: "var(--muted)", fontFamily: "monospace", fontSize: 11 }}>
                {e.detail}
              </span>
            )}
            <button
              title="Delete entry"
              onClick={() => handleDelete(e.id)}
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: "var(--muted)", padding: "2px 6px", fontSize: 13, lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
