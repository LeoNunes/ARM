import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusPill } from "../../web/components/StatusPill.tsx";

describe("StatusPill", () => {
  it("renders 'Up to date' for up-to-date status", () => {
    render(<StatusPill status="up-to-date" />);
    expect(screen.getByText("Up to date")).toBeTruthy();
  });
  it("renders 'Update available' for update-available status", () => {
    render(<StatusPill status="update-available" />);
    expect(screen.getByText("Update available")).toBeTruthy();
  });
  it("renders 'Drifted' for drifted status", () => {
    render(<StatusPill status="drifted" />);
    expect(screen.getByText("Drifted")).toBeTruthy();
  });
  it("renders 'Update + drifted' for update-available+drifted status", () => {
    render(<StatusPill status="update-available+drifted" />);
    expect(screen.getByText("Update + drifted")).toBeTruthy();
  });
});
