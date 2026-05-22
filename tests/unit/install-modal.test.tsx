// tests/unit/install-modal.test.tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { InstallModal } from "../../web/components/InstallModal.tsx";
import type { Artifact } from "../../web/api.ts";

beforeEach(() => {
  globalThis.fetch = vi.fn(async (url: string) => {
    if (url === "/api/settings") return new Response(JSON.stringify({ favoriteAgent: "cursor", mcpPort: 7747 }), { status: 200 });
    if (url === "/api/working-repos") return new Response(JSON.stringify([{ id: "w1", name: "alpha", path: "/x", addedAt: "" }]), { status: 200 });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
});

const artifact: Artifact = {
  artifactKey: "src1:ai/skills/foo", sourceRepoId: "src1", type: "skills",
  name: "foo", description: null, rootRelativePath: "ai/skills/foo",
  files: ["ai/skills/foo/SKILL.md"], lastTouchedSha: "abc",
};

describe("InstallModal", () => {
  it("pre-fills the agent from settings.favoriteAgent", async () => {
    render(<InstallModal artifact={artifact} onClose={() => {}} onDone={() => {}} />);
    const select = await waitFor(() => screen.getByLabelText("Agent") as HTMLSelectElement);
    expect(select.value).toBe("cursor");
  });
});
