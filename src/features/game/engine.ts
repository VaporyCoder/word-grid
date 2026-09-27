import { shuffleDeck } from "./deck";
import { shuffleWithSeed } from "./random";
import { cardLabel, isActionCard, isPlayable, isWild } from "./rules";
import type { ActionResult, Card, CardColor, GameEventType, Match, MatchStats, Player, PlayerAction, WildValue } from "./types";

const INITIAL_HAND_SIZE = 7;
const MAX_PROCESSED_ACTIONS = 200;

function emptyStats(): MatchStats {
  return { cardsPlayed: 0, cardsDrawn: 0, actionCardsUsed: 0, wildCardsUsed: 0, successfulCallouts: 0 };
}

export function createLocalPlayers(count: 2 | 3 | 4): Player[] {
  const names = ["Jamie", "Alex", "Morgan", "Riley"];
  return names.slice(0, count).map((displayName, index) => ({ id: `player-${index + 1}`, displayName, connected: true }));
}

export function createMatch(players: Player[], seed = 42, matchId = "local-match"): Match {
  if (players.length < 2 || players.length > 4) throw new Error("A match requires two to four players.");
  if (new Set(players.map((player) => player.id)).size !== players.length) throw new Error("Player IDs must be unique.");

  const shuffled = shuffleDeck(seed);
  const deck = [...shuffled.deck];
  const hands: Record<string, Card[]> = Object.fromEntries(players.map((player) => [player.id, []]));
  for (let round = 0; round < INITIAL_HAND_SIZE; round += 1) {
    for (const player of players) hands[player.id]!.push(deck.pop()!);
  }

  const firstDiscardIndex = deck.findIndex((card) => card.color !== null && /^\d$/.test(card.value));
  const [firstDiscard] = deck.splice(firstDiscardIndex, 1);
  if (!firstDiscard?.color) throw new Error("Unable to choose the first discard.");

  return {
    id: matchId,
    phase: "playing",
    players: players.map((player) => ({ ...player })),
    hands,
    drawPile: deck,
    discardPile: [firstDiscard],
    activeColor: firstDiscard.color,
    turn: { currentPlayerIndex: 0, direction: 1, drawnCardId: null, pendingWild: null },
    winnerId: null,
    vulnerablePlayerId: null,
    declaredPlayerId: null,
    lastPenalty: null,
    processedActionIds: [],
    version: 0,
    randomSeed: shuffled.seed,
    events: [{ id: "event-0", version: 0, type: "game-started", playerId: players[0]!.id, message: "The round began." }],
    stats: Object.fromEntries(players.map((player) => [player.id, emptyStats()])),
  };
}

export function currentPlayer(match: Match): Player {
  return match.players[match.turn.currentPlayerIndex]!;
}

export function applyAction(match: Match, action: PlayerAction): ActionResult {
  const basicError = validateActionEnvelope(match, action);
  if (basicError) return { ok: false, match, error: basicError };

  const draft = cloneMatch(match);
  let error: string | null = null;
  switch (action.type) {
    case "PLAY_CARD":
      error = playFromHand(draft, action.playerId, action.cardId, false);
      break;
    case "DRAW_CARD":
      error = drawForTurn(draft, action.playerId);
      break;
    case "PLAY_DRAWN_CARD":
      error = playFromHand(draft, action.playerId, action.cardId, true);
      break;
    case "KEEP_DRAWN_CARD":
      error = keepDrawnCard(draft, action.playerId);
      break;
    case "SELECT_WILD_COLOR":
      error = selectWildColor(draft, action.playerId, action.color);
      break;
    case "DECLARE_LAST_CARD":
      error = declareLastCard(draft, action.playerId);
      break;
    case "CALL_OUT_PLAYER":
      error = callOutPlayer(draft, action.playerId, action.targetPlayerId);
      break;
  }
  if (error) return { ok: false, match, error };

  if (action.type !== "DECLARE_LAST_CARD" && action.type !== "CALL_OUT_PLAYER" && match.vulnerablePlayerId) {
    draft.vulnerablePlayerId = null;
  }
  if (action.type !== "DECLARE_LAST_CARD" && match.declaredPlayerId) {
    const declarationWasJustUsed =
      (action.type === "PLAY_CARD" || action.type === "PLAY_DRAWN_CARD") &&
      action.playerId === match.declaredPlayerId &&
      draft.hands[action.playerId]?.length === 1;
    if (!declarationWasJustUsed) draft.declaredPlayerId = null;
  }
  draft.version += 1;
  draft.processedActionIds = [...draft.processedActionIds, action.actionId].slice(-MAX_PROCESSED_ACTIONS);
  return { ok: true, match: draft };
}

