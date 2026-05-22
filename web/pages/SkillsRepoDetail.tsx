import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, Artifact, SkillsRepo } from "../api.ts";

export function SkillsRepoDetail() {
  const { id = "" } = useParams();
  const [repo, setRepo] = useState<SkillsRepo | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getSkillsRepo(id).then(setRepo).catch((e: Error) => setError(e.message));
    api.listArtifacts({ sourceRepoId: id }).then(setArtifacts).catch(() => {});
  }, [id]);

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
        <thead><tr><th>Name</th><th>Type</th><th>Description</th><th>Path</th></tr></thead>
        <tbody>
          {artifacts.map((a) => (
            <tr key={a.artifactKey}>
              <td>{a.name}</td>
              <td>{a.type}</td>
              <td style={{ color: "var(--muted)" }}>{a.description ?? "—"}</td>
              <td style={{ color: "var(--muted)" }}>{a.rootRelativePath}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
