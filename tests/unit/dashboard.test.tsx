import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";
import { Dashboard } from "../../web/pages/Dashboard.tsx";
import type {
  NewArtifactNotification,
  UpdatedArtifactNotification,
  InstallWithStatus,
  WorkingRepo,
  SkillsRepo,
} from "../../web/api.ts";

afterEach(cleanup);

const mockNewArtifact: NewArtifactNotification = {
  kind: "new-artifact",
  key: "newArtifact:src1:src1:skills/foo:abc123",
  artifactKey: "src1:skills/foo",
  sourceRepoId: "src1",
  sourceName: "superpowers",
  sha: "abc123",
  name: "foo",
  description: "Does foo things.",
};

const mockUpdatedArtifact: UpdatedArtifactNotification = {
  kind: "updated-artifact",
  key: "updatedArtifact:src1:src1:skills/foo:def456",
  artifactKey: "src1:skills/foo",
  sourceRepoId: "src1",
  sourceName: "superpowers",
  fromSha: "abc123",
  toSha: "def456",
  name: "foo",
  description: "Does foo things.",
};

const mockWorkingRepo: WorkingRepo = {
  id: "w1", name: "my-app", path: "/home/dev/my-app", addedAt: "2024-01-01T00:00:00Z",
};

const mockInstall: InstallWithStatus = {
  id: "i1", artifactKey: "src1:skills/foo", sourceRepoId: "src1",
  target: { type: "working-repo", workingRepoId: "w1" },
  agent: "claude-code", artifactType: "skills",
  installedCommitSha: "abc123", autoUpdate: false,
  installedFiles: [], installedAt: "2024-01-01T00:00:00Z",
  status: "update-available", availableSha: "def456",
};

const mockSkillsRepo: SkillsRepo = {
  id: "src1", name: "superpowers",
  gitUrl: "https://github.com/example/superpowers",
  branch: "main",
  artifactPaths: { skills: ["skills"] },
  presetId: null,
  localClonePath: "/tmp/src1",
  lastFetchedAt: "2026-05-23T10:00:00Z",
};

