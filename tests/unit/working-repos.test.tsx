import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";
import { WorkingRepos } from "../../web/pages/WorkingRepos.tsx";

afterEach(cleanup);

const repo = { id: "w1", name: "My Repo", path: "/home/dev/very/long/path/to/repo", addedAt: "2024-01-01T00:00:00.000Z" };

vi.mock("../../web/api.ts", () => ({
  api: {
    listWorkingRepos: vi.fn(async () => [repo]),
    deleteWorkingRepo: vi.fn(async () => undefined),
  },
}));

function renderPage() {
  return render(<MemoryRouter><WorkingRepos /></MemoryRouter>);
}

describe("WorkingRepos — column widths", () => {
  it("declares a colgroup with Name and Path sized, and the action column shrunk", async () => {
    const { container } = renderPage();
    await screen.findByText("My Repo");
    const cols = container.querySelectorAll("table.table > colgroup > col");
    expect(cols).toHaveLength(3);
    expect((cols[0] as HTMLElement).style.width).toBe("30%");
    expect((cols[1] as HTMLElement).style.width).toBe("65%");
    expect(cols[2]).toHaveClass("col-shrink");
  });

  it("truncates the Name and Path cells with an ellipsis and exposes the full value via title", async () => {
    const { container } = renderPage();
    await screen.findByText("My Repo");
    const row = container.querySelector("tbody tr")!;
    const nameCell = row.children[0] as HTMLElement;
    const pathCell = row.children[1] as HTMLElement;
    expect(nameCell).toHaveClass("col-truncate");
    expect(nameCell).toHaveAttribute("title", "My Repo");
    expect(pathCell).toHaveClass("col-truncate");
    expect(pathCell).toHaveAttribute("title", repo.path);
  });
});
