// web/pages/Dashboard.tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, SkillsRepo, WorkingRepo, Install } from "../api.ts";

export function Dashboard() {
  const [working, setWorking] = useState<WorkingRepo[]>([]);
  const [sources, setSources] = useState<SkillsRepo[]>([]);
  const [installsByWr, setInstallsByWr] = useState<Record<string, Install[]>>({});

  useEffect(() => {
    (async () => {
      const wr = await api.listWorkingRepos();
      setWorking(wr);
      setSources(await api.listSkillsRepos());
      const map: Record<string, Install[]> = {};
      for (const w of wr) map[w.id] = await api.listInstallsByWorkingRepo(w.id);
      setInstallsByWr(map);
    })();
  }, []);

  return (
    <>
      <h2 style={{ marginTop: 0 }}>Dashboard</h2>
      <section style={{ marginBottom: 28 }}>
        <h3>Working repos</h3>
        {working.length === 0 && <p style={{ color: "var(--muted)" }}>No working repos yet — register one to get started.</p>}
        {working.map((w) => (
          <div key={w.id} className="card" style={{ marginBottom: 10 }}>
            <Link to={`/working-repos/${w.id}`} style={{ color: "var(--text)", textDecoration: "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <strong>{w.name}</strong>
                <span style={{ color: "var(--muted)", fontSize: 12, marginLeft: "auto" }}>{w.path}</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, fontSize: 12, color: "var(--muted)" }}>
                {(installsByWr[w.id] ?? []).map((i) => (
                  <span key={i.id} style={{ background: "rgba(255,255,255,0.06)", padding: "3px 8px", borderRadius: 3 }}>
                    {i.artifactKey.split("/").pop()}
                  </span>
                ))}
                {(installsByWr[w.id] ?? []).length === 0 && <em>no installs yet</em>}
              </div>
            </Link>
          </div>
        ))}
      </section>
      <section>
        <h3>Skills repos</h3>
        {sources.length === 0 && <p style={{ color: "var(--muted)" }}>No sources registered.</p>}
        <table className="table">
          <tbody>
            {sources.map((s) => (
              <tr key={s.id}>
                <td><Link to={`/skills-repos/${s.id}`}>{s.name}</Link></td>
                <td style={{ color: "var(--muted)" }}>{s.gitUrl}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
