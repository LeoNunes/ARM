import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";
import { SkillsRepos } from "../../web/pages/SkillsRepos.tsx";

afterEach(cleanup);

const repo = {
  id: "r1", name: "superpowers", gitUrl: "https://x/y", branch: "main",
  artifactPaths: { skills: ["ai/skills"], rules: [] },
  presetId: null, localClonePath: "/tmp/r1", lastFetchedAt: null,
};

vi.mock("../../web/api.ts", () => ({
  api: {
    listSkillsRepos: vi.fn(async () => [repo]),
    deleteSkillsRepo: vi.fn(),
  },
}));

describe("SkillsRepos — guarded remove", () => {
  it("shows blocker links when removal is refused", async () => {
    const { api } = await import("../../web/api.ts");
    (api.deleteSkillsRepo as ReturnType<typeof vi.fn>).mockRejectedValue(Object.assign(new Error("in use"), {
      code: "repo_in_use",
      blockers: [{ artifactKey: "r1:ai/skills/foo", name: "foo" }],
    }));
    render(<MemoryRouter><SkillsRepos /></MemoryRouter>);
    await screen.findByText("superpowers");
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await screen.findByText(/still installed/i);
    expect(screen.getByRole("link", { name: "foo" })).toHaveAttribute(
      "href", expect.stringContaining("artifactKey=r1%3Aai%2Fskills%2Ffoo"),
    );
  });
});
