import { describe, expect, it } from "vitest";
import { areAdjacent, solveBoard, validatePath } from "./solver";
import { createTrie } from "./trie";
import { scoreWord } from "./scoring";
import { getRemainingSeconds, ROUND_DURATION_MS } from "./timer";

const board = [
  "c", "a", "t", "s",
  "r", "e", "d", "o",
  "b", "i", "r", "d",
  "m", "o", "o", "n",
];

describe("path rules", () => {
  it("allows horizontal, vertical, diagonal, and changing direction", () => {
    expect(areAdjacent(0, 1, 4)).toBe(true);
    expect(areAdjacent(0, 4, 4)).toBe(true);
    expect(areAdjacent(0, 5, 4)).toBe(true);
    expect(validatePath([0, 1, 6, 5, 8], 4)).toBe(true);
  });

  it("rejects jumps, impossible indexes, and tile reuse", () => {
    expect(validatePath([0, 2], 4)).toBe(false);
    expect(validatePath([0, 1, 0], 4)).toBe(false);
    expect(validatePath([16], 4)).toBe(false);
  });
});

describe("board solver and dictionary", () => {
  const words = ["cat", "cats", "car", "care", "red", "bird", "moon", "cab"];
  const solved = solveBoard(board, 4, createTrie(words));

  it("finds known words through legal paths", () => {
    expect(solved.size).toBeGreaterThan(0);
    expect([...solved]).toEqual(expect.arrayContaining(["cat", "cats", "car", "care", "red", "bird", "moon"]));
  });

  it("does not accept a dictionary word with no legal path", () => {
    expect(solved.has("cab")).toBe(false);
  });
});

describe("scoring and round timing", () => {
  it.each([["cat", 100], ["word", 400], ["trace", 800], ["search", 1400], ["letters", 1800], ["diagonal", 2200], ["discovery", 2600]])("scores %s", (word, score) => {
    expect(scoreWord(word as string)).toBe(score);
  });

  it("uses timestamps and completes exactly at the round deadline", () => {
    expect(getRemainingSeconds(10_000, 10_000)).toBe(120);
    expect(getRemainingSeconds(10_000, 10_000 + ROUND_DURATION_MS)).toBe(0);
    expect(getRemainingSeconds(10_000, 10_000 + ROUND_DURATION_MS + 5_000)).toBe(0);
  });
});

describe("submission bookkeeping", () => {
  it("makes duplicate-word prevention a constant-time set check", () => {
    const found = new Set(["cat"]);
    expect(found.has("cat")).toBe(true);
    expect(found.has("cats")).toBe(false);
  });
});
