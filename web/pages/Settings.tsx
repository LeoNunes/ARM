// web/pages/Settings.tsx
import { useEffect, useState } from "react";
import { api, Settings as SettingsT } from "../api.ts";

export function Settings() {
  const [s, setS] = useState<SettingsT | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.getSettings().then(setS); }, []);
  if (!s) return <p>Loading…</p>;
  return (
    <>
      <h2 style={{ marginTop: 0 }}>Settings</h2>
      <div className="card" style={{ maxWidth: 480 }}>
        <div className="field">
          <label>Favorite agent</label>
          <select value={s.favoriteAgent} onChange={async (e) => {
            try {
              setS(await api.updateSettings({ favoriteAgent: e.target.value as "claude-code" | "cursor" }));
            } catch (err) {
              setError((err as Error).message);
            }
          }} style={{ width: "100%" }}>
            <option value="claude-code">Claude Code</option>
            <option value="cursor">Cursor</option>
          </select>
        </div>
        <div className="field" style={{ color: "var(--muted)", fontSize: 12 }}>
          MCP port: {s.mcpPort} (MCP server arrives in slice 3)
        </div>
      </div>
      {error && <p style={{ color: "var(--danger)", fontSize: 12, marginTop: 8 }}>{error}</p>}
    </>
  );
}
