import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";
import { SkillsRepos } from "../../web/pages/SkillsRepos.tsx";

afterEach(cleanup);

const repo = {
  id: "r1", name: "superpowers", gitUrl: "https://github.com/example/superpowers.git", branch: "main",
  artifactPaths: { skills: ["ai/skills"], rules: ["ai/rules"] },
  presetId: null, localClonePath: "/tmp/r1", lastFetchedAt: null,
};

vi.mock("../../web/api.ts", () => ({
  api: {
    listSkillsRepos: vi.fn(async () => [repo]),
    deleteSkillsRepo: vi.fn(),
  },
}));

function renderPage() {
  return render(<MemoryRouter><SkillsRepos /></MemoryRouter>);
}

describe("SkillsRepos — column widths", () => {
  it("declares a colgroup sizing Name, Git URL, Branch, Skills paths, and Rules paths, with the action column shrunk", async () => {
    const { container } = renderPage();
    await screen.findByText("superpowers");
    const cols = container.querySelectorAll("table.table > colgroup > col");
    expect(cols).toHaveLength(6);
    const widths = Array.from(cols).map((c) => (c as HTMLElement).style.width);
    expect(widths).toEqual(["16%", "28%", "10%", "18%", "18%", ""]);
    expect(cols[5]).toHaveClass("col-shrink");
  });

  it("truncates the free-text cells with an ellipsis and exposes the full value via title", async () => {
    const { container } = renderPage();
    await screen.findByText("superpowers");
    const row = container.querySelector("tbody tr")!;
    const [nameCell, gitUrlCell, branchCell, skillsCell, rulesCell] = Array.from(row.children) as HTMLElement[];
    expect(nameCell).toHaveClass("col-truncate");
    expect(nameCell).toHaveAttribute("title", "superpowers");
    expect(gitUrlCell).toHaveClass("col-truncate");
    expect(gitUrlCell).toHaveAttribute("title", repo.gitUrl);
    expect(branchCell).toHaveClass("col-truncate");
    expect(branchCell).toHaveAttribute("title", "main");
    expect(skillsCell).toHaveClass("col-truncate");
    expect(skillsCell).toHaveAttribute("title", "ai/skills");
    expect(rulesCell).toHaveClass("col-truncate");
    expect(rulesCell).toHaveAttribute("title", "ai/rules");
  });
});
