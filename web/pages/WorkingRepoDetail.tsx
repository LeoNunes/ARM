import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, InstallWithStatus, WorkingRepo } from "../api.ts";
import { StatusPill } from "../components/StatusPill.tsx";

type FilterChip = "all" | "update-available" | "drifted";

export function WorkingRepoDetail() {
  const { id = "" } = useParams();
  const [repo, setRepo] = useState<WorkingRepo | null>(null);
  const [installs, setInstalls] = useState<InstallWithStatus[]>([]);
  const [filter, setFilter] = useState<FilterChip>("all");
  const [refreshing, setRefreshing] = useState(false);

  const reload = () => {
    api.listWorkingRepos().then((all) => setRepo(all.find((r) => r.id === id) ?? null));
    api.listInstallsByWorkingRepo(id).then(setInstalls);
  };
  useEffect(reload, [id]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const updated = await api.refreshWorkingRepo(id);
      setInstalls(updated);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  const filtered = installs.filter((i) => {
    if (filter === "all") return true;
    if (filter === "update-available") return i.status === "update-available" || i.status === "update-available+drifted";
    if (filter === "drifted") return i.status === "drifted" || i.status === "update-available+drifted";
    return true;
  });

  if (!repo) return <p>Loading…</p>;

  return (
    <>
      <p style={{ color: "var(--muted)", fontSize: 12 }}>
        <Link to="/working-repos">Working repos</Link> / {repo.name}
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>{repo.name}</h2>
        <button className="btn secondary" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      <div className="card" style={{ marginBottom: 16, fontSize: 13 }}>
        <div><strong>Path:</strong> {repo.path}</div>
        <div style={{ color: "var(--muted)" }}>Added {repo.addedAt}</div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {(["all", "update-available", "drifted"] as FilterChip[]).map((chip) => (
          <button
            key={chip}
            role="button"
            className={`btn ${filter === chip ? "primary" : "secondary"}`}
            style={{ fontSize: 12, padding: "3px 10px" }}
            onClick={() => setFilter(chip)}
          >
            {chip === "all" ? "All" : chip === "update-available" ? "Update available" : "Drifted"}
          </button>
        ))}
      </div>

      <h3 style={{ marginTop: 0 }}>Installed</h3>
      <table className="table">
        <thead>
          <tr>
            <th>Skill</th>
            <th>Source</th>
            <th>Agent</th>
            <th>Version</th>
            <th>Status</th>
            <th>Auto-update</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((i) => {
            const [, rel] = i.artifactKey.split(":", 2);
            const name = rel?.split("/").pop() ?? rel;
            return (
              <tr key={i.id}>
                <td>{name}</td>
                <td style={{ color: "var(--muted)" }}>{i.sourceRepoId.slice(0, 8)}</td>
                <td>{i.agent}</td>
                <td style={{ color: "var(--muted)" }}>{i.installedCommitSha.slice(0, 7)}</td>
                <td><StatusPill status={i.status} /></td>
                <td>{i.autoUpdate ? "on" : "off"}</td>
                <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {i.status === "update-available+drifted" && (
                    <>
                      <button
                        className="btn secondary"
                        style={{ fontSize: 12 }}
                        onClick={async () => {
                          try {
                            await api.updateInstall(i.id, { autoUpdate: false });
                            reload();
                          } catch (err) {
                            alert((err as Error).message);
                          }
                        }}
                      >
                        Disable auto-update
                      </button>
                      <button
                        className="btn secondary"
                        style={{ fontSize: 12 }}
                        onClick={async () => {
                          try {
                            await api.applyInstallUpdate(i.id);
                            reload();
                          } catch (err) {
                            alert((err as Error).message);
                          }
                        }}
                      >
                        Discard & update
                      </button>
                    </>
                  )}
                  {i.status === "update-available" && (
                    <button
                      className="btn secondary"
                      style={{ fontSize: 12 }}
                      onClick={async () => {
                        try {
                          await api.applyInstallUpdate(i.id);
                          reload();
                        } catch (err) {
                          alert((err as Error).message);
                        }
                      }}
                    >
                      Update
                    </button>
                  )}
                  <button
                    className="btn secondary"
                    onClick={async () => {
                      try {
                        await api.deleteInstall(i.id);
                        reload();
                      } catch (err) {
                        alert((err as Error).message);
                      }
                    }}
                  >
                    Uninstall
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
