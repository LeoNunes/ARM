import { useState } from "react";
import { Link } from "react-router-dom";
import { api, SkillsRepo, PathBlocker } from "../api.ts";

export function EditSkillsRepoModal({ repo, onClose, onDone }: { repo: SkillsRepo; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(repo.name);
  const [skillsPaths, setSkillsPaths] = useState((repo.artifactPaths.skills ?? []).join(", "));
  const [rulesPaths, setRulesPaths] = useState((repo.artifactPaths.rules ?? []).join(", "));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<PathBlocker[]>([]);

  const parse = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

  const submit = async () => {
    setError(null);
    setBlockers([]);
    setSubmitting(true);
    try {
      await api.updateSkillsRepo(repo.id, {
        name,
        artifactPaths: { skills: parse(skillsPaths), rules: parse(rulesPaths) },
      });
      onDone();
    } catch (e) {
      const err = e as Error & { code?: string; blockers?: PathBlocker[] };
      if (err.code === "paths_in_use" && err.blockers) setBlockers(err.blockers);
      else setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Edit skills repository</h3>
        <div className="field">
          <label htmlFor="edit-repo-name">Name</label>
          <input id="edit-repo-name" value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%" }} />
        </div>
        <div className="field">
          <label>Git URL</label>
          <input value={repo.gitUrl} disabled style={{ width: "100%" }} />
        </div>
        <div className="field">
          <label>Branch</label>
          <input value={repo.branch} disabled style={{ width: "100%" }} />
        </div>
        <div className="field">
          <label htmlFor="edit-repo-skills">Skills paths (comma-separated)</label>
          <input id="edit-repo-skills" value={skillsPaths} onChange={(e) => setSkillsPaths(e.target.value)} style={{ width: "100%" }} />
        </div>
        <div className="field">
          <label htmlFor="edit-repo-rules">Rules paths (comma-separated)</label>
          <input id="edit-repo-rules" value={rulesPaths} onChange={(e) => setRulesPaths(e.target.value)} style={{ width: "100%" }} />
        </div>
        {blockers.map((b) => (
          <div key={`${b.type}:${b.path}`} style={{ color: "var(--danger)", fontSize: 12, marginBottom: 8 }}>
            Can't remove <code>{b.path}</code> — still installed:{" "}
            {b.artifacts.map((a, i) => (
              <span key={a.artifactKey}>
                {i > 0 && ", "}
                <Link to={`/artifacts?artifactKey=${encodeURIComponent(a.artifactKey)}`}>{a.name}</Link>
              </span>
            ))}
          </div>
        ))}
        {error && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 8 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn secondary" onClick={onClose} disabled={submitting}>Cancel</button>
          <button className="btn" onClick={submit} disabled={submitting || !name}>Save</button>
        </div>
      </div>
    </div>
  );
}
