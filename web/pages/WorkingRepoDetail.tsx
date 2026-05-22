import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, Install, WorkingRepo } from "../api.ts";

export function WorkingRepoDetail() {
  const { id = "" } = useParams();
  const [repo, setRepo] = useState<WorkingRepo | null>(null);
  const [installs, setInstalls] = useState<Install[]>([]);

  const reload = () => {
    api.listWorkingRepos().then((all) => setRepo(all.find((r) => r.id === id) ?? null));
    api.listInstallsByWorkingRepo(id).then(setInstalls);
  };
  useEffect(reload, [id]);

  if (!repo) return <p>Loading…</p>;
  return (
    <>
      <p style={{ color: "var(--muted)", fontSize: 12 }}><Link to="/working-repos">Working repos</Link> / {repo.name}</p>
      <h2 style={{ marginTop: 0 }}>{repo.name}</h2>
      <div className="card" style={{ marginBottom: 16, fontSize: 13 }}>
        <div><strong>Path:</strong> {repo.path}</div>
        <div style={{ color: "var(--muted)" }}>Added {repo.addedAt}</div>
      </div>
      <h3>Installed</h3>
      <table className="table">
        <thead><tr><th>Skill</th><th>Source</th><th>Agent</th><th>Version</th><th>Auto-update</th><th></th></tr></thead>
        <tbody>
          {installs.map((i) => {
            const [, rel] = i.artifactKey.split(":", 2);
            return (
              <tr key={i.id}>
                <td>{rel?.split("/").pop()}</td>
                <td style={{ color: "var(--muted)" }}>{i.sourceRepoId.slice(0, 8)}</td>
                <td>{i.agent}</td>
                <td style={{ color: "var(--muted)" }}>{i.installedCommitSha.slice(0, 7)}</td>
                <td>{i.autoUpdate ? "on" : "off"}</td>
                <td><button className="btn secondary" onClick={async () => {
                  try {
                    await api.deleteInstall(i.id);
                    reload();
                  } catch (err) {
                    alert((err as Error).message);
                  }
                }}>Uninstall</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
