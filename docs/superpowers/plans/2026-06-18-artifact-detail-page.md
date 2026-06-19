# Artifact Detail Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated artifact detail page at `/artifacts?artifactKey=...` that shows all files at any version, version history with compare, and all install locations with full action support.

**Architecture:** Single scrollable React page (`ArtifactDetail.tsx`) with four sections — Header, File Viewer, Version History, Installs — reading from three existing API endpoints plus one new `GET /api/installs?artifactKey=` endpoint added to the Fastify backend. Navigation links are added to Browse, SkillsRepoDetail, WorkingRepoDetail, and Dashboard.

**Tech Stack:** React 18 + React Router v6 + TypeScript (frontend); Fastify + TypeScript (backend); Vitest + @testing-library/react (tests); `react-diff-viewer-continued` is already present for diffs but not used here.

## Global Constraints

- Route uses query param (`?artifactKey=`) not a path param, because `artifactKey` contains `:` and `/` which React Router v6 treats as path separators in path params.
- `artifactKey` must always be `encodeURIComponent`-encoded in URLs and `decodeURIComponent`-decoded when read from URL params.
- All `status` and action logic in the Installs section must exactly match `WorkingRepoDetail.tsx` — same button labels, same conditions.
- Global installs skip drift checking; their status is `up-to-date` or `update-available` only.
- File content is fetched via `api.getArtifactFile()` (a new api.ts method) to keep all network calls mockable in unit tests.
- No syntax highlighting, no markdown rendering — raw `<pre>` display only.
- Version history limit: 20 commits (API default). No pagination.

---

### Task 1: Backend — GET /api/installs?artifactKey= endpoint

**Files:**
- Modify: `src/api/installs.ts`
- Test: `tests/integration/api.test.ts`

**Interfaces:**
- Produces: `GET /api/installs?artifactKey=<encoded>` → `InstallWithStatus[]`; returns `400` if `artifactKey` query param is absent

- [ ] **Step 1: Write the failing integration test**

Add this block at the end of `tests/integration/api.test.ts` (after the existing imports and `makeDeps`):

