// web/components/InstallModal.tsx
import { useEffect, useState } from "react";
import { api, Artifact, Settings, WorkingRepo } from "../api.ts";

interface Props {
  artifact: Artifact;
  onClose: () => void;
  onDone: () => void;
}

export function InstallModal({ artifact, onClose, onDone }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [workingRepos, setWorkingRepos] = useState<WorkingRepo[]>([]);
  const [scope, setScope] = useState<"working-repo" | "global">("working-repo");
  const [workingRepoId, setWorkingRepoId] = useState("");
  const [agent, setAgent] = useState<"claude-code" | "cursor">("claude-code");
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([api.getSettings(), api.listWorkingRepos()]).then(([s, wr]) => {
      setSettings(s);
      setAgent(s.favoriteAgent);
      setWorkingRepos(wr);
      if (wr[0]) setWorkingRepoId(wr[0].id);
    });
  }, []);

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await api.createInstall({
        artifactKey: artifact.artifactKey,
        target: scope === "working-repo" ? { type: "working-repo", workingRepoId } : { type: "global" },
        agent, autoUpdate,
      });
      onDone();
    } catch (e) { setError((e as Error).message); }
    finally { setSubmitting(false); }
  };

  if (!settings) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Install skill</h3>
        <div className="field">
          <label>Skill</label>
          <div>{artifact.name} <span style={{ color: "var(--muted)" }}>· {artifact.sourceRepoId.slice(0, 8)}</span></div>
        </div>
        <div className="field">
          <label>Target</label>
          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <button className="btn secondary" style={{ background: scope === "working-repo" ? "rgba(255,255,255,0.08)" : undefined }} onClick={() => setScope("working-repo")}>Working repo</button>
            <button className="btn secondary" style={{ background: scope === "global" ? "rgba(255,255,255,0.08)" : undefined }} onClick={() => setScope("global")}>Global</button>
          </div>
          {scope === "working-repo" && (
            <select value={workingRepoId} onChange={(e) => setWorkingRepoId(e.target.value)} style={{ width: "100%" }} aria-label="Working repo">
              {workingRepos.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          )}
        </div>
        <div className="field">
          <label>Agent</label>
          <select value={agent} onChange={(e) => setAgent(e.target.value as "claude-code" | "cursor")} aria-label="Agent" style={{ width: "100%" }}>
            <option value="claude-code">Claude Code</option>
            <option value="cursor">Cursor</option>
          </select>
        </div>
        <div className="field">
          <label><input type="checkbox" checked={autoUpdate} onChange={(e) => setAutoUpdate(e.target.checked)} /> Auto-update</label>
        </div>
        {error && <div style={{ color: "var(--danger)", fontSize: 12 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn secondary" onClick={onClose} disabled={submitting}>Cancel</button>
          <button className="btn" onClick={submit} disabled={submitting || (scope === "working-repo" && !workingRepoId)}>Install</button>
        </div>
      </div>
    </div>
  );
}
