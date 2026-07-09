import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";
import { Browse } from "../../web/pages/Browse.tsx";

afterEach(cleanup);

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
    listArtifacts: vi.fn(async () => mockArtifacts),
    setFavorite: vi.fn(async () => undefined),
  },
}));

function renderBrowse() {
  return render(<MemoryRouter><Browse /></MemoryRouter>);
}

describe("Browse — favorite star", () => {
  it("renders a filled star for a favorited artifact and an outline star for a non-favorited one", async () => {
    renderBrowse();
    await screen.findByText("alpha");
    expect(screen.getByRole("button", { name: "Unfavorite" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Favorite" })).toBeTruthy();
  });

  it("calls api.setFavorite with the toggled value when a star is clicked", async () => {
    const { api } = await import("../../web/api.ts");
    renderBrowse();
    await screen.findByText("alpha");
    fireEvent.click(screen.getByRole("button", { name: "Unfavorite" }));
    expect(api.setFavorite).toHaveBeenCalledWith("src1:skills/alpha", false);
  });
});
