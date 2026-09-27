import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../app/App";

describe("LexiGrid menu", () => {
  it("offers every supported board size and defaults to 4 × 4", () => {
    render(<App />);
    expect(screen.getByRole("radio", { name: /4 × 4/i })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /5 × 5/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /6 × 6/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start game/i })).toBeInTheDocument();
  });
});

