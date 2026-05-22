// web/pages/Browse.tsx
import { useEffect, useState } from "react";
import { api, Artifact } from "../api.ts";
import { InstallModal } from "../components/InstallModal.tsx";

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

  return (
    <>
      <h2 style={{ marginTop: 0 }}>Browse</h2>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" style={{ width: 360, marginBottom: 14 }} />
      <table className="table">
        <thead><tr><th>Name</th><th>Source</th><th>Description</th><th></th></tr></thead>
        <tbody>
          {artifacts.map((a) => (
            <tr key={a.artifactKey}>
              <td>{a.name}</td>
              <td style={{ color: "var(--muted)" }}>{a.sourceRepoId.slice(0, 8)}</td>
              <td style={{ color: "var(--muted)" }}>{a.description ?? "—"}</td>
              <td><button className="btn" onClick={() => setInstalling(a)}>Install</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {installing && <InstallModal artifact={installing} onClose={() => setInstalling(null)} onDone={() => setInstalling(null)} />}
    </>
  );
}
