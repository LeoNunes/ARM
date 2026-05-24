import { useEffect, useState, useCallback } from "react";
import { api, Settings as SettingsT } from "../api.ts";

export function Settings() {
  const [s, setS] = useState<SettingsT | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [portInput, setPortInput] = useState<string>("");
  const [copied, setCopied] = useState<"claude-code" | "cursor" | null>(null);
  // runningPort tracks the port the server is actually listening on (set at load time,
  // not updated on save — the server must restart to pick up a new port).
  const [runningPort, setRunningPort] = useState<number | null>(null);
  const [restartNeeded, setRestartNeeded] = useState(false);

  useEffect(() => {
    api.getSettings().then((settings) => {
      setS(settings);
      setPortInput(String(settings.mcpPort));
      setRunningPort(settings.mcpPort);
    });
  }, []);

  const mcpUrl = runningPort ? `http://127.0.0.1:${runningPort}/mcp` : "";

  const copySnippet = useCallback(
    (agent: "claude-code" | "cursor") => {
      if (!s) return;
      const snippet = JSON.stringify(
        { mcpServers: { "skills-manager": { url: mcpUrl } } },
        null,
        2,
      );
      navigator.clipboard.writeText(snippet).then(() => {
        setCopied(agent);
        setTimeout(() => setCopied(null), 2000);
      });
    },
    [s, mcpUrl],
  );

  const savePort = useCallback(async () => {
    const port = parseInt(portInput, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      setError("Port must be a number between 1 and 65535");
      return;
    }
    try {
      const updated = await api.updateSettings({ mcpPort: port });
      setS(updated);
      setPortInput(String(updated.mcpPort));
      setError(null);
      if (updated.mcpPort !== runningPort) setRestartNeeded(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [portInput]);

  if (!s) return <p>Loading…</p>;

  return (
    <>
      <h2 style={{ marginTop: 0 }}>Settings</h2>

      <div className="card" style={{ maxWidth: 480 }}>
        <div className="field">
          <label>Favorite agent</label>
          <select
            value={s.favoriteAgent}
            onChange={async (e) => {
              try {
                setS(await api.updateSettings({ favoriteAgent: e.target.value as "claude-code" | "cursor" }));
              } catch (err) {
                setError((err as Error).message);
              }
            }}
            style={{ width: "100%" }}
          >
            <option value="claude-code">Claude Code</option>
            <option value="cursor">Cursor</option>
          </select>
        </div>
      </div>

      <h3>MCP Server</h3>
      <div className="card" style={{ maxWidth: 480 }}>
        <div className="field">
          <label>Status</label>
          <span style={{ color: "var(--success, green)" }}>Running</span>
        </div>
        <div className="field">
          <label>URL</label>
          <code>{mcpUrl}</code>
          {restartNeeded && (
            <p style={{ fontSize: 11, color: "var(--warning, #856404)", margin: "4px 0 0" }}>
              Restart the app for the new port to take effect.
            </p>
          )}
        </div>
        <div className="field">
          <label>Port</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="number"
              aria-label="MCP port"
              value={portInput}
              onChange={(e) => setPortInput(e.target.value)}
              style={{ width: 80 }}
            />
            <button onClick={savePort}>Save</button>
          </div>
        </div>
        <div className="field">
          <label>Claude Code config snippet</label>
          <div>
            <button onClick={() => copySnippet("claude-code")}>
              {copied === "claude-code" ? "Copied!" : "Copy"}
            </button>
            <p style={{ fontSize: 11, color: "var(--muted, #888)", margin: "4px 0 0" }}>
              Paste into <code>~/.claude.json</code> under <code>mcpServers</code>
            </p>
          </div>
        </div>
        <div className="field">
          <label>Cursor config snippet</label>
          <div>
            <button onClick={() => copySnippet("cursor")}>
              {copied === "cursor" ? "Copied!" : "Copy"}
            </button>
            <p style={{ fontSize: 11, color: "var(--muted, #888)", margin: "4px 0 0" }}>
              Paste into <code>~/.cursor/mcp.json</code> under <code>mcpServers</code>
            </p>
          </div>
        </div>
      </div>

      {error && (
        <p style={{ color: "var(--danger, red)", fontSize: 12, marginTop: 8 }}>{error}</p>
      )}
    </>
  );
}
