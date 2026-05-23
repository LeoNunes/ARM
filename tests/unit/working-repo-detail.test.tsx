import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

afterEach(cleanup);
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { WorkingRepoDetail } from "../../web/pages/WorkingRepoDetail.tsx";
import type { InstallWithStatus } from "../../web/api.ts";

const mockInstalls: InstallWithStatus[] = [
  {
    id: "i1", artifactKey: "src1:ai/skills/foo", sourceRepoId: "src1",
    target: { type: "working-repo", workingRepoId: "w1" },
    agent: "claude-code", artifactType: "skills",
    installedCommitSha: "abc1234", autoUpdate: true,
    installedFiles: [], installedAt: "2024-01-01T00:00:00.000Z",
    status: "update-available+drifted", availableSha: "def5678",
  },
  {
    id: "i2", artifactKey: "src1:ai/skills/bar", sourceRepoId: "src1",
    target: { type: "working-repo", workingRepoId: "w1" },
    agent: "claude-code", artifactType: "skills",
    installedCommitSha: "abc1234", autoUpdate: false,
    installedFiles: [], installedAt: "2024-01-01T00:00:00.000Z",
    status: "up-to-date", availableSha: null,
  },
];

vi.mock("../../web/api.ts", () => ({
  api: {
    listWorkingRepos: vi.fn(async () => [
      { id: "w1", name: "My Repo", path: "/some/path", addedAt: "2024-01-01T00:00:00.000Z" },
    ]),
    listInstallsByWorkingRepo: vi.fn(async () => mockInstalls),
    refreshWorkingRepo: vi.fn(async () => mockInstalls),
    updateInstall: vi.fn(async () => ({ ...mockInstalls[0], autoUpdate: false })),
    applyInstallUpdate: vi.fn(async () => ({ ...mockInstalls[0], installedCommitSha: "def5678" })),
    deleteInstall: vi.fn(async () => undefined),
  },
}));

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={["/working-repos/w1"]}>
      <Routes>
        <Route path="/working-repos/:id" element={<WorkingRepoDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("WorkingRepoDetail", () => {
  it("renders the status column header", async () => {
    renderDetail();
    const header = await screen.findByText("Status");
    expect(header).toBeTruthy();
  });

  it("renders filter chips — All, Update available, Drifted", async () => {
    renderDetail();
    expect(await screen.findByText("All")).toBeTruthy();
    expect(await screen.findByText("Update available")).toBeTruthy();
    expect(await screen.findByText("Drifted")).toBeTruthy();
  });

  it("shows all installs when All chip is active", async () => {
    renderDetail();
    await screen.findByText("Status");
    expect(await screen.findByText("foo")).toBeTruthy();
    expect(await screen.findByText("bar")).toBeTruthy();
  });

  it("filters to only update-available installs when that chip is clicked", async () => {
    renderDetail();
    await screen.findByText("Status");
    const chip = await screen.findByRole("button", { name: "Update available" });
    fireEvent.click(chip);
    expect(screen.queryByText("bar")).toBeNull();
  });

  it("renders Disable auto-update and Discard & update buttons for update-available+drifted", async () => {
    renderDetail();
    expect(await screen.findByRole("button", { name: "Disable auto-update" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Discard & update" })).toBeTruthy();
  });
});
