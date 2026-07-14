import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";
import { EditSkillsRepoModal } from "../../web/components/EditSkillsRepoModal.tsx";

afterEach(cleanup);

const repo = {
  id: "r1", name: "superpowers", gitUrl: "https://x/y", branch: "main",
  artifactPaths: { skills: ["ai/skills"], rules: [] },
  presetId: null, localClonePath: "/tmp/r1", lastFetchedAt: null,
};

vi.mock("../../web/api.ts", () => ({
  api: { updateSkillsRepo: vi.fn() },
}));

function renderModal(onDone = vi.fn(), onClose = vi.fn()) {
  return render(
    <MemoryRouter>
      <EditSkillsRepoModal repo={repo} onClose={onClose} onDone={onDone} />
    </MemoryRouter>,
  );
}

describe("EditSkillsRepoModal", () => {
  it("pre-fills name and paths and saves the edited values", async () => {
    const { api } = await import("../../web/api.ts");
    (api.updateSkillsRepo as ReturnType<typeof vi.fn>).mockResolvedValue({ ...repo, name: "renamed" });
    const onDone = vi.fn();
    renderModal(onDone);

    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    expect(nameInput.value).toBe("superpowers");
    fireEvent.change(nameInput, { target: { value: "renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.updateSkillsRepo).toHaveBeenCalledWith("r1", {
      name: "renamed",
      artifactPaths: { skills: ["ai/skills"], rules: [] },
    }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("renders path blockers on a 409 and keeps the modal open", async () => {
    const { api } = await import("../../web/api.ts");
    (api.updateSkillsRepo as ReturnType<typeof vi.fn>).mockRejectedValue(Object.assign(new Error("paths in use"), {
      code: "paths_in_use",
      blockers: [{ type: "skills", path: "ai/skills", artifacts: [{ artifactKey: "r1:ai/skills/foo", name: "foo" }] }],
    }));
    const onDone = vi.fn();
    renderModal(onDone);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText(/Can't remove/);
    expect(screen.getByRole("link", { name: "foo" })).toHaveAttribute(
      "href", expect.stringContaining("artifactKey=r1%3Aai%2Fskills%2Ffoo"),
    );
    expect(onDone).not.toHaveBeenCalled();
  });
});
