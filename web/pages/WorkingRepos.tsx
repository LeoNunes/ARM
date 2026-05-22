import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, WorkingRepo } from "../api.ts";
import { RegisterWorkingRepoModal } from "../components/RegisterWorkingRepoModal.tsx";

export function WorkingRepos() {
  const [repos, setRepos] = useState<WorkingRepo[]>([]);
  const [open, setOpen] = useState(false);
  const reload = () => { api.listWorkingRepos().then(setRepos); };
  useEffect(reload, []);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Working repos</h2>
        <button className="btn" style={{ marginLeft: "auto" }} onClick={() => setOpen(true)}>+ Register</button>
      </div>
      <table className="table">
        <thead><tr><th>Name</th><th>Path</th><th></th></tr></thead>
        <tbody>
          {repos.map((r) => (
            <tr key={r.id}>
              <td><Link to={`/working-repos/${r.id}`}>{r.name}</Link></td>
              <td style={{ color: "var(--muted)" }}>{r.path}</td>
              <td><button className="btn secondary" onClick={async () => { await api.deleteWorkingRepo(r.id); reload(); }}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {open && <RegisterWorkingRepoModal onClose={() => setOpen(false)} onDone={() => { setOpen(false); reload(); }} />}
    </>
  );
}