function validateActionEnvelope(match: Match, action: PlayerAction): string | null {
  if (match.processedActionIds.includes(action.actionId)) return "This action was already processed.";
  if (action.expectedVersion !== match.version) return "The game changed. Refresh and try again.";
  if (!match.players.some((player) => player.id === action.playerId)) return "That player is not part of this match.";
  if (match.phase !== "playing") return "This round has already ended.";
  if (match.turn.pendingWild && action.type !== "SELECT_WILD_COLOR" && action.type !== "DECLARE_LAST_CARD" && action.type !== "CALL_OUT_PLAYER") {
    return "Choose the active color before continuing.";
  }
  return null;
}

function cloneMatch(match: Match): Match {
  return {
    ...match,
    players: match.players.map((player) => ({ ...player })),
    hands: Object.fromEntries(Object.entries(match.hands).map(([id, hand]) => [id, [...hand]])),
    drawPile: [...match.drawPile],
    discardPile: [...match.discardPile],
    turn: { ...match.turn, pendingWild: match.turn.pendingWild ? { ...match.turn.pendingWild } : null },
    processedActionIds: [...match.processedActionIds],
    events: [...match.events],
    stats: Object.fromEntries(Object.entries(match.stats).map(([id, stats]) => [id, { ...stats }])),
  };
}

function requireTurn(match: Match, playerId: string): string | null {
  return currentPlayer(match).id === playerId ? null : "It is not your turn.";
}

function playFromHand(match: Match, playerId: string, cardId: string, drawnOnly: boolean): string | null {
  const turnError = requireTurn(match, playerId);
  if (turnError) return turnError;
  if (drawnOnly) {
    if (!match.turn.drawnCardId) return "You have not drawn a playable card.";
    if (match.turn.drawnCardId !== cardId) return "Only the card you just drew can be played.";
  } else if (match.turn.drawnCardId) {
    return "Play or keep the card you just drew first.";
  }

  const hand = match.hands[playerId]!;
  const cardIndex = hand.findIndex((card) => card.id === cardId);
  if (cardIndex < 0) return "That card is not in your hand.";
  const card = hand[cardIndex]!;
  const topDiscard = match.discardPile.at(-1)!;
  if (!isPlayable(card, topDiscard, match.activeColor)) return "That card does not match the active color, number, or action.";

  hand.splice(cardIndex, 1);
  match.discardPile.push(card);
  match.turn.drawnCardId = null;
  match.stats[playerId]!.cardsPlayed += 1;
  if (isActionCard(card)) match.stats[playerId]!.actionCardsUsed += 1;
  if (isWild(card)) match.stats[playerId]!.wildCardsUsed += 1;
  addEvent(match, "card-played", playerId, `${displayName(match, playerId)} played ${cardLabel(card.value)}.`);

  const hasWon = hand.length === 0;
  if (hand.length === 1) {
    if (match.declaredPlayerId !== playerId) match.vulnerablePlayerId = playerId;
  } else {
    match.vulnerablePlayerId = null;
  }
  match.declaredPlayerId = hand.length === 1 && match.declaredPlayerId === playerId ? playerId : null;

  if (isWild(card)) {
    match.turn.pendingWild = { playerId, value: card.value as WildValue, winnerAfterChoice: hasWon };
    return null;
  }

  match.activeColor = card.color!;
  applyCardEffect(match, card, playerId);
  if (hasWon) finishRound(match, playerId);
  return null;
}

function drawForTurn(match: Match, playerId: string): string | null {
  const turnError = requireTurn(match, playerId);
  if (turnError) return turnError;
  if (match.turn.drawnCardId) return "You already drew a card this turn.";
  const cards = takeCards(match, playerId, 1);
  const drawn = cards[0];
  if (!drawn) return "There are no cards left to draw.";
  addEvent(match, "card-drawn", playerId, `${displayName(match, playerId)} drew a card.`);
  const topDiscard = match.discardPile.at(-1)!;
  if (isPlayable(drawn, topDiscard, match.activeColor)) match.turn.drawnCardId = drawn.id;
  else advanceTurn(match, 1);
  return null;
}

function keepDrawnCard(match: Match, playerId: string): string | null {
  const turnError = requireTurn(match, playerId);
  if (turnError) return turnError;
  if (!match.turn.drawnCardId) return "There is no drawn card to keep.";
  match.turn.drawnCardId = null;
  addEvent(match, "drawn-card-kept", playerId, `${displayName(match, playerId)} kept the drawn card.`);
  advanceTurn(match, 1);
  return null;
}

function selectWildColor(match: Match, playerId: string, color: CardColor): string | null {
  const pending = match.turn.pendingWild;
  if (!pending || pending.playerId !== playerId) return "You do not have a wild color to choose.";
  match.activeColor = color;
  match.turn.pendingWild = null;
  addEvent(match, "color-selected", playerId, `${displayName(match, playerId)} chose ${color}.`);
  if (pending.value === "wild-draw-four") {
    const penalizedIndex = nextIndex(match, 1);
    const penalizedId = match.players[penalizedIndex]!.id;
    takeCards(match, penalizedId, 4);
    match.lastPenalty = { playerId: penalizedId, amount: 4, reason: "wild-draw-four" };
    advanceTurn(match, 2);
  } else {
    advanceTurn(match, 1);
  }
  if (pending.winnerAfterChoice) finishRound(match, playerId);
  return null;
}

