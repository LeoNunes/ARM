import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Diff } from "../../web/pages/Diff.tsx";
import type { DiffResponse } from "../../web/api.ts";

afterEach(cleanup);

vi.mock("react-diff-viewer-continued", () => ({
  default: ({ oldValue, newValue }: { oldValue: string; newValue: string }) => (
    <div data-testid="diff-viewer">{oldValue}{newValue}</div>
  ),
}));

const mockDiffResponse: DiffResponse = {
  artifactKey: "src1:skills/foo",
  artifactName: "foo",
  fromSha: "abc1234",
  toSha: "def5678",
  mode: "installed-vs-latest",
  label: "installed vs latest",
  files: [
    { path: "skills/foo/SKILL.md", fromContent: "# Old content", toContent: "# New content", changed: true },
    { path: "skills/foo/README.md", fromContent: "Same", toContent: "Same", changed: false },
  ],
  primaryAction: "update",
  installId: "install-1",
};

function makeMockFetch(diffResponse: DiffResponse = mockDiffResponse) {
  return vi.fn(async (url: string, opts?: RequestInit) => {
    if (url.startsWith("/api/diff")) return new Response(JSON.stringify(diffResponse), { status: 200 });
    if (url.includes("/update") && opts?.method === "POST") return new Response("{}", { status: 200 });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
}

function renderDiff(search = "?mode=installed-vs-latest&installId=install-1") {
  return render(
    <MemoryRouter initialEntries={[`/diff${search}`]}>
      <Routes>
        <Route path="/diff" element={<Diff />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Diff page", () => {
  it("renders artifact name in header", async () => {
    globalThis.fetch = makeMockFetch();
    renderDiff();
    expect(await screen.findByText("foo")).toBeTruthy();
  });

  it("renders label in header", async () => {
    globalThis.fetch = makeMockFetch();
    renderDiff();
    expect(await screen.findByText("installed vs latest")).toBeTruthy();
  });

  it("renders file list in left pane", async () => {
    globalThis.fetch = makeMockFetch();
    renderDiff();
    expect(await screen.findByText("SKILL.md")).toBeTruthy();
    expect(await screen.findByText("README.md")).toBeTruthy();
  });

  it("marks changed files with a ± indicator", async () => {
    globalThis.fetch = makeMockFetch();
    renderDiff();
    await screen.findByText("SKILL.md");
    const changedIndicators = document.querySelectorAll("[data-testid='file-changed']");
    expect(changedIndicators.length).toBe(1);
  });

  it("renders 'Update' footer button for installed-vs-latest mode", async () => {
    globalThis.fetch = makeMockFetch();
    renderDiff();
    expect(await screen.findByRole("button", { name: /Update/ })).toBeTruthy();
  });

  it("renders 'Re-apply' footer button for installed-vs-drifted mode", async () => {
    globalThis.fetch = makeMockFetch({
      ...mockDiffResponse,
      mode: "installed-vs-drifted",
      label: "installed vs current file",
      primaryAction: "re-apply",
    });
    renderDiff("?mode=installed-vs-drifted&installId=install-1");
    expect(await screen.findByRole("button", { name: /Re-apply/ })).toBeTruthy();
  });

  it("renders no primary action button for version-vs-version mode", async () => {
    globalThis.fetch = makeMockFetch({
      ...mockDiffResponse,
      mode: "version-vs-version",
      label: "abc1234 → def5678",
      primaryAction: null,
      installId: null,
    });
    renderDiff("?mode=version-vs-version&artifactKey=src1%3Askills%2Ffoo&fromSha=abc1234&toSha=def5678");
    await screen.findByText("abc1234 → def5678");
    expect(screen.queryByRole("button", { name: /Update|Re-apply/ })).toBeNull();
  });

  it("renders Side-by-side toggle button", async () => {
    globalThis.fetch = makeMockFetch();
    renderDiff();
    expect(await screen.findByRole("button", { name: "Side-by-side" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Unified" })).toBeTruthy();
  });
});
