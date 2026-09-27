import { describe, expect, it } from "vitest";
import { createDeck, shuffleDeck } from "./deck";
import { applyAction, createLocalPlayers, createMatch } from "./engine";
import { isPlayable } from "./rules";
import type { Card, Match, PlayerAction } from "./types";

const card = (id: string, color: Card["color"], value: Card["value"]): Card => ({ id, color, value });

function controlledMatch(playerCount: 2 | 3 | 4 = 2): Match {
  const match = createMatch(createLocalPlayers(playerCount), 17);
  match.hands = Object.fromEntries(match.players.map((player, index) => [player.id, [card(`spare-${index}`, "gold", "9")]]));
  match.drawPile = [card("draw-a", "azure", "1"), card("draw-b", "emerald", "2"), card("draw-c", "gold", "3"), card("draw-d", "crimson", "4"), card("draw-e", "azure", "5")];
  match.discardPile = [card("top", "crimson", "5")];
  match.activeColor = "crimson";
  match.turn = { currentPlayerIndex: 0, direction: 1, drawnCardId: null, pendingWild: null };
  match.version = 0;
  match.events = [];
  return match;
}

type WithoutEnvelope<T> = T extends PlayerAction ? Omit<T, "actionId" | "expectedVersion"> : never;
type ActionInput = WithoutEnvelope<PlayerAction>;

function action(match: Match, value: ActionInput, id = "action-1"): PlayerAction {
  return { ...value, actionId: id, expectedVersion: match.version } as PlayerAction;
}

function accepted(match: Match, nextAction: PlayerAction): Match {
  const result = applyAction(match, nextAction);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result.match;
}

describe("deck creation and setup", () => {
  it("creates the complete 108-card deck", () => {
    const deck = createDeck();
    expect(deck).toHaveLength(108);
    expect(new Set(deck.map((item) => item.id)).size).toBe(108);
    expect(deck.filter((item) => item.value === "wild")).toHaveLength(4);
    expect(deck.filter((item) => item.value === "wild-draw-four")).toHaveLength(4);
    expect(deck.filter((item) => item.color === "crimson")).toHaveLength(25);
  });

  it("shuffles deterministically with a seed", () => {
    const first = shuffleDeck(1234).deck.map((item) => item.id);
    const second = shuffleDeck(1234).deck.map((item) => item.id);
    expect(first).toEqual(second);
    expect(first).not.toEqual(shuffleDeck(1235).deck.map((item) => item.id));
  });

  it("deals seven cards and exposes a numeric first discard", () => {
    const match = createMatch(createLocalPlayers(2), 8);
    expect(match.hands["player-1"]).toHaveLength(7);
    expect(match.hands["player-2"]).toHaveLength(7);
    expect(match.drawPile.length + match.discardPile.length + 14).toBe(108);
    expect(match.discardPile[0]!.color).not.toBeNull();
    expect(match.discardPile[0]!.value).toMatch(/^\d$/);
  });
});

describe("valid play rules", () => {
  const top = card("top", "crimson", "7");

  it("accepts a number match", () => expect(isPlayable(card("c", "azure", "7"), top, "crimson")).toBe(true));
  it("accepts a color match", () => expect(isPlayable(card("c", "crimson", "2"), top, "crimson")).toBe(true));
  it("accepts an action-type match", () => expect(isPlayable(card("c", "azure", "skip"), card("t", "crimson", "skip"), "crimson")).toBe(true));
  it("accepts wild cards", () => expect(isPlayable(card("c", null, "wild"), top, "crimson")).toBe(true));
  it("rejects a card with no match", () => expect(isPlayable(card("c", "azure", "3"), top, "crimson")).toBe(false));
});

