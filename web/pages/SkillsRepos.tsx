import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, SkillsRepo, ArtifactBlocker } from "../api.ts";
import { RegisterSkillsRepoModal } from "../components/RegisterSkillsRepoModal.tsx";
import { EditSkillsRepoModal } from "../components/EditSkillsRepoModal.tsx";

export function SkillsRepos() {
  const [repos, setRepos] = useState<SkillsRepo[]>([]);
  const [open, setOpen] = useState(false);
  const [editRepo, setEditRepo] = useState<SkillsRepo | null>(null);
  const [removeBlockers, setRemoveBlockers] = useState<{ repoName: string; blockers: ArtifactBlocker[] } | null>(null);

  const reload = () => { api.listSkillsRepos().then(setRepos); };
  useEffect(reload, []);

  const remove = async (r: SkillsRepo) => {
    setRemoveBlockers(null);
    try {
      await api.deleteSkillsRepo(r.id);
      reload();
    } catch (e) {
      const err = e as Error & { code?: string; blockers?: ArtifactBlocker[] };
      if (err.code === "repo_in_use" && err.blockers) setRemoveBlockers({ repoName: r.name, blockers: err.blockers });
      else alert(err.message);
    }
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Skills repos</h2>
        <button className="btn" style={{ marginLeft: "auto" }} onClick={() => setOpen(true)}>+ Register</button>
      </div>
      {removeBlockers && (
        <div className="card" style={{ marginBottom: 16, color: "var(--danger)", fontSize: 13 }}>
          Can't remove <strong>{removeBlockers.repoName}</strong> — still installed:{" "}
          {removeBlockers.blockers.map((a, i) => (
            <span key={a.artifactKey}>
              {i > 0 && ", "}
              <Link to={`/artifacts?artifactKey=${encodeURIComponent(a.artifactKey)}`}>{a.name}</Link>
            </span>
          ))}
        </div>
      )}
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
                <button className="btn secondary" onClick={() => remove(r)}>Remove</button>
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
