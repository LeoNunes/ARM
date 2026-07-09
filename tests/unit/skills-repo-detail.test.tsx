import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SkillsRepoDetail } from "../../web/pages/SkillsRepoDetail.tsx";

afterEach(cleanup);

const mockRepo = {
  id: "src1", name: "superpowers",
  gitUrl: "https://github.com/example/superpowers",
  branch: "main",
  artifactPaths: { skills: ["skills"] },
  presetId: null,
  localClonePath: "/tmp/src1",
  lastFetchedAt: "2026-05-23T10:00:00Z",
};

const mockArtifacts = [
  {
    artifactKey: "src1:skills/bravo", sourceRepoId: "src1", type: "skills" as const,
    name: "bravo", description: "Bravo skill.", rootRelativePath: "skills/bravo",
    files: [], lastTouchedSha: "sha1", isFavorite: false,
  },
  {
    artifactKey: "src1:skills/alpha", sourceRepoId: "src1", type: "skills" as const,
    name: "alpha", description: "Alpha skill.", rootRelativePath: "skills/alpha",
    files: [], lastTouchedSha: "sha2", isFavorite: true,
  },
];

vi.mock("../../web/api.ts", () => ({
  api: {
    getSkillsRepo: vi.fn(async () => mockRepo),
    listArtifacts: vi.fn(async () => mockArtifacts),
    setFavorite: vi.fn(async () => undefined),
  },
}));

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={["/skills-repos/src1"]}>
      <Routes>
        <Route path="/skills-repos/:id" element={<SkillsRepoDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SkillsRepoDetail — favorite star", () => {
  it("renders a filled star for a favorited artifact and an outline star for a non-favorited one", async () => {
    renderDetail();
    await screen.findByText("alpha");
    expect(screen.getByRole("button", { name: "Unfavorite" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Favorite" })).toBeTruthy();
  });

  it("calls api.setFavorite with the toggled value when a star is clicked", async () => {
    const { api } = await import("../../web/api.ts");
    renderDetail();
    await screen.findByText("alpha");
    fireEvent.click(screen.getByRole("button", { name: "Favorite" }));
    expect(api.setFavorite).toHaveBeenCalledWith("src1:skills/bravo", true);
  });
});
