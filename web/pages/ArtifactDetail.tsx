import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, Artifact, CommitSummary, InstallWithStatus, WorkingRepo } from "../api.ts";
import { InstallModal } from "../components/InstallModal.tsx";
import { StatusPill } from "../components/StatusPill.tsx";

export function ArtifactDetail() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const artifactKey = decodeURIComponent(params.get("artifactKey") ?? "");

  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [history, setHistory] = useState<CommitSummary[]>([]);
  const [installs, setInstalls] = useState<InstallWithStatus[]>([]);
  const [workingRepos, setWorkingRepos] = useState<WorkingRepo[]>([]);
  const [selectedSha, setSelectedSha] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [comparingSha, setComparingSha] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    if (!artifactKey) return;
    try {
      const [a, h, inst, wrs] = await Promise.all([
        api.getArtifact(artifactKey),
        api.getArtifactHistory(artifactKey),
        api.listInstallsByArtifact(artifactKey),
        api.listWorkingRepos(),
      ]);
      setArtifact(a);
      setHistory(h);
      setInstalls(inst);
      setWorkingRepos(wrs);
      setSelectedSha((prev) => prev ?? a.lastTouchedSha);
      setSelectedFile((prev) => prev ?? (a.files[0] ?? null));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => { reload(); }, [artifactKey]);

  useEffect(() => {
    if (!selectedFile || !selectedSha || !artifactKey) return;
    let cancelled = false;
    setFileLoading(true);
    setFileContent(null);
    api.getArtifactFile(artifactKey, selectedFile, selectedSha)
      .then((c) => { if (!cancelled) setFileContent(c); })
      .catch(() => { if (!cancelled) setFileContent("(failed to load)"); })
      .finally(() => { if (!cancelled) setFileLoading(false); });
    return () => { cancelled = true; };
  }, [selectedFile, selectedSha, artifactKey]);

  const handleUninstall = async (id: string) => {
    try { await api.deleteInstall(id); reload(); } catch (e) { alert((e as Error).message); }
  };
  const handleUpdate = async (id: string) => {
    try { await api.applyInstallUpdate(id); reload(); } catch (e) { alert((e as Error).message); }
  };
  const handleReapply = async (id: string) => {
    try { await api.reapplyInstall(id); reload(); } catch (e) { alert((e as Error).message); }
  };
  const handleDisableAutoUpdate = async (id: string) => {
    try { await api.updateInstall(id, { autoUpdate: false }); reload(); } catch (e) { alert((e as Error).message); }
  };

  const wrById = new Map(workingRepos.map((w) => [w.id, w]));
  const shaInHistory = selectedSha ? history.some((h) => h.sha === selectedSha) : false;

  if (!artifactKey) return <p style={{ color: "var(--danger)" }}>No artifact key specified.</p>;
  if (error) return <p style={{ color: "var(--danger)" }}>{error}</p>;
  if (!artifact) return <p>Loading…</p>;

  const artifactName = artifact.name;

  return (
    <>
      {/* Breadcrumb */}
      <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 0 }}>
        <Link to="/browse">Browse</Link> / {artifactName}
      </p>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>{artifactName}</h2>
        <span style={{
          fontSize: 11, padding: "2px 8px", borderRadius: 10,
          background: "rgba(255,255,255,0.08)", color: "var(--muted)",
        }}>
          {artifact.type === "skills" ? "skill" : artifact.type}
        </span>
        <button className="btn" style={{ marginLeft: "auto" }} onClick={() => setInstalling(true)}>
          Install
        </button>
      </div>
      {artifact.description && (
        <p style={{ color: "var(--muted)", marginTop: 4, marginBottom: 4, fontSize: 13 }}>
          {artifact.description}
        </p>
      )}
      <p style={{ color: "var(--muted)", fontSize: 12, marginBottom: 20 }}>
        Source: {artifact.sourceRepoId.slice(0, 8)}
      </p>

      {/* File Viewer */}
      <section style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Files</h3>
          <select
            value={selectedSha ?? ""}
            onChange={(e) => { setSelectedSha(e.target.value || null); }}
            style={{ fontSize: 12 }}
          >
            {selectedSha && !shaInHistory && (
              <option value={selectedSha}>{selectedSha.slice(0, 7)} (current)</option>
            )}
            {history.map((h) => (
              <option key={h.sha} value={h.sha}>
                {h.sha.slice(0, 7)} · {h.date.slice(0, 10)} · {h.subject}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden", minHeight: 300 }}>
          {/* File picker */}
          <div style={{
            width: 180, background: "rgba(255,255,255,0.03)",
            borderRight: "1px solid var(--border)", padding: 8,
            overflowY: "auto", fontSize: 11, flexShrink: 0,
          }}>
            <div style={{ color: "var(--muted)", fontSize: 10, letterSpacing: "0.05em", marginBottom: 6 }}>FILES</div>
            {artifact.files.map((f) => {
              const label = f.split("/").pop() ?? f;
              const active = f === selectedFile;
              return (
                <div
                  key={f}
                  style={{
                    padding: "4px 6px", borderRadius: 3, marginBottom: 1, cursor: "pointer",
                    background: active ? "rgba(255,255,255,0.08)" : "transparent",
                    color: active ? "var(--text)" : "var(--muted)",
                  }}
                  onClick={() => setSelectedFile(f)}
                >
                  {label}
                </div>
              );
            })}
          </div>
          {/* Content area */}
          <div style={{ flex: 1, overflow: "auto" }}>
            {selectedFile && (
              <div style={{ padding: "6px 12px", borderBottom: "1px solid var(--border)", fontSize: 11, color: "var(--muted)" }}>
                {selectedFile}
              </div>
            )}
            {fileLoading && <p style={{ padding: 16, color: "var(--muted)" }}>Loading…</p>}
            {!fileLoading && fileContent !== null && (
              <pre style={{ margin: 0, padding: 16, fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "monospace" }}>
                {fileContent.split("\n").map((line, i) => (
                  <span key={i}>{line}{"\n"}</span>
                ))}
              </pre>
            )}
            {!fileLoading && fileContent === null && !selectedFile && (
              <p style={{ padding: 16, color: "var(--muted)" }}>Select a file.</p>
            )}
          </div>
        </div>
      </section>

      {/* Version History */}
      <section style={{ marginBottom: 32 }}>
        <h3 style={{ marginTop: 0 }}>Version History</h3>
        <table className="table">
          <thead>
            <tr><th>SHA</th><th>Date</th><th>Subject</th><th></th></tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr
                key={h.sha}
                style={{ background: comparingSha === h.sha ? "rgba(255,255,255,0.06)" : "" }}
              >
                <td>
                  <span
                    style={{ fontFamily: "monospace", fontSize: 12, cursor: "pointer", color: "var(--muted)" }}
                    onClick={() => setSelectedSha(h.sha)}
                    title="View files at this version"
                  >
                    {h.sha.slice(0, 7)}
                  </span>
                </td>
                <td style={{ color: "var(--muted)", fontSize: 12 }}>{h.date.slice(0, 10)}</td>
                <td style={{ fontSize: 13 }}>{h.subject}</td>
                <td>
                  {comparingSha === null ? (
                    <button className="btn secondary" style={{ fontSize: 11 }} onClick={() => setComparingSha(h.sha)}>
                      Compare
                    </button>
                  ) : comparingSha === h.sha ? (
                    <button className="btn secondary" style={{ fontSize: 11 }} onClick={() => setComparingSha(null)}>
                      Cancel
                    </button>
                  ) : (
                    <button
                      className="btn secondary"
                      style={{ fontSize: 11 }}
                      onClick={() => {
                        navigate(
                          `/diff?mode=version-vs-version&artifactKey=${encodeURIComponent(artifactKey)}&fromSha=${comparingSha}&toSha=${h.sha}`
                        );
                      }}
                    >
                      Compare with this
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Installs */}
      <section style={{ marginBottom: 32 }}>
        <h3 style={{ marginTop: 0 }}>Installs</h3>
        {installs.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>
            Not installed anywhere. Use the Install button above to add it to a working repo.
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Target</th><th>Agent</th><th>Installed version</th><th>Status</th><th>Auto-update</th><th></th></tr>
            </thead>
            <tbody>
              {installs.map((i) => {
                const targetName = i.target.type === "working-repo"
                  ? (wrById.get(i.target.workingRepoId)?.name ?? i.target.workingRepoId)
                  : "Global";
                return (
                  <tr key={i.id}>
                    <td>{targetName}</td>
                    <td>{i.agent}</td>
                    <td>
                      <span
                        style={{ fontFamily: "monospace", fontSize: 12, cursor: "pointer", color: "var(--muted)" }}
                        onClick={() => setSelectedSha(i.installedCommitSha)}
                        title="View files at this version"
                      >
                        {i.installedCommitSha.slice(0, 7)}
                      </span>
                    </td>
                    <td><StatusPill status={i.status} /></td>
                    <td style={{ fontSize: 12, color: "var(--muted)" }}>{i.autoUpdate ? "on" : "off"}</td>
                    <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {(i.status === "update-available+drifted") && (<>
                        <Link to={`/diff?mode=installed-vs-latest&installId=${i.id}`}
                          style={{ fontSize: 12, padding: "4px 8px", background: "transparent", color: "var(--muted)", textDecoration: "none", border: "1px solid var(--border)", borderRadius: 4 }}>
                          View diff
                        </Link>
                        <Link to={`/diff?mode=installed-vs-drifted&installId=${i.id}`}
                          style={{ fontSize: 12, padding: "4px 8px", background: "transparent", color: "var(--muted)", textDecoration: "none", border: "1px solid var(--border)", borderRadius: 4 }}>
                          View drift
                        </Link>
                        <button className="btn secondary" style={{ fontSize: 12 }} onClick={() => handleDisableAutoUpdate(i.id)}>Disable auto-update</button>
                        <button className="btn secondary" style={{ fontSize: 12 }} onClick={() => handleUpdate(i.id)}>Discard & update</button>
                      </>)}
                      {i.status === "update-available" && (<>
                        <Link to={`/diff?mode=installed-vs-latest&installId=${i.id}`}
                          style={{ fontSize: 12, padding: "4px 8px", background: "transparent", color: "var(--muted)", textDecoration: "none", border: "1px solid var(--border)", borderRadius: 4 }}>
                          View diff
                        </Link>
                        <button className="btn secondary" style={{ fontSize: 12 }} onClick={() => handleUpdate(i.id)}>Update</button>
                      </>)}
                      {i.status === "drifted" && (<>
                        <Link to={`/diff?mode=installed-vs-drifted&installId=${i.id}`}
                          style={{ fontSize: 12, padding: "4px 8px", background: "transparent", color: "var(--muted)", textDecoration: "none", border: "1px solid var(--border)", borderRadius: 4 }}>
                          View drift
                        </Link>
                        <button className="btn secondary" style={{ fontSize: 12 }} onClick={() => handleReapply(i.id)}>Re-apply</button>
                      </>)}
                      <button className="btn secondary" onClick={() => handleUninstall(i.id)}>Uninstall</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {installing && (
        <InstallModal
          artifact={artifact}
          onClose={() => setInstalling(false)}
          onDone={() => { setInstalling(false); reload(); }}
        />
      )}
    </>
  );
}
