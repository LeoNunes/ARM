import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, Artifact, SkillsRepo } from "../api.ts";
import { FavoriteStar } from "../components/FavoriteStar.tsx";

export function SkillsRepoDetail() {
  const { id = "" } = useParams();
  const [repo, setRepo] = useState<SkillsRepo | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getSkillsRepo(id).then(setRepo).catch((e: Error) => setError(e.message));
    api.listArtifacts({ sourceRepoId: id }).then(setArtifacts).catch(() => {});
  }, [id]);

  const handleToggleFavorite = async (a: Artifact) => {
    const next = !a.isFavorite;
    setArtifacts((prev) => prev.map((x) => (x.artifactKey === a.artifactKey ? { ...x, isFavorite: next } : x)));
    try {
      await api.setFavorite(a.artifactKey, next);
      setArtifacts(await api.listArtifacts({ sourceRepoId: id }));
    } catch (e) {
      setArtifacts((prev) => prev.map((x) => (x.artifactKey === a.artifactKey ? { ...x, isFavorite: !next } : x)));
      alert((e as Error).message);
    }
  };

  if (error) return <p style={{ color: "red" }}>Error: {error}</p>;
  if (!repo) return <p>Loading…</p>;

  return (
    <>
      <p style={{ color: "var(--muted)", fontSize: 12 }}><Link to="/skills-repos">Skills repos</Link> / {repo.name}</p>
      <h2 style={{ marginTop: 0 }}>{repo.name}</h2>
      <div className="card" style={{ marginBottom: 16, fontSize: 13 }}>
        <div><strong>Git URL:</strong> {repo.gitUrl}</div>
        <div><strong>Branch:</strong> {repo.branch}</div>
        <div><strong>Skills paths:</strong> {(repo.artifactPaths.skills ?? []).join(", ") || "(none)"}</div>
        <div style={{ color: "var(--muted)", marginTop: 6 }}>Last fetched: {repo.lastFetchedAt ?? "—"}</div>
        <button className="btn secondary" style={{ marginTop: 8 }} onClick={async () => {
          try {
            const updated = await api.refreshSkillsRepo(repo.id);
            setRepo(updated);
            setArtifacts(await api.listArtifacts({ sourceRepoId: repo.id }));
          } catch (err) {
            alert((err as Error).message);
          }
        }}>Refresh</button>
      </div>
      <h3>Discovered artifacts</h3>
      <table className="table">
        <thead><tr><th></th><th>Name</th><th>Type</th><th>Description</th><th>Path</th></tr></thead>
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
              <td>{a.type}</td>
              <td style={{ color: "var(--muted)" }}>
                {a.description ? (
                  <div className="description-clamp" title={a.description} style={{ maxWidth: 320 }}>
                    {a.description}
                  </div>
                ) : (
                  "—"
                )}
              </td>
              <td style={{ color: "var(--muted)" }}>{a.rootRelativePath}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
