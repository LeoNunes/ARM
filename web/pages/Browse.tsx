// web/pages/Browse.tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, Artifact } from "../api.ts";
import { InstallModal } from "../components/InstallModal.tsx";
import { FavoriteStar } from "../components/FavoriteStar.tsx";
import { useAutoRefresh } from "../hooks/useAutoRefresh.ts";

export function Browse() {
  const [q, setQ] = useState("");
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [installing, setInstalling] = useState<Artifact | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    api.listArtifacts({ q: q || undefined }, ac.signal)
      .then(setArtifacts)
      .catch(() => {});
    return () => ac.abort();
  }, [q]);

  useAutoRefresh(() => {
    const ac = new AbortController();
    api.listArtifacts({ q: q || undefined }, ac.signal)
      .then(setArtifacts)
      .catch(() => {});
  });

  const handleToggleFavorite = async (a: Artifact) => {
    const next = !a.isFavorite;
    setArtifacts((prev) => prev.map((x) => (x.artifactKey === a.artifactKey ? { ...x, isFavorite: next } : x)));
    try {
      await api.setFavorite(a.artifactKey, next);
      setArtifacts(await api.listArtifacts({ q: q || undefined }));
    } catch (e) {
      setArtifacts((prev) => prev.map((x) => (x.artifactKey === a.artifactKey ? { ...x, isFavorite: !next } : x)));
      alert((e as Error).message);
    }
  };

  return (
    <>
      <h2 style={{ marginTop: 0 }}>Browse</h2>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" style={{ width: 360, marginBottom: 14 }} />
      <table className="table">
        <thead><tr><th></th><th>Name</th><th>Source</th><th>Description</th><th></th></tr></thead>
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
              <td style={{ color: "var(--muted)" }}>
                <Link to={`/skills-repos/${a.sourceRepoId}`} style={{ color: "inherit" }}>
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