```typescript
describe("API GET /api/installs?artifactKey=", () => {
  it("returns 400 when artifactKey is missing", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const res = await app.inject({ method: "GET", url: "/api/installs" });
    expect(res.statusCode).toBe(400);
  });

  it("returns installs with status for the given artifactKey", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);

    const fx = await buildFixtureRepo([
      { message: "init", files: { "skills/foo/SKILL.md": "# Foo\n" } },
    ]);
    const srcRes = await app.inject({
      method: "POST", url: "/api/skills-repos",
      payload: { name: "src", gitUrl: fx.fileUrl, branch: "main", artifactPaths: { skills: ["skills"] } },
    });
    expect(srcRes.statusCode).toBe(201);
    const src = srcRes.json();

    const wrDir = await tmpDir("arm-wr-");
    const sg = simpleGit(wrDir);
    await sg.init();
    await sg.addConfig("user.email", "a@b");
    await sg.addConfig("user.name", "t");
    await sg.addConfig("commit.gpgsign", "false");
    await sg.commit("seed", [], { "--allow-empty": null });

    const wrRes = await app.inject({
      method: "POST", url: "/api/working-repos",
      payload: { name: "my-repo", path: wrDir },
    });
    expect(wrRes.statusCode).toBe(201);
    const wr = wrRes.json();

    const artifactsRes = await app.inject({ method: "GET", url: `/api/artifacts?sourceRepoId=${src.id}` });
    const artifacts = artifactsRes.json();
    expect(artifacts.length).toBeGreaterThan(0);
    const artifactKey: string = artifacts[0].artifactKey;

    await app.inject({
      method: "POST", url: "/api/installs",
      payload: { artifactKey, target: { type: "working-repo", workingRepoId: wr.id } },
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/installs?artifactKey=${encodeURIComponent(artifactKey)}`,
    });
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list).toHaveLength(1);
    expect(list[0].artifactKey).toBe(artifactKey);
    expect(list[0].status).toBe("up-to-date");
    expect(list[0].availableSha).toBeNull();
  });

  it("returns empty array when no installs exist for the artifactKey", async () => {
    const deps = await makeDeps();
    const app = await buildServer(deps);
    const res = await app.inject({
      method: "GET",
      url: "/api/installs?artifactKey=nonexistent%3Afoo",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});
```

- [ ] **Step 2: Add missing import to api.test.ts**

At the top of `tests/integration/api.test.ts`, add `simpleGit` to the existing import:

```typescript
import { simpleGit } from "simple-git";
```

(Check if it's already there — if so, skip this step.)

- [ ] **Step 3: Run tests to confirm they fail**

```bash
npx vitest run tests/integration/api.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: the three new tests fail with route-not-found or similar errors.

- [ ] **Step 4: Implement the new endpoint in `src/api/installs.ts`**

Add this block inside `registerInstallsRoutes`, after the existing routes (before the closing `}`):

```typescript
  app.get<{ Querystring: { artifactKey?: string } }>("/api/installs", async (req, reply) => {
    const rawKey = req.query.artifactKey;
    if (!rawKey) throw new AppError("bad_input", "artifactKey query param required");
    const decodedKey = decodeURIComponent(rawKey);

    const allInstalls = await deps.installs.list();
    const filtered = allInstalls.filter((i) => i.artifactKey === decodedKey);

    const allWorkingRepos = await deps.workingRepos.list();
    const wrById = new Map(allWorkingRepos.map((w) => [w.id, w]));
    const allSkillsRepos = await deps.skillsRepos.list();
    const srById = new Map(allSkillsRepos.map((s) => [s.id, s]));

    return Promise.all(
      filtered.map(async (install) => {
        const sr = srById.get(install.sourceRepoId);
        if (!sr) return { ...install, status: "up-to-date" as const, availableSha: null };
        try {
          const updateResult = await checkForUpdates(install, sr);
          if (install.target.type === "global") {
            const status = updateResult.hasUpdate ? "update-available" as const : "up-to-date" as const;
            return { ...install, status, availableSha: updateResult.availableSha };
          }
          const wr = wrById.get(install.target.workingRepoId);
          if (!wr) return { ...install, status: "up-to-date" as const, availableSha: null };
          const driftResult = await checkForDrift(install, sr, wr.path);
          const status = computeInstallStatus(updateResult.hasUpdate, driftResult.isDrifted);
          return { ...install, status, availableSha: updateResult.availableSha };
        } catch {
          return { ...install, status: "up-to-date" as const, availableSha: null };
        }
      }),
    );
  });
```

- [ ] **Step 5: Add missing import to `src/api/installs.ts`**

`WorkingRepoStore` is accessed via `deps.workingRepos` — confirm `deps.workingRepos.list()` is available. The `WorkingRepoStore` already has `list()` (see `src/state/working-repos.ts:11`). No import changes needed since `deps` is typed via `ServerDeps`.

- [ ] **Step 6: Run tests to confirm they pass**

```bash
npx vitest run tests/integration/api.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: all three new tests PASS, all prior tests still PASS.

- [ ] **Step 7: Commit**

```bash
git add src/api/installs.ts tests/integration/api.test.ts
git commit -m "feat: add GET /api/installs?artifactKey= endpoint"
```

---

### Task 2: ArtifactDetail page — all sections + API client + route

**Files:**
- Modify: `web/api.ts`
- Create: `web/pages/ArtifactDetail.tsx`
- Modify: `web/routes.tsx`
- Create: `tests/unit/artifact-detail.test.tsx`

**Interfaces:**
- Consumes from Task 1: `GET /api/installs?artifactKey=<encoded>` → `InstallWithStatus[]`
- Produces: React component `<ArtifactDetail />` mounted at `/artifacts?artifactKey=<encoded>`

- [ ] **Step 1: Add new methods to `web/api.ts`**

Add these three methods to the `api` object (after `getArtifactHistory`):

```typescript
  getArtifact: (artifactKey: string) =>
    req<Artifact>("GET", `/api/artifacts/${encodeURIComponent(artifactKey)}`),

  getArtifactFile: (artifactKey: string, filePath: string, sha: string): Promise<string> =>
    fetch(`/api/artifacts/${encodeURIComponent(artifactKey)}/files/${filePath}?sha=${encodeURIComponent(sha)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      }),

  listInstallsByArtifact: (artifactKey: string) =>
    req<InstallWithStatus[]>("GET", `/api/installs?artifactKey=${encodeURIComponent(artifactKey)}`),
```

- [ ] **Step 2: Write the failing unit test**

Create `tests/unit/artifact-detail.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ArtifactDetail } from "../../web/pages/ArtifactDetail.tsx";

afterEach(cleanup);

const mockArtifact = {
  artifactKey: "src1:skills/foo",
  sourceRepoId: "src1",
  type: "skills" as const,
  name: "foo",
  description: "Does foo things.",
  rootRelativePath: "skills/foo",
  files: ["skills/foo/SKILL.md", "skills/foo/helper.sh"],
  lastTouchedSha: "abc1234567890123",
};

const mockHistory = [
  { sha: "abc1234567890123", date: "2026-06-18T10:00:00Z", subject: "add retry logic" },
  { sha: "def4567890123456", date: "2026-05-01T10:00:00Z", subject: "initial version" },
];

const mockInstalls = [
  {
    id: "i1",
    artifactKey: "src1:skills/foo",
    sourceRepoId: "src1",
    target: { type: "working-repo" as const, workingRepoId: "w1" },
    agent: "claude-code" as const,
    artifactType: "skills" as const,
    installedCommitSha: "abc1234567890123",
    autoUpdate: false,
    installedFiles: [],
    installedAt: "2026-06-18T10:00:00Z",
    status: "up-to-date" as const,
    availableSha: null,
  },
];

vi.mock("../../web/api.ts", () => ({
  api: {
    getArtifact: vi.fn(async () => mockArtifact),
    getArtifactHistory: vi.fn(async () => mockHistory),
    getArtifactFile: vi.fn(async () => "# Foo\nskill content"),
    listInstallsByArtifact: vi.fn(async () => mockInstalls),
    listWorkingRepos: vi.fn(async () => [
      { id: "w1", name: "my-repo", path: "/home/dev/my-repo", addedAt: "2026-01-01T00:00:00Z" },
    ]),
    getSettings: vi.fn(async () => ({ favoriteAgent: "claude-code", mcpPort: 7747, autoRefreshEnabled: false, autoRefreshIntervalMinutes: 30 })),
    listWorkingRepos: vi.fn(async () => [{ id: "w1", name: "my-repo", path: "/home/dev/my-repo", addedAt: "2026-01-01T00:00:00Z" }]),
    deleteInstall: vi.fn(async () => undefined),
    applyInstallUpdate: vi.fn(async () => ({ ...mockInstalls[0] })),
    reapplyInstall: vi.fn(async () => ({ ...mockInstalls[0] })),
    updateInstall: vi.fn(async () => ({ ...mockInstalls[0] })),
  },
}));

function renderDetail(key = "src1:skills/foo") {
  return render(
    <MemoryRouter initialEntries={[`/artifacts?artifactKey=${encodeURIComponent(key)}`]}>
      <Routes>
        <Route path="/artifacts" element={<ArtifactDetail />} />
        <Route path="/diff" element={<div>diff page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ArtifactDetail — Header", () => {
  it("renders artifact name", async () => {
    renderDetail();
    expect(await screen.findByText("foo")).toBeTruthy();
  });

  it("renders type badge", async () => {
    renderDetail();
    expect(await screen.findByText("skill")).toBeTruthy();
  });

  it("renders description", async () => {
    renderDetail();
    expect(await screen.findByText("Does foo things.")).toBeTruthy();
  });

  it("renders Install button", async () => {
    renderDetail();
    expect(await screen.findByRole("button", { name: "Install" })).toBeTruthy();
  });
});

describe("ArtifactDetail — File Viewer", () => {
  it("renders file names in picker (last path segment)", async () => {
    renderDetail();
    expect(await screen.findByText("SKILL.md")).toBeTruthy();
    expect(await screen.findByText("helper.sh")).toBeTruthy();
  });

  it("renders file content in pre block", async () => {
    renderDetail();
    expect(await screen.findByText("# Foo")).toBeTruthy();
  });
});

describe("ArtifactDetail — Version History", () => {
  it("renders commit subjects", async () => {
    renderDetail();
    expect(await screen.findByText("add retry logic")).toBeTruthy();
    expect(await screen.findByText("initial version")).toBeTruthy();
  });

  it("renders Compare button for each history entry initially", async () => {
    renderDetail();
    await screen.findByText("add retry logic");
    const btns = screen.getAllByRole("button", { name: "Compare" });
    expect(btns).toHaveLength(2);
  });

  it("shows Cancel on first row and 'Compare with this' on others after clicking Compare", async () => {
    renderDetail();
    const [firstCompare] = await screen.findAllByRole("button", { name: "Compare" });
    fireEvent.click(firstCompare!);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Compare with this" })).toBeTruthy();
  });
});

describe("ArtifactDetail — Installs", () => {
  it("renders working repo name in target column", async () => {
    renderDetail();
    expect(await screen.findByText("my-repo")).toBeTruthy();
  });

  it("renders agent in installs table", async () => {
    renderDetail();
    expect(await screen.findByText("claude-code")).toBeTruthy();
  });

  it("renders Uninstall button for up-to-date install", async () => {
    renderDetail();
    expect(await screen.findByRole("button", { name: "Uninstall" })).toBeTruthy();
  });

  it("shows 'Not installed anywhere' when no installs", async () => {
    const { api } = await import("../../web/api.ts");
    vi.mocked(api.listInstallsByArtifact).mockResolvedValueOnce([]);
    renderDetail();
    expect(await screen.findByText(/Not installed anywhere/)).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run test to confirm it fails**

```bash
npx vitest run tests/unit/artifact-detail.test.tsx --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL — `ArtifactDetail` module not found.

- [ ] **Step 4: Create `web/pages/ArtifactDetail.tsx`**

```tsx
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
                {fileContent}
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
```

- [ ] **Step 5: Add route to `web/routes.tsx`**

Add the import at the top with the other page imports:

```tsx
import { ArtifactDetail } from "./pages/ArtifactDetail.tsx";
```

Add the route inside `<Routes>` (after the `/browse` route):

```tsx
<Route path="/artifacts" element={<ArtifactDetail />} />
```

- [ ] **Step 6: Run tests to confirm they pass**

```bash
npx vitest run tests/unit/artifact-detail.test.tsx --reporter=verbose 2>&1 | tail -30
```

Expected: all tests PASS.

- [ ] **Step 7: Run full test suite to check for regressions**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -30
```

Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add web/api.ts web/pages/ArtifactDetail.tsx web/routes.tsx tests/unit/artifact-detail.test.tsx
git commit -m "feat: add artifact detail page with file viewer, version history, and installs"
```

---

### Task 3: Navigation links from Browse, SkillsRepoDetail, WorkingRepoDetail

**Files:**
- Modify: `web/pages/Browse.tsx`
- Modify: `web/pages/SkillsRepoDetail.tsx`
- Modify: `web/pages/WorkingRepoDetail.tsx`

**Interfaces:**
- Consumes from Task 2: route `/artifacts?artifactKey=<encoded>`

- [ ] **Step 1: Update `web/pages/Browse.tsx` — artifact name becomes a Link**

Replace the `<td>{a.name}</td>` line (currently line 36):

```tsx
<td>
  <Link
    to={`/artifacts?artifactKey=${encodeURIComponent(a.artifactKey)}`}
    style={{ color: "inherit", textDecoration: "none", fontWeight: 500 }}
  >
    {a.name}
  </Link>
</td>
```

Also add the `Link` import if not already present. The existing import is `import { api, Artifact } from "../api.ts";` — add `Link` from react-router-dom:

```tsx
import { Link } from "react-router-dom";
```

- [ ] **Step 2: Update `web/pages/SkillsRepoDetail.tsx` — artifact name becomes a Link**

Add `Link` import:

```tsx
import { Link, useParams } from "react-router-dom";
```

Replace `<td>{a.name}</td>` in the table body (the first `<td>` in the artifacts map):

```tsx
<td>
  <Link
    to={`/artifacts?artifactKey=${encodeURIComponent(a.artifactKey)}`}
    style={{ color: "inherit", textDecoration: "none", fontWeight: 500 }}
  >
    {a.name}
  </Link>
</td>
```

- [ ] **Step 3: Update `web/pages/WorkingRepoDetail.tsx` — artifact name becomes a Link**

In the installs table body, the artifact name is computed as:

```tsx
const [, rel] = i.artifactKey.split(":", 2);
const name = rel?.split("/").pop() ?? rel;
```

And rendered as `<td>{name}</td>`. Replace that `<td>` with:

```tsx
<td>
  <Link
    to={`/artifacts?artifactKey=${encodeURIComponent(i.artifactKey)}`}
    style={{ color: "inherit", textDecoration: "none", fontWeight: 500 }}
  >
    {name}
  </Link>
</td>
```

- [ ] **Step 4: Run existing unit tests to confirm no regressions**

```bash
npx vitest run tests/unit/working-repo-detail.test.tsx --reporter=verbose 2>&1 | tail -20
```

Expected: all tests PASS (the test checks for "foo" and "bar" text which are still rendered inside the Link).

- [ ] **Step 5: Run full test suite**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add web/pages/Browse.tsx web/pages/SkillsRepoDetail.tsx web/pages/WorkingRepoDetail.tsx
git commit -m "feat: link artifact names to artifact detail page from Browse, SkillsRepoDetail, WorkingRepoDetail"
```

---

### Task 4: Dashboard notification cards — View + Dismiss

**Files:**
- Modify: `web/pages/Dashboard.tsx`
- Modify: `tests/unit/dashboard.test.tsx`

**Interfaces:**
- Consumes from Task 2: route `/artifacts?artifactKey=<encoded>`

- [ ] **Step 1: Update dashboard unit test to expect View and Dismiss (not Install and Dismiss)**

In `tests/unit/dashboard.test.tsx`, find the test:

```typescript
it("renders Install and Dismiss buttons for each card", async () => {
  globalThis.fetch = makeMockFetch({ newArtifacts: [mockNewArtifact] });
  renderDashboard();
  expect(await screen.findByRole("button", { name: "Install" })).toBeTruthy();
  expect(await screen.findByRole("button", { name: "Dismiss" })).toBeTruthy();
});
```

Replace it with:

```typescript
it("renders View and Dismiss buttons for each card (no Install)", async () => {
  globalThis.fetch = makeMockFetch({ newArtifacts: [mockNewArtifact] });
  renderDashboard();
  expect(await screen.findByRole("link", { name: "View" })).toBeTruthy();
  expect(await screen.findByRole("button", { name: "Dismiss" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npx vitest run tests/unit/dashboard.test.tsx --reporter=verbose 2>&1 | tail -20
```

Expected: the updated test FAILS (Install button still present, View link absent).

- [ ] **Step 3: Update `web/pages/Dashboard.tsx` — replace Install+Dismiss with View+Dismiss**

Remove the entire `handleInstallClick` function (lines 57–90) and the `[installArtifact, setInstallArtifact]` state and the `<InstallModal>` render at the bottom.

Replace the notification card buttons block:

```tsx
<div style={{ display: "flex", gap: 6 }}>
  <button
    className="btn"
    style={{ fontSize: 10, padding: "3px 8px" }}
    onClick={() => handleInstallClick(n)}
  >
    Install
  </button>
  <button
    className="btn secondary"
    style={{ fontSize: 10, padding: "3px 4px" }}
    onClick={() => handleDismiss(n.key)}
  >
    Dismiss
  </button>
</div>
```

With:

```tsx
<div style={{ display: "flex", gap: 6 }}>
  <Link
    to={`/artifacts?artifactKey=${encodeURIComponent(n.artifactKey)}`}
    className="btn"
    style={{ fontSize: 10, padding: "3px 8px", textDecoration: "none" }}
  >
    View
  </Link>
  <button
    className="btn secondary"
    style={{ fontSize: 10, padding: "3px 4px" }}
    onClick={() => handleDismiss(n.key)}
  >
    Dismiss
  </button>
</div>
```

Also remove the `InstallModal` import and `installArtifact` state if nothing else uses them. Remove:
- `const [installArtifact, setInstallArtifact] = useState<Artifact | null>(null);`
- The `handleInstallClick` function
- The `{installArtifact && <InstallModal ... />}` at the bottom of the return
- The `import { InstallModal } from "../components/InstallModal.tsx";` if unused
- The `Artifact` type from the `api.ts` import if unused

- [ ] **Step 4: Run dashboard tests to confirm they pass**

```bash
npx vitest run tests/unit/dashboard.test.tsx --reporter=verbose 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add web/pages/Dashboard.tsx tests/unit/dashboard.test.tsx
git commit -m "feat: replace Install+Dismiss notification cards with View+Dismiss linking to artifact detail"
```

---

### Task 5: Update product specification

**Files:**
- Modify: `docs/product-specification.md`

- [ ] **Step 1: Update §4.3 Browsing**

In section 4.3, add a sentence after the existing bullet points:

```markdown
- Each artifact row links to the artifact's **detail page** (see §4.X).
```

- [ ] **Step 2: Update §4.4 Installing**

After the existing bullets about the install action, add:

```markdown
- Install can also be initiated from the **artifact detail page**.
```

- [ ] **Step 3: Update §4.6 Version history and diffs**

At the start of section 4.6, add:

```markdown
- The artifact detail page (§4.X) is the primary surface for browsing version history and comparing versions.
```

- [ ] **Step 4: Update §4.8 Dashboard — new-artifact notification cards**

Find the line:

```markdown
- Notifications for new source-repo artifacts can be **dismissed**.
```

Replace with:

```markdown
- New-artifact notification cards have two buttons: **View** (navigates to the artifact detail page) and **Dismiss** (removes the card).
```

- [ ] **Step 5: Add new §4.X Artifact detail page**

Add a new section after §4.8 (before §4.9):

```markdown
### 4.9 Artifact detail page

A dedicated page for each artifact, accessible by clicking the artifact name from Browse, SkillsRepoDetail, WorkingRepoDetail, and Dashboard notification cards. The page has four sections:

- **Header** — artifact name, type badge, description, source repo name, and an Install button.
- **File viewer** — a version dropdown (default: latest) and a file picker (left) with raw content display (right). Changing the version re-fetches all file content at that SHA. If the selected SHA is not in the 20-commit history window, it appears as a standalone option.
- **Version history** — table of the 20 most recent commits touching the artifact's files, with SHA, date, and commit subject. Clicking a SHA sets the file viewer to that version. A two-step Compare flow lets the user select two versions and navigate to the diff page.
- **Installs** — table of all locations this artifact is installed (across all working repos and global), showing target name, agent, installed version (short SHA — clickable to set the file viewer), status, auto-update, and actions (Update, View diff, View drift, Re-apply, Disable auto-update, Uninstall) matching the same logic as the working-repo detail page. For global installs, drift checking is not applicable.
```

(Renumber §4.9 MCP server to §4.10, §4.10 Application settings to §4.11, §4.11 Activity log to §4.12 — and update any cross-references.)

- [ ] **Step 6: Commit**

```bash
git add docs/product-specification.md
git commit -m "docs: update product spec for artifact detail page feature"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| New artifact detail page with four sections | Task 2 |
| Route `/artifacts?artifactKey=` | Task 2 |
| Entry from Browse | Task 3 |
| Entry from SkillsRepoDetail | Task 3 |
| Entry from WorkingRepoDetail | Task 3 |
| Dashboard cards: View + Dismiss | Task 4 |
| File viewer with version dropdown | Task 2 |
| File picker + raw content | Task 2 |
| Version history with SHA cross-link to file viewer | Task 2 |
| Compare flow (two-step) | Task 2 |
| Installs section with all actions | Task 2 |
| New `GET /api/installs?artifactKey=` endpoint | Task 1 |
| Global installs skip drift | Task 1 |
| SHA outside 20-commit window shown as standalone option | Task 2 |
| Product spec update | Task 5 |

All spec requirements are covered. No gaps found.
