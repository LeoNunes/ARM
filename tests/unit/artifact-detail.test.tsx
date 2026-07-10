import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ArtifactDetail } from "../../web/pages/ArtifactDetail.tsx";

afterEach(cleanup);

const mockArtifact = {
  artifactKey: "src1:skills/foo",
  sourceRepoId: "src1",
  sourceName: "acme-skills",
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

  it("renders source repo name as a link to the repo detail page", async () => {
    renderDetail();
    const link = await screen.findByRole("link", { name: "acme-skills" });
    expect(link).toHaveAttribute("href", "/skills-repos/src1");
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
