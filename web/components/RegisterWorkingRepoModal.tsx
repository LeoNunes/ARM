import { useState } from "react";
import { api } from "../api.ts";

export function RegisterWorkingRepoModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try { await api.registerWorkingRepo({ name, path }); onDone(); }
    catch (e) { setError((e as Error).message); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Register working repository</h3>
        <div className="field"><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%" }} /></div>
        <div className="field"><label>Absolute path</label><input value={path} onChange={(e) => setPath(e.target.value)} style={{ width: "100%" }} placeholder="/Users/me/code/project" /></div>
        {error && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 8 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn secondary" onClick={onClose} disabled={submitting}>Cancel</button>
          <button className="btn" onClick={submit} disabled={submitting || !name || !path}>Register</button>
        </div>
      </div>
    </div>
  );
}
