import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import ReactDiffViewer from "react-diff-viewer-continued";
import { api } from "../api.ts";
import type { DiffResponse, FileDiff } from "../api.ts";

export function Diff() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [diffData, setDiffData] = useState<DiffResponse | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [splitView, setSplitView] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const mode = (params.get("mode") ?? "version-vs-version") as DiffResponse["mode"];
  const installId = params.get("installId") ?? undefined;
  const artifactKey = params.get("artifactKey") ?? undefined;
  const fromSha = params.get("fromSha") ?? undefined;
  const toSha = params.get("toSha") ?? undefined;

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        let data: DiffResponse;
        if (mode === "installed-vs-latest" && installId) {
          data = await api.getDiff({ mode: "installed-vs-latest", installId });
        } else if (mode === "installed-vs-drifted" && installId) {
          data = await api.getDiff({ mode: "installed-vs-drifted", installId });
        } else if (mode === "version-vs-version" && artifactKey && fromSha && toSha) {
          data = await api.getDiff({ mode: "version-vs-version", artifactKey, fromSha, toSha });
        } else {
          setError("Invalid diff parameters");
          setLoading(false);
          return;
        }
        setDiffData(data);
        const firstChanged = data.files.find((f) => f.changed);
        setSelectedFile(firstChanged?.path ?? data.files[0]?.path ?? null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handlePrimaryAction = async () => {
    if (!diffData?.installId) return;
    setApplying(true);
    try {
      if (diffData.primaryAction === "update") {
        await api.applyInstallUpdate(diffData.installId);
      } else if (diffData.primaryAction === "re-apply") {
        await api.reapplyInstall(diffData.installId);
      }
      navigate(-1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setApplying(false);
    }
  };

  const currentFile: FileDiff | undefined =
    diffData?.files.find((f) => f.path === selectedFile) ?? diffData?.files[0];

  const shortPath = (p: string) => p.split("/").pop() ?? p;

  if (loading) return <p style={{ padding: 20 }}>Loading diff…</p>;
  if (error) return <p style={{ padding: 20, color: "var(--danger)" }}>{error}</p>;
  if (!diffData) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
        <strong style={{ fontSize: 14 }}>{diffData.artifactName}</strong>
        <span style={{ color: "var(--muted)", fontSize: 11 }}>
          {diffData.label}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, fontSize: 11 }}>
          <button
            className={`btn ${splitView ? "" : "secondary"}`}
            style={{ fontSize: 11, padding: "3px 10px" }}
            onClick={() => setSplitView(true)}
          >
            Side-by-side
          </button>
          <button
            className={`btn ${!splitView ? "" : "secondary"}`}
            style={{ fontSize: 11, padding: "3px 10px" }}
            onClick={() => setSplitView(false)}
          >
            Unified
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* File list */}
        <div style={{ width: 200, background: "rgba(255,255,255,0.03)", borderRight: "1px solid var(--border)", padding: 8, overflowY: "auto", fontSize: 11 }}>
          <div style={{ color: "var(--muted)", fontSize: 10, letterSpacing: "0.05em", marginBottom: 6 }}>FILES</div>
          {diffData.files.map((f) => (
            <div
              key={f.path}
              style={{
                padding: "4px 6px",
                borderRadius: 3,
                background: f.path === selectedFile ? "rgba(255,255,255,0.08)" : "transparent",
                marginBottom: 1,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
              onClick={() => setSelectedFile(f.path)}
            >
              <span style={{ color: f.path === selectedFile ? "var(--text)" : "var(--muted)" }}>
                {shortPath(f.path)}
              </span>
              {f.changed && (
                <span data-testid="file-changed" style={{ color: "var(--warn)", marginLeft: "auto" }}>±</span>
              )}
            </div>
          ))}
        </div>

        {/* Diff pane */}
        <div style={{ flex: 1, overflow: "auto" }}>
          {currentFile ? (
            <ReactDiffViewer
              oldValue={currentFile.fromContent ?? ""}
              newValue={currentFile.toContent ?? ""}
              splitView={splitView}
              useDarkTheme={true}
            />
          ) : (
            <p style={{ padding: 20, color: "var(--muted)" }}>Select a file to view diff</p>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn secondary" onClick={() => navigate(-1)}>Close</button>
        {diffData.primaryAction === "update" && (
          <button className="btn" onClick={handlePrimaryAction} disabled={applying}>
            {applying ? "Updating…" : `Update to ${diffData.toSha.slice(0, 7)}`}
          </button>
        )}
        {diffData.primaryAction === "re-apply" && (
          <button className="btn" onClick={handlePrimaryAction} disabled={applying}>
            {applying ? "Re-applying…" : "Re-apply installed version"}
          </button>
        )}
      </div>
    </div>
  );
}