describe("turn and action effects", () => {
  it("skips the next player", () => {
    const match = controlledMatch();
    match.hands["player-1"] = [card("skip", "crimson", "skip"), card("safe", "gold", "9")];
    const next = accepted(match, action(match, { type: "PLAY_CARD", playerId: "player-1", cardId: "skip" }));
    expect(next.turn.currentPlayerIndex).toBe(0);
  });

  it("treats reverse as skip for two players", () => {
    const match = controlledMatch();
    match.hands["player-1"] = [card("reverse", "crimson", "reverse"), card("safe", "gold", "9")];
    const next = accepted(match, action(match, { type: "PLAY_CARD", playerId: "player-1", cardId: "reverse" }));
    expect(next.turn.currentPlayerIndex).toBe(0);
    expect(next.turn.direction).toBe(1);
  });

  it("reverses direction with three or more players", () => {
    const match = controlledMatch(3);
    match.hands["player-1"] = [card("reverse", "crimson", "reverse"), card("safe", "gold", "9")];
    const next = accepted(match, action(match, { type: "PLAY_CARD", playerId: "player-1", cardId: "reverse" }));
    expect(next.turn.direction).toBe(-1);
    expect(next.turn.currentPlayerIndex).toBe(2);
  });

  it("applies Draw Two and skips the penalized player", () => {
    const match = controlledMatch();
    match.hands["player-1"] = [card("draw-two", "crimson", "draw-two"), card("safe", "gold", "9")];
    const before = match.hands["player-2"]!.length;
    const next = accepted(match, action(match, { type: "PLAY_CARD", playerId: "player-1", cardId: "draw-two" }));
    expect(next.hands["player-2"]).toHaveLength(before + 2);
    expect(next.turn.currentPlayerIndex).toBe(0);
    expect(next.lastPenalty).toMatchObject({ playerId: "player-2", amount: 2 });
  });

  it("waits for a color choice after Wild", () => {
    const match = controlledMatch();
    match.hands["player-1"] = [card("wild", null, "wild"), card("safe", "gold", "9")];
    const pending = accepted(match, action(match, { type: "PLAY_CARD", playerId: "player-1", cardId: "wild" }));
    expect(pending.turn.pendingWild?.value).toBe("wild");
    const selected = accepted(pending, action(pending, { type: "SELECT_WILD_COLOR", playerId: "player-1", color: "azure" }, "color"));
    expect(selected.activeColor).toBe("azure");
    expect(selected.turn.currentPlayerIndex).toBe(1);
  });

  it("applies Wild Draw Four after color selection", () => {
    const match = controlledMatch();
    match.hands["player-1"] = [card("wild-four", null, "wild-draw-four"), card("safe", "gold", "9")];
    const before = match.hands["player-2"]!.length;
    const pending = accepted(match, action(match, { type: "PLAY_CARD", playerId: "player-1", cardId: "wild-four" }));
    const selected = accepted(pending, action(pending, { type: "SELECT_WILD_COLOR", playerId: "player-1", color: "emerald" }, "color"));
    expect(selected.hands["player-2"]).toHaveLength(before + 4);
    expect(selected.turn.currentPlayerIndex).toBe(0);
    expect(selected.lastPenalty).toMatchObject({ amount: 4, reason: "wild-draw-four" });
  });

  it("progresses in the active direction after a number card", () => {
    const match = controlledMatch(3);
    match.hands["player-1"] = [card("number", "crimson", "2"), card("safe", "gold", "9")];
    const next = accepted(match, action(match, { type: "PLAY_CARD", playerId: "player-1", cardId: "number" }));
    expect(next.turn.currentPlayerIndex).toBe(1);
  });
});

describe("drawing and pile recovery", () => {
  it("allows a playable drawn card to be played immediately", () => {
    const match = controlledMatch();
    match.drawPile = [card("drawn", "crimson", "1")];
    const drawn = accepted(match, action(match, { type: "DRAW_CARD", playerId: "player-1" }));
    expect(drawn.turn.drawnCardId).toBe("drawn");
    const played = accepted(drawn, action(drawn, { type: "PLAY_DRAWN_CARD", playerId: "player-1", cardId: "drawn" }, "play-drawn"));
    expect(played.discardPile.at(-1)?.id).toBe("drawn");
  });

  it("lets a player keep a playable drawn card", () => {
    const match = controlledMatch();
    match.drawPile = [card("drawn", "crimson", "1")];
    const drawn = accepted(match, action(match, { type: "DRAW_CARD", playerId: "player-1" }));
    const kept = accepted(drawn, action(drawn, { type: "KEEP_DRAWN_CARD", playerId: "player-1" }, "keep"));
    expect(kept.turn.currentPlayerIndex).toBe(1);
    expect(kept.hands["player-1"]?.some((item) => item.id === "drawn")).toBe(true);
  });

  it("ends the turn when the drawn card is not playable", () => {
    const match = controlledMatch();
    match.drawPile = [card("drawn", "azure", "1")];
    const next = accepted(match, action(match, { type: "DRAW_CARD", playerId: "player-1" }));
    expect(next.turn.drawnCardId).toBeNull();
    expect(next.turn.currentPlayerIndex).toBe(1);
  });

  it("reshuffles all but the top discard when the draw pile is empty", () => {
    const match = controlledMatch();
    match.drawPile = [];
    match.discardPile = [card("recycled", "azure", "1"), card("top", "crimson", "5")];
    const next = accepted(match, action(match, { type: "DRAW_CARD", playerId: "player-1" }));
    expect(next.hands["player-1"]?.some((item) => item.id === "recycled")).toBe(true);
    expect(next.discardPile.map((item) => item.id)).toEqual(["top"]);
  });
});

