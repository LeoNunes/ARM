import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Settings } from "../../web/pages/Settings.tsx";

function makeSettingsMock(overrides: Partial<{ favoriteAgent: string; mcpPort: number }> = {}) {
  const settings = { favoriteAgent: "claude-code", mcpPort: 7747, ...overrides };
  return vi.fn(async (url: string, opts?: RequestInit) => {
    if (url === "/api/settings" && (!opts?.method || opts.method === "GET")) {
      return new Response(JSON.stringify(settings), { status: 200 });
    }
    if (url === "/api/settings" && opts?.method === "PATCH") {
      const body = JSON.parse(opts.body as string);
      return new Response(JSON.stringify({ ...settings, ...body }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
}

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe("Settings MCP panel", () => {
  it("shows 'Running' status", async () => {
    globalThis.fetch = makeSettingsMock();
    render(<Settings />);
    expect(await screen.findByText("Running")).toBeTruthy();
  });

  it("shows the MCP URL with the configured port", async () => {
    globalThis.fetch = makeSettingsMock({ mcpPort: 7747 });
    render(<Settings />);
    expect(await screen.findByText("http://127.0.0.1:7747/mcp")).toBeTruthy();
  });

  it("renders port input with current value", async () => {
    globalThis.fetch = makeSettingsMock({ mcpPort: 7747 });
    render(<Settings />);
    const input = await screen.findByLabelText("MCP port") as HTMLInputElement;
    expect(input.value).toBe("7747");
  });

  it("saves port on Save button click", async () => {
    const mockFetch = makeSettingsMock({ mcpPort: 7747 });
    globalThis.fetch = mockFetch;
    render(<Settings />);
    const input = await screen.findByLabelText("MCP port");
    fireEvent.change(input, { target: { value: "8080" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/settings",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining("8080"),
        }),
      );
    });
  });

  it("renders Claude Code copy-snippet button", async () => {
    globalThis.fetch = makeSettingsMock();
    render(<Settings />);
    const buttons = await screen.findAllByText(/Copy/);
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });

  it("copy button writes JSON snippet to clipboard", async () => {
    globalThis.fetch = makeSettingsMock({ mcpPort: 7747 });
    render(<Settings />);
    const copyButtons = await screen.findAllByText(/Copy/);
    fireEvent.click(copyButtons[0]!);
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('"url": "http://127.0.0.1:7747/mcp"'),
      );
    });
  });
});
