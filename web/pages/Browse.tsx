// web/pages/Browse.tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, Artifact } from "../api.ts";
import { InstallModal } from "../components/InstallModal.tsx";
import { FavoriteStar } from "../components/FavoriteStar.tsx";
import { useAutoRefresh } from "../hooks/useAutoRefresh.ts";

export function Browse() {
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [installing, setInstalling] = useState<Artifact | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    api.listArtifacts({ q: q || undefined, type: typeFilter || undefined }, ac.signal)
      .then(setArtifacts)
      .catch(() => {});
    return () => ac.abort();
  }, [q, typeFilter]);

  useAutoRefresh(() => {
    const ac = new AbortController();
    api.listArtifacts({ q: q || undefined, type: typeFilter || undefined }, ac.signal)
      .then(setArtifacts)
      .catch(() => {});
  });

  const handleToggleFavorite = async (a: Artifact) => {
    const next = !a.isFavorite;
    setArtifacts((prev) => prev.map((x) => (x.artifactKey === a.artifactKey ? { ...x, isFavorite: next } : x)));
    try {
      await api.setFavorite(a.artifactKey, next);
      setArtifacts(await api.listArtifacts({ q: q || undefined, type: typeFilter || undefined }));
    } catch (e) {
      setArtifacts((prev) => prev.map((x) => (x.artifactKey === a.artifactKey ? { ...x, isFavorite: !next } : x)));
      alert((e as Error).message);
    }
  };

  return (
    <>
      <h2 style={{ marginTop: 0 }}>Browse</h2>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" style={{ width: 360 }} />
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Type">
          <option value="">All types</option>
          <option value="skills">Skills</option>
          <option value="rules">Rules</option>
        </select>
      </div>
      <table className="table">
        <thead><tr><th></th><th>Name</th><th>Type</th><th>Source</th><th>Description</th><th></th></tr></thead>
        <tbody>
          {artifacts.map((a) => (
            <tr key={a.artifactKey}>
              <td>
                <FavoriteStar favorited={a.isFavorite} onToggle={() => handleToggleFavorite(a)} />
              </td>
              <td>
                <Link
                  to={`/artifacts?artifactKey=${encodeURIComponent(a.artifactKey)}`}
                  style={{ color: "inherit", textDecoration: "none", fontWeight: 500 }}
                >
                  {a.name}
                </Link>
              </td>
              <td>
                <span style={{
                  fontSize: 11, padding: "2px 8px", borderRadius: 10,
                  background: "rgba(255,255,255,0.08)", color: "var(--muted)",
                }}>
                  {a.type === "skills" ? "skill" : "rule"}
                </span>
              </td>
              <td style={{ color: "var(--muted)" }}>
                <Link
                  to={`/skills-repos/${a.sourceRepoId}`}
                  title={a.sourceName}
                  style={{
                    color: "inherit",
                    textDecoration: "none",
                    display: "inline-block",
                    maxWidth: 200,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    verticalAlign: "bottom",
                  }}
                >
                  {a.sourceName}
                </Link>
              </td>
              <td style={{ color: "var(--muted)" }}>
                {a.description ? (
                  <div className="description-clamp" title={a.description} style={{ maxWidth: 320 }}>
                    {a.description}
                  </div>
                ) : (
                  "—"
                )}
              </td>
              <td><button className="btn" onClick={() => setInstalling(a)}>Install</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {installing && <InstallModal artifact={installing} onClose={() => setInstalling(null)} onDone={() => setInstalling(null)} />}
    </>
  );
}
