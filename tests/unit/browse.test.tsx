import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";
import { Browse } from "../../web/pages/Browse.tsx";

afterEach(cleanup);

const mockArtifacts = [
  {
    artifactKey: "src1:skills/bravo", sourceRepoId: "src1", sourceName: "acme-skills", type: "skills" as const,
    name: "bravo", description: "Bravo skill.", rootRelativePath: "skills/bravo",
    files: [], lastTouchedSha: "sha1", isFavorite: false,
  },
  {
    artifactKey: "src1:skills/alpha", sourceRepoId: "src1", sourceName: "acme-skills", type: "skills" as const,
    name: "alpha", description: "Alpha skill.", rootRelativePath: "skills/alpha",
    files: [], lastTouchedSha: "sha2", isFavorite: true,
  },
  {
    artifactKey: "src1:rules/style.md", sourceRepoId: "src1", sourceName: "acme-skills", type: "rules" as const,
    name: "style", description: "Style rule.", rootRelativePath: "rules/style.md",
    files: ["rules/style.md"], lastTouchedSha: "sha3", isFavorite: false,
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

function nameOrder(container: HTMLElement) {
  return Array.from(container.querySelectorAll('a[href^="/artifacts?"]')).map((el) => el.textContent);
}

describe("Browse — favorite star", () => {
  it("renders a filled star for a favorited artifact and an outline star for a non-favorited one", async () => {
    renderBrowse();
    await screen.findByText("alpha");
    expect(screen.getByRole("button", { name: "Unfavorite" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Favorite" })).toHaveLength(2);
  });

  it("calls api.setFavorite with the toggled value when a star is clicked", async () => {
    const { api } = await import("../../web/api.ts");
    renderBrowse();
    await screen.findByText("alpha");
    fireEvent.click(screen.getByRole("button", { name: "Unfavorite" }));
    expect(api.setFavorite).toHaveBeenCalledWith("src1:skills/alpha", false);
  });
});

describe("Browse — source column", () => {
  it("renders the source repo name as a link to the repo detail page", async () => {
    renderBrowse();
    await screen.findByText("alpha");
    const links = screen.getAllByRole("link", { name: "acme-skills" });
    expect(links).toHaveLength(3);
    expect(links[0]).toHaveAttribute("href", "/skills-repos/src1");
  });
});

describe("Browse — artifact type", () => {
  it("renders a type badge per row", async () => {
    renderBrowse();
    await screen.findByText("alpha");
    expect(screen.getAllByText("skill").length).toBe(2);
    expect(screen.getAllByText("rule").length).toBe(1);
  });

  it("passes the selected type to api.listArtifacts", async () => {
    const { api } = await import("../../web/api.ts");
    renderBrowse();
    await screen.findByText("alpha");
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "rules" } });
    await waitFor(() => {
      expect(api.listArtifacts).toHaveBeenLastCalledWith(
        { q: undefined, type: "rules" },
        expect.anything(),
      );
    });
  });
});

describe("Browse — column widths", () => {
  it("gives the favorite-star column a fixed icon width via col-icon", async () => {
    const { container } = renderBrowse();
    await screen.findByText("alpha");
    const cols = container.querySelectorAll("table.table > colgroup > col");
    expect(cols).toHaveLength(6);
    expect(cols[0]).toHaveClass("col-icon");
  });

  it("shrinks the Type and Install columns to fit their content", async () => {
    const { container } = renderBrowse();
    await screen.findByText("alpha");
    const cols = container.querySelectorAll("table.table > colgroup > col");
    expect(cols[2]).toHaveClass("col-shrink");
    expect(cols[5]).toHaveClass("col-shrink");
  });

  it("gives Description the largest share of the row, ahead of Name and Source", async () => {
    const { container } = renderBrowse();
    await screen.findByText("alpha");
    const cols = container.querySelectorAll("table.table > colgroup > col");
    const widths = Array.from(cols).map((c) => (c as HTMLElement).style.width);
    // [favorite, name, type, source, description, install]
    expect(widths[4]).toBe("45%");
    expect(parseFloat(widths[4])).toBeGreaterThan(parseFloat(widths[1]));
    expect(parseFloat(widths[4])).toBeGreaterThan(parseFloat(widths[3]));
  });

  it("truncates the Name and Source cells with an ellipsis and exposes the full value via title", async () => {
    const { container } = renderBrowse();
    await screen.findByText("alpha");
    const rows = container.querySelectorAll("tbody tr");
    const firstRow = rows[0]!;
    const nameCell = firstRow.children[1] as HTMLElement;
    const sourceCell = firstRow.children[3] as HTMLElement;
    expect(nameCell).toHaveClass("col-truncate");
    expect(nameCell).toHaveAttribute("title", "bravo");
    expect(sourceCell).toHaveClass("col-truncate");
    expect(sourceCell).toHaveAttribute("title", "acme-skills");
  });
});

describe("Browse — sorting", () => {
  it("defaults to the order returned by the API (unsorted)", async () => {
    const { container } = renderBrowse();
    await screen.findByText("alpha");
    expect(nameOrder(container)).toEqual(["bravo", "alpha", "style"]);
  });

  it("sorts by Name ascending on first click and descending on second click", async () => {
    const { container } = renderBrowse();
    await screen.findByText("alpha");

    fireEvent.click(screen.getByRole("button", { name: /^Name/ }));
    expect(nameOrder(container)).toEqual(["alpha", "bravo", "style"]);
    expect(screen.getByRole("button", { name: "Name ▲" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Name/ }));
    expect(nameOrder(container)).toEqual(["style", "bravo", "alpha"]);
    expect(screen.getByRole("button", { name: "Name ▼" })).toBeTruthy();
  });

  it("sorts by Type ascending, using the rendered label and a stable order within ties", async () => {
    const { container } = renderBrowse();
    await screen.findByText("alpha");
    fireEvent.click(screen.getByRole("button", { name: /^Type/ }));
    // "rule" < "skill"; the two skills (bravo, alpha) keep their original relative order.
    expect(nameOrder(container)).toEqual(["style", "bravo", "alpha"]);
  });

  it("sorts by Source ascending using the source display name", async () => {
    const { api } = await import("../../web/api.ts");
    vi.mocked(api.listArtifacts).mockResolvedValueOnce([
      { ...mockArtifacts[0], sourceName: "zeta-skills" },
      { ...mockArtifacts[1], sourceName: "acme-skills" },
      { ...mockArtifacts[2], sourceName: "middle-skills" },
    ]);
    const { container } = renderBrowse();
    await screen.findByText("alpha");
    fireEvent.click(screen.getByRole("button", { name: /^Source/ }));
    expect(nameOrder(container)).toEqual(["alpha", "style", "bravo"]);
  });

  it("switching to a different sortable column resets direction to ascending", async () => {
    const { container } = renderBrowse();
    await screen.findByText("alpha");
    fireEvent.click(screen.getByRole("button", { name: /^Name/ })); // asc
    fireEvent.click(screen.getByRole("button", { name: /^Name/ })); // desc
    fireEvent.click(screen.getByRole("button", { name: /^Type/ })); // switch column -> asc
    expect(screen.getByRole("button", { name: "Type ▲" })).toBeTruthy();
    expect(nameOrder(container)).toEqual(["style", "bravo", "alpha"]);
  });
});
