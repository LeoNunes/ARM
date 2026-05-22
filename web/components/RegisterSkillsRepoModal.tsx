import { useState } from "react";
import { api } from "../api.ts";

export function RegisterSkillsRepoModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [gitUrl, setGitUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [skillsPaths, setSkillsPaths] = useState("ai/skills");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await api.registerSkillsRepo({
        name, gitUrl, branch,
        artifactPaths: { skills: skillsPaths.split(",").map((s) => s.trim()).filter(Boolean) },
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Register skills repository</h3>
        <div className="field">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%" }} />
        </div>
        <div className="field">
          <label>Git URL</label>
          <input value={gitUrl} onChange={(e) => setGitUrl(e.target.value)} style={{ width: "100%" }} placeholder="https://github.com/..." />
        </div>
        <div className="field">
          <label>Branch</label>
          <input value={branch} onChange={(e) => setBranch(e.target.value)} style={{ width: "100%" }} />
        </div>
        <div className="field">
          <label>Skills paths (comma-separated)</label>
          <input value={skillsPaths} onChange={(e) => setSkillsPaths(e.target.value)} style={{ width: "100%" }} />
        </div>
        {error && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 8 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn secondary" onClick={onClose} disabled={submitting}>Cancel</button>
          <button className="btn" onClick={submit} disabled={submitting || !name || !gitUrl}>Register</button>
        </div>
      </div>
    </div>
  );
}
