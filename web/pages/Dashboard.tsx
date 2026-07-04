import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.ts";
import type { NewArtifactNotification, UpdatedArtifactNotification, WorkingRepo, SkillsRepo, InstallWithStatus, ActivityLogEntry, ActivityCategory } from "../api.ts";
import { useAutoRefresh } from "../hooks/useAutoRefresh.ts";

export function Dashboard() {
  const [newArtifacts, setNewArtifacts] = useState<NewArtifactNotification[]>([]);
  const [updatedArtifacts, setUpdatedArtifacts] = useState<UpdatedArtifactNotification[]>([]);
  const [working, setWorking] = useState<WorkingRepo[]>([]);
  const [sources, setSources] = useState<SkillsRepo[]>([]);
  const [installsByWr, setInstallsByWr] = useState<Record<string, InstallWithStatus[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [activityEntries, setActivityEntries] = useState<ActivityLogEntry[]>([]);
  const [activityCategory, setActivityCategory] = useState<ActivityCategory | "all">("all");

  const load = async () => {
    try {
      const [notifs, wr, srcs] = await Promise.all([
        api.getNotifications(),
        api.listWorkingRepos(),
        api.listSkillsRepos(),
      ]);
      setNewArtifacts(notifs.newArtifacts);
      setUpdatedArtifacts(notifs.updatedArtifacts);
      setWorking(wr);
      setSources(srcs);
      const map: Record<string, InstallWithStatus[]> = {};
      await Promise.all(
        wr.map(async (w) => {
          map[w.id] = await api.listInstallsByWorkingRepo(w.id);
        }),
      );
      setInstallsByWr(map);
      const log = await api.getActivityLog({
        limit: 10,
        category: activityCategory === "all" ? undefined : activityCategory,
      });
      setActivityEntries(log);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => { load(); }, []);
  useAutoRefresh(load);

  const handleDismiss = async (key: string) => {
    try {
      await api.dismissNotification(key);
      setNewArtifacts((prev) => prev.filter((n) => n.key !== key));
      setUpdatedArtifacts((prev) => prev.filter((n) => n.key !== key));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const ACTIVITY_LABELS: Record<ActivityCategory, string> = {
    "auto-update": "Auto-update",
    "install":     "Install",
    "uninstall":   "Uninstall",
    "re-apply":    "Re-apply",
  };

  const ACTIVITY_STYLES: Record<ActivityCategory, React.CSSProperties> = {
    "auto-update": { background: "#cce5ff", color: "#004085" },
    "install":     { background: "#d4edda", color: "#155724" },
    "uninstall":   { background: "#f8d7da", color: "#721c24" },
    "re-apply":    { background: "#fff3cd", color: "#856404" },
  };

  function formatRelative(ts: string): string {
    const diff = Date.now() - new Date(ts).getTime();
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return new Date(ts).toLocaleDateString();
  }

  const handleDeleteActivity = async (id: string) => {
    try {
      await api.deleteActivityLogEntry(id);
      setActivityEntries((prev) => prev.filter((e) => e.id !== id));
    } catch {
      // silently ignore
    }
  };

  const hasNonUpToDate = (wrId: string) =>
    (installsByWr[wrId] ?? []).some((i) => i.status !== "up-to-date");

  const totalCards = newArtifacts.length + updatedArtifacts.length;
  const sectionLabel =
    newArtifacts.length > 0 && updatedArtifacts.length > 0 ? "NEW & UPDATED SKILLS"
    : newArtifacts.length > 0 ? "NEW SKILLS"
    : "UPDATED SKILLS";

  return (
    <>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      <h2 style={{ marginTop: 0 }}>Dashboard</h2>

      {totalCards > 0 && (
        <section style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.05em" }}>{sectionLabel}</span>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>{totalCards} · review or dismiss</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {newArtifacts.map((n) => (
              <div
                key={n.key}
                className="card"
                style={{ minWidth: 180, maxWidth: 180, padding: 10, fontSize: 11 }}
              >
                <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 2 }}>{n.name}</div>
                <div style={{ color: "var(--muted)", marginBottom: 8 }}>{n.sourceName}</div>
                {n.description && (
                  <div
                    className="description-clamp"
                    title={n.description}
                    style={{ color: "var(--text)", lineHeight: 1.35, minHeight: 42, marginBottom: 8 }}
                  >
                    {n.description}
                  </div>
                )}
                <div style={{ display: "flex", gap: 6 }}>
                  <Link
                    to={`/artifacts?artifactKey=${encodeURIComponent(n.artifactKey)}`}
                    className="btn"
                    style={{ fontSize: 10, padding: "3px 8px", textDecoration: "none" }}
                  >
                    View
                  </Link>
                  <button
                    className="btn secondary"
                    style={{ fontSize: 10, padding: "3px 4px" }}
                    onClick={() => handleDismiss(n.key)}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
            {updatedArtifacts.map((n) => (
              <div
                key={n.key}
                className="card"
                style={{ minWidth: 180, maxWidth: 180, padding: 10, fontSize: 11 }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                  <span style={{ fontWeight: 600, fontSize: 12 }}>{n.name}</span>
                  <span style={{
                    background: "#fff3cd", color: "#856404",
                    fontSize: 9, padding: "1px 5px", borderRadius: 3,
                    fontWeight: 700, letterSpacing: "0.03em",
                  }}>UPDATED</span>
                </div>
                <div style={{ color: "var(--muted)", marginBottom: 8 }}>{n.sourceName}</div>
                {n.description && (
                  <div
                    className="description-clamp"
                    title={n.description}
                    style={{ color: "var(--text)", lineHeight: 1.35, minHeight: 42, marginBottom: 8 }}
                  >
                    {n.description}
                  </div>
                )}
                <div style={{ display: "flex", gap: 6 }}>
                  <Link
                    to={`/diff?mode=version-vs-version&artifactKey=${encodeURIComponent(n.artifactKey)}&fromSha=${n.fromSha}&toSha=${n.toSha}`}
                    className="btn"
                    style={{ fontSize: 10, padding: "3px 8px", textDecoration: "none" }}
                  >
                    View diff
                  </Link>
                  <button
                    className="btn secondary"
                    style={{ fontSize: 10, padding: "3px 4px" }}
                    onClick={() => handleDismiss(n.key)}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section style={{ marginBottom: 28 }}>
        <span style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.05em" }}>WORKING REPOS</span>
        {working.length === 0 && (
          <p style={{ color: "var(--muted)" }}>No working repos yet — register one to get started.</p>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
          {working.map((w) => {
            const installs = installsByWr[w.id] ?? [];
            const hasAlert = hasNonUpToDate(w.id);
            return (
              <Link
                key={w.id}
                to={`/working-repos/${w.id}`}
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <div className="card" style={{ cursor: "pointer" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <strong style={{ fontSize: 13 }}>{w.name}</strong>
                    {hasAlert && (
                      <span
                        data-testid="notification-dot"
                        title="updates or drift to review"
                        style={{
                          width: 8, height: 8, borderRadius: "50%",
                          background: "var(--warn)",
                          display: "inline-block",
                        }}
                      />
                    )}
                    <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: 11 }}>{w.path}</span>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, fontSize: 11, color: "var(--muted)" }}>
                    {installs.length === 0 && <em>no installs yet</em>}
                    {installs.slice(0, 5).map((i) => {
                      const parts = i.artifactKey.split(":");
                      const name = parts[parts.length - 1]?.split("/").pop() ?? i.artifactKey;
                      return (
                        <span
                          key={i.id}
                          style={{ background: "rgba(255,255,255,0.06)", padding: "3px 8px", borderRadius: 3 }}
                        >
                          {name}
                        </span>
                      );
                    })}
                    {installs.length > 5 && (
                      <span style={{ background: "rgba(255,255,255,0.06)", padding: "3px 8px", borderRadius: 3 }}>
                        +{installs.length - 5} more
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <section>
        <span style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.05em" }}>SKILLS REPOS</span>
        {sources.length === 0 && <p style={{ color: "var(--muted)", marginTop: 8 }}>No sources registered.</p>}
        <div
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            fontSize: 11,
            marginTop: 8,
          }}
        >
          {sources.map((s, idx) => (
            <Link
              key={s.id}
              to={`/skills-repos/${s.id}`}
              style={{
                display: "flex", alignItems: "center", padding: "10px 12px",
                borderBottom: idx < sources.length - 1 ? "1px solid var(--border)" : "none",
                textDecoration: "none", color: "inherit",
              }}
            >
              <strong>{s.name}</strong>
              <span style={{ marginLeft: "auto", color: "var(--muted)" }}>
                {s.lastFetchedAt && `fetched ${new Date(s.lastFetchedAt).toLocaleTimeString()}`}
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.05em" }}>RECENT ACTIVITY</span>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <select
              value={activityCategory}
              onChange={(e) => {
                const cat = e.target.value as ActivityCategory | "all";
                setActivityCategory(cat);
                api.getActivityLog({ limit: 10, category: cat === "all" ? undefined : cat })
                  .then(setActivityEntries)
                  .catch(() => {});
              }}
              style={{ fontSize: 11 }}
            >
              <option value="all">All</option>
              {(Object.keys(ACTIVITY_LABELS) as ActivityCategory[]).map((c) => (
                <option key={c} value={c}>{ACTIVITY_LABELS[c]}</option>
              ))}
            </select>
            <Link to="/activity" style={{ fontSize: 11, color: "var(--muted)" }}>View all →</Link>
          </div>
        </div>
        {activityEntries.length === 0 && (
          <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>No activity yet.</p>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {activityEntries.map((e) => (
            <div
              key={e.id}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "7px 12px",
                background: "rgba(255,255,255,0.03)", borderRadius: 4, fontSize: 12,
              }}
            >
              <span style={{ color: "var(--muted)", minWidth: 72, flexShrink: 0 }}>
                {formatRelative(e.ts)}
              </span>
              <span style={{
                ...ACTIVITY_STYLES[e.category],
                padding: "1px 7px", borderRadius: 10, fontWeight: 600, whiteSpace: "nowrap", fontSize: 11,
              }}>
                {ACTIVITY_LABELS[e.category]}
              </span>
              <span style={{ flex: 1 }}>{e.summary}</span>
              {e.detail && (
                <span style={{ color: "var(--muted)", fontFamily: "monospace", fontSize: 11 }}>
                  {e.detail}
                </span>
              )}
              <button
                title="Delete entry"
                onClick={() => handleDeleteActivity(e.id)}
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
      </section>
    </>
  );
}