function makeMockFetch(overrides: {
  newArtifacts?: NewArtifactNotification[];
  updatedArtifacts?: UpdatedArtifactNotification[];
  workingRepos?: WorkingRepo[];
  installs?: Record<string, InstallWithStatus[]>;
  skillsRepos?: SkillsRepo[];
  artifacts?: { artifactKey: string }[];
} = {}) {
  const {
    newArtifacts = [],
    updatedArtifacts = [],
    workingRepos = [],
    installs = {},
    skillsRepos = [],
    artifacts = [],
  } = overrides;
  return vi.fn(async (url: string) => {
    if (url === "/api/notifications") {
      return new Response(JSON.stringify({ newArtifacts, updatedArtifacts }), { status: 200 });
    }
    if (url === "/api/working-repos") return new Response(JSON.stringify(workingRepos), { status: 200 });
    if (url === "/api/skills-repos") return new Response(JSON.stringify(skillsRepos), { status: 200 });
    if (url.startsWith("/api/artifacts")) return new Response(JSON.stringify(artifacts), { status: 200 });
    const wrMatch = url.match(/\/api\/working-repos\/([^/]+)\/installs/);
    if (wrMatch) {
      const list = installs[wrMatch[1]!] ?? [];
      return new Response(JSON.stringify(list), { status: 200 });
    }
    if (url.startsWith("/api/activity-log")) return new Response(JSON.stringify([]), { status: 200 });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
}

function renderDashboard() {
  return render(<MemoryRouter><Dashboard /></MemoryRouter>);
}

describe("Dashboard — new-skill cards", () => {
  it("renders 'NEW SKILLS' section when there are only new-artifact notifications", async () => {
    globalThis.fetch = makeMockFetch({ newArtifacts: [mockNewArtifact] });
    renderDashboard();
    expect(await screen.findByText("NEW SKILLS")).toBeTruthy();
    expect(await screen.findByText("foo")).toBeTruthy();
    expect(await screen.findByText("superpowers")).toBeTruthy();
    expect(await screen.findByText("Does foo things.")).toBeTruthy();
  });

  it("renders View and Dismiss buttons for each new-artifact card (no Install)", async () => {
    globalThis.fetch = makeMockFetch({ newArtifacts: [mockNewArtifact] });
    renderDashboard();
    expect(await screen.findByRole("link", { name: "View" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Dismiss" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });

  it("does not render section when both arrays are empty", async () => {
    globalThis.fetch = makeMockFetch({ newArtifacts: [], updatedArtifacts: [] });
    renderDashboard();
    await screen.findByText("WORKING REPOS");
    expect(screen.queryByText("NEW SKILLS")).toBeNull();
    expect(screen.queryByText("UPDATED SKILLS")).toBeNull();
    expect(screen.queryByText("NEW & UPDATED SKILLS")).toBeNull();
  });

  it("calls dismiss API when Dismiss is clicked on new-artifact card", async () => {
    const mockFetch = makeMockFetch({ newArtifacts: [mockNewArtifact] });
    globalThis.fetch = mockFetch;
    renderDashboard();
    const dismissBtn = await screen.findByRole("button", { name: "Dismiss" });
    fireEvent.click(dismissBtn);
    await screen.findByText("WORKING REPOS");
    const calls = mockFetch.mock.calls;
    const dismissCall = calls.find(([url, opts]: [string, RequestInit]) =>
      url === "/api/notifications/dismiss" && opts?.method === "POST"
    );
    expect(dismissCall).toBeTruthy();
  });
});

describe("Dashboard — updated-skill cards", () => {
  it("renders 'UPDATED SKILLS' section when there are only updated-artifact notifications", async () => {
    globalThis.fetch = makeMockFetch({ updatedArtifacts: [mockUpdatedArtifact] });
    renderDashboard();
    expect(await screen.findByText("UPDATED SKILLS")).toBeTruthy();
    expect(await screen.findByText("foo")).toBeTruthy();
    expect(await screen.findByText("UPDATED")).toBeTruthy();
  });

  it("renders 'NEW & UPDATED SKILLS' when both kinds are present", async () => {
    globalThis.fetch = makeMockFetch({
      newArtifacts: [mockNewArtifact],
      updatedArtifacts: [mockUpdatedArtifact],
    });
    renderDashboard();
    expect(await screen.findByText("NEW & UPDATED SKILLS")).toBeTruthy();
  });

  it("renders View diff link pointing to version-vs-version diff page", async () => {
    globalThis.fetch = makeMockFetch({ updatedArtifacts: [mockUpdatedArtifact] });
    renderDashboard();
    const link = await screen.findByRole("link", { name: "View diff" });
    const href = link.getAttribute("href") ?? "";
    expect(href).toContain("mode=version-vs-version");
    expect(href).toContain("fromSha=abc123");
    expect(href).toContain("toSha=def456");
  });

  it("renders Dismiss button on updated-artifact card", async () => {
    globalThis.fetch = makeMockFetch({ updatedArtifacts: [mockUpdatedArtifact] });
    renderDashboard();
    expect(await screen.findByRole("button", { name: "Dismiss" })).toBeTruthy();
  });

  it("removes card after dismiss is clicked", async () => {
    const mockFetch = makeMockFetch({ updatedArtifacts: [mockUpdatedArtifact] });
    globalThis.fetch = mockFetch;
    renderDashboard();
    const dismissBtn = await screen.findByRole("button", { name: "Dismiss" });
    fireEvent.click(dismissBtn);
    await screen.findByText("WORKING REPOS");
    const calls = mockFetch.mock.calls;
    const dismissCall = calls.find(([url, opts]: [string, RequestInit]) =>
      url === "/api/notifications/dismiss" && opts?.method === "POST"
    );
    expect(dismissCall).toBeTruthy();
  });
});

describe("Dashboard — working-repo cards", () => {
  it("renders working-repo card with name and path", async () => {
    globalThis.fetch = makeMockFetch({
      workingRepos: [mockWorkingRepo],
      installs: { w1: [mockInstall] },
    });
    renderDashboard();
    expect(await screen.findByText("my-app")).toBeTruthy();
    expect(await screen.findByText("/home/dev/my-app")).toBeTruthy();
  });

  it("renders notification dot when any install has non-up-to-date status", async () => {
    globalThis.fetch = makeMockFetch({
      workingRepos: [mockWorkingRepo],
      installs: { w1: [mockInstall] },
    });
    renderDashboard();
    await screen.findByText("my-app");
    expect(document.querySelector("[data-testid='notification-dot']")).toBeTruthy();
  });

  it("does not render notification dot when all installs are up-to-date", async () => {
    globalThis.fetch = makeMockFetch({
      workingRepos: [mockWorkingRepo],
      installs: { w1: [{ ...mockInstall, status: "up-to-date", availableSha: null }] },
    });
    renderDashboard();
    await screen.findByText("my-app");
    expect(document.querySelector("[data-testid='notification-dot']")).toBeNull();
  });

  it("renders installed-skill chips", async () => {
    globalThis.fetch = makeMockFetch({
      workingRepos: [mockWorkingRepo],
      installs: { w1: [mockInstall] },
    });
    renderDashboard();
    expect(await screen.findByText("foo")).toBeTruthy();
  });
});

describe("Dashboard — skills-repo list", () => {
  it("renders SKILLS REPOS section with repo name", async () => {
    globalThis.fetch = makeMockFetch({ skillsRepos: [mockSkillsRepo] });
    renderDashboard();
    expect(await screen.findByText("SKILLS REPOS")).toBeTruthy();
    expect(await screen.findByText("superpowers")).toBeTruthy();
  });
});