function declareLastCard(match: Match, playerId: string): string | null {
  const handSize = match.hands[playerId]!.length;
  const isPreDeclaration = currentPlayer(match).id === playerId && handSize === 2 && !match.turn.drawnCardId;
  const isImmediateDeclaration = match.vulnerablePlayerId === playerId && handSize === 1;
  if (!isPreDeclaration && !isImmediateDeclaration) return "You can declare only just before or after reaching one card.";
  match.declaredPlayerId = playerId;
  match.vulnerablePlayerId = null;
  addEvent(match, "last-card-declared", playerId, `${displayName(match, playerId)} called “Last Card!”`);
  return null;
}

function callOutPlayer(match: Match, playerId: string, targetPlayerId: string): string | null {
  if (playerId === targetPlayerId) return "You cannot call out yourself.";
  if (match.vulnerablePlayerId !== targetPlayerId || match.hands[targetPlayerId]?.length !== 1) return "There is no legal callout right now.";
  takeCards(match, targetPlayerId, 2);
  match.vulnerablePlayerId = null;
  match.declaredPlayerId = null;
  match.lastPenalty = { playerId: targetPlayerId, amount: 2, reason: "missed-last-card" };
  match.stats[playerId]!.successfulCallouts += 1;
  addEvent(match, "player-called-out", playerId, `${displayName(match, playerId)} caught ${displayName(match, targetPlayerId)}.`);
  return null;
}

function applyCardEffect(match: Match, card: Card, playerId: string): void {
  if (card.value === "skip") {
    advanceTurn(match, 2);
  } else if (card.value === "reverse") {
    if (match.players.length === 2) advanceTurn(match, 2);
    else {
      match.turn.direction = match.turn.direction === 1 ? -1 : 1;
      advanceTurn(match, 1);
    }
  } else if (card.value === "draw-two") {
    const penalizedIndex = nextIndex(match, 1);
    const penalizedId = match.players[penalizedIndex]!.id;
    takeCards(match, penalizedId, 2);
    match.lastPenalty = { playerId: penalizedId, amount: 2, reason: "draw-two" };
    advanceTurn(match, 2);
  } else {
    advanceTurn(match, 1);
  }
  void playerId;
}

function takeCards(match: Match, playerId: string, count: number): Card[] {
  const drawn: Card[] = [];
  for (let index = 0; index < count; index += 1) {
    if (match.drawPile.length === 0) reshuffleDiscard(match);
    const card = match.drawPile.pop();
    if (!card) break;
    match.hands[playerId]!.push(card);
    drawn.push(card);
  }
  match.stats[playerId]!.cardsDrawn += drawn.length;
  return drawn;
}

function reshuffleDiscard(match: Match): void {
  if (match.discardPile.length <= 1) return;
  const top = match.discardPile.at(-1)!;
  const shuffled = shuffleWithSeed(match.discardPile.slice(0, -1), match.randomSeed);
  match.drawPile = shuffled.items;
  match.randomSeed = shuffled.seed;
  match.discardPile = [top];
}

function nextIndex(match: Match, steps: number): number {
  const count = match.players.length;
  return ((match.turn.currentPlayerIndex + match.turn.direction * steps) % count + count) % count;
}

function advanceTurn(match: Match, steps: number): void {
  match.turn.currentPlayerIndex = nextIndex(match, steps);
  match.turn.drawnCardId = null;
}

function finishRound(match: Match, playerId: string): void {
  match.phase = "won";
  match.winnerId = playerId;
  match.vulnerablePlayerId = null;
  match.declaredPlayerId = null;
  addEvent(match, "round-won", playerId, `${displayName(match, playerId)} won the round.`);
}

function displayName(match: Match, playerId: string): string {
  return match.players.find((player) => player.id === playerId)?.displayName ?? "A player";
}

function addEvent(match: Match, type: GameEventType, playerId: string, message: string): void {
  match.events.push({ id: `event-${match.version + 1}-${match.events.length}`, version: match.version + 1, type, playerId, message });
}

export function canCallOut(match: Match, playerId: string): boolean {
  return match.vulnerablePlayerId !== null && match.vulnerablePlayerId !== playerId;
}

export function playableCardIds(match: Match, playerId: string): string[] {
  const top = match.discardPile.at(-1)!;
  return match.hands[playerId]!.filter((card) => isPlayable(card, top, match.activeColor)).map((card) => card.id);
}
