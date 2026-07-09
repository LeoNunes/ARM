import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { FavoriteStar } from "../../web/components/FavoriteStar.tsx";

describe("FavoriteStar", () => {
  it("renders a filled star when favorited", () => {
    render(<FavoriteStar favorited={true} onToggle={() => {}} />);
    expect(screen.getByRole("button").textContent).toBe("★");
  });

  it("renders an outline star when not favorited", () => {
    render(<FavoriteStar favorited={false} onToggle={() => {}} />);
    expect(screen.getByRole("button").textContent).toBe("☆");
  });

  it("calls onToggle when clicked", () => {
    const onToggle = vi.fn();
    render(<FavoriteStar favorited={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("does not propagate the click to an ancestor handler", () => {
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <FavoriteStar favorited={false} onToggle={() => {}} />
      </div>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(parentClick).not.toHaveBeenCalled();
  });

  it("has an accessible label reflecting current state", () => {
    render(<FavoriteStar favorited={true} onToggle={() => {}} />);
    expect(screen.getByRole("button", { name: "Unfavorite" })).toBeTruthy();
  });
});