describe("winning and final-card callouts", () => {
  it("wins by playing the final card", () => {
    const match = controlledMatch();
    match.hands["player-1"] = [card("winner", "crimson", "2")];
    const next = accepted(match, action(match, { type: "PLAY_CARD", playerId: "player-1", cardId: "winner" }));
    expect(next.phase).toBe("won");
    expect(next.winnerId).toBe("player-1");
  });

  it("supports a declaration immediately before the second-to-last play", () => {
    const match = controlledMatch();
    match.hands["player-1"] = [card("play", "crimson", "2"), card("last", "gold", "9")];
    const declared = accepted(match, action(match, { type: "DECLARE_LAST_CARD", playerId: "player-1" }, "declare"));
    const next = accepted(declared, action(declared, { type: "PLAY_CARD", playerId: "player-1", cardId: "play" }, "play"));
    expect(next.hands["player-1"]).toHaveLength(1);
    expect(next.vulnerablePlayerId).toBeNull();
    expect(next.declaredPlayerId).toBe("player-1");
  });

  it("supports a declaration immediately after the second-to-last play", () => {
    const match = controlledMatch();
    match.hands["player-1"] = [card("play", "crimson", "2"), card("last", "gold", "9")];
    const exposed = accepted(match, action(match, { type: "PLAY_CARD", playerId: "player-1", cardId: "play" }, "play"));
    const declared = accepted(exposed, action(exposed, { type: "DECLARE_LAST_CARD", playerId: "player-1" }, "declare-after"));
    expect(declared.vulnerablePlayerId).toBeNull();
    expect(declared.declaredPlayerId).toBe("player-1");
  });

  it("allows a valid callout and draws the penalty cards", () => {
    const match = controlledMatch();
    match.hands["player-1"] = [card("play", "crimson", "2"), card("last", "gold", "9")];
    const exposed = accepted(match, action(match, { type: "PLAY_CARD", playerId: "player-1", cardId: "play" }, "play"));
    expect(exposed.vulnerablePlayerId).toBe("player-1");
    const called = accepted(exposed, action(exposed, { type: "CALL_OUT_PLAYER", playerId: "player-2", targetPlayerId: "player-1" }, "catch"));
    expect(called.hands["player-1"]).toHaveLength(3);
    expect(called.stats["player-2"]?.successfulCallouts).toBe(1);
  });

  it("rejects a false callout", () => {
    const match = controlledMatch();
    const result = applyAction(match, action(match, { type: "CALL_OUT_PLAYER", playerId: "player-2", targetPlayerId: "player-1" }, "false-catch"));
    expect(result.ok).toBe(false);
    expect(result.match).toBe(match);
  });
});

describe("action integrity", () => {
  it("rejects duplicate action IDs", () => {
    const match = controlledMatch();
    match.hands["player-1"] = [card("play", "crimson", "2"), card("safe", "gold", "9")];
    const firstAction = action(match, { type: "PLAY_CARD", playerId: "player-1", cardId: "play" }, "same-id");
    const next = accepted(match, firstAction);
    const duplicate = applyAction(next, { ...firstAction, expectedVersion: next.version });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.error).toMatch(/already processed/i);
  });

  it("rejects stale versions without changing state", () => {
    const match = controlledMatch();
    const stale = applyAction(match, { type: "DRAW_CARD", actionId: "stale", playerId: "player-1", expectedVersion: 99 });
    expect(stale.ok).toBe(false);
    expect(stale.match).toBe(match);
  });
});
