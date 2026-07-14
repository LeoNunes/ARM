import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, SkillsRepo } from "../api.ts";
import { RegisterSkillsRepoModal } from "../components/RegisterSkillsRepoModal.tsx";
import { EditSkillsRepoModal } from "../components/EditSkillsRepoModal.tsx";

export function SkillsRepos() {
  const [repos, setRepos] = useState<SkillsRepo[]>([]);
  const [open, setOpen] = useState(false);
  const [editRepo, setEditRepo] = useState<SkillsRepo | null>(null);

  const reload = () => { api.listSkillsRepos().then(setRepos); };
  useEffect(reload, []);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Skills repos</h2>
        <button className="btn" style={{ marginLeft: "auto" }} onClick={() => setOpen(true)}>+ Register</button>
      </div>
      <table className="table">
        <thead><tr><th>Name</th><th>Git URL</th><th>Branch</th><th>Skills paths</th><th>Rules paths</th><th></th></tr></thead>
        <tbody>
          {repos.map((r) => (
            <tr key={r.id}>
              <td><Link to={`/skills-repos/${r.id}`}>{r.name}</Link></td>
              <td style={{ color: "var(--muted)" }}>{r.gitUrl}</td>
              <td>{r.branch}</td>
              <td>{(r.artifactPaths.skills ?? []).join(", ")}</td>
              <td>{(r.artifactPaths.rules ?? []).join(", ")}</td>
              <td>
                <button className="btn secondary" onClick={() => setEditRepo(r)}>Edit</button>{" "}
                <button className="btn secondary" onClick={async () => { await api.deleteSkillsRepo(r.id); reload(); }}>Remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {open && <RegisterSkillsRepoModal onClose={() => setOpen(false)} onDone={() => { setOpen(false); reload(); }} />}
      {editRepo && <EditSkillsRepoModal repo={editRepo} onClose={() => setEditRepo(null)} onDone={() => { setEditRepo(null); reload(); }} />}
    </>
  );
}
