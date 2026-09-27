export const CARD_COLORS = ["crimson", "gold", "emerald", "azure"] as const;
export type CardColor = (typeof CARD_COLORS)[number];
export type ActiveColor = CardColor;

export const NUMBER_VALUES = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;
export const ACTION_VALUES = ["skip", "reverse", "draw-two"] as const;
export const WILD_VALUES = ["wild", "wild-draw-four"] as const;
export type NumberValue = (typeof NUMBER_VALUES)[number];
export type ActionValue = (typeof ACTION_VALUES)[number];
export type WildValue = (typeof WILD_VALUES)[number];
export type CardValue = NumberValue | ActionValue | WildValue;

export type Card = {
  id: string;
  color: CardColor | null;
  value: CardValue;
};

export type Player = {
  id: string;
  displayName: string;
  connected: boolean;
};

export type RoomSettings = {
  maxPlayers: 2 | 3 | 4;
  turnTimerEnabled: boolean;
  turnTimerSeconds: number;
  drawStacking: boolean;
  drawUntilPlayable: boolean;
  scoreLimit: number | null;
  rounds: number;
  lastCardPhrase: string;
};

export type Room = {
  id: string;
  code: string;
  hostPlayerId: string;
  players: Player[];
  settings: RoomSettings;
};

export type GamePhase = "playing" | "won";
export type TurnDirection = 1 | -1;

export type TurnState = {
  currentPlayerIndex: number;
  direction: TurnDirection;
  drawnCardId: string | null;
  pendingWild: {
    playerId: string;
    value: WildValue;
    winnerAfterChoice: boolean;
  } | null;
};

export type DrawPenalty = {
  playerId: string;
  amount: 2 | 4;
  reason: "draw-two" | "wild-draw-four" | "missed-last-card";
};

export type MatchStats = {
  cardsPlayed: number;
  cardsDrawn: number;
  actionCardsUsed: number;
  wildCardsUsed: number;
  successfulCallouts: number;
};

export type GameEventType =
  | "game-started"
  | "card-played"
  | "card-drawn"
  | "drawn-card-kept"
  | "color-selected"
  | "last-card-declared"
  | "player-called-out"
  | "round-won";

export type GameEvent = {
  id: string;
  version: number;
  type: GameEventType;
  playerId: string;
  message: string;
};

export type Match = {
  id: string;
  phase: GamePhase;
  players: Player[];
  hands: Record<string, Card[]>;
  drawPile: Card[];
  discardPile: Card[];
  activeColor: ActiveColor;
  turn: TurnState;
  winnerId: string | null;
  vulnerablePlayerId: string | null;
  declaredPlayerId: string | null;
  lastPenalty: DrawPenalty | null;
  processedActionIds: string[];
  version: number;
  randomSeed: number;
  events: GameEvent[];
  stats: Record<string, MatchStats>;
};

type ActionBase = { actionId: string; playerId: string; expectedVersion: number };

export type PlayerAction =
  | (ActionBase & { type: "PLAY_CARD"; cardId: string })
  | (ActionBase & { type: "DRAW_CARD" })
  | (ActionBase & { type: "PLAY_DRAWN_CARD"; cardId: string })
  | (ActionBase & { type: "KEEP_DRAWN_CARD" })
  | (ActionBase & { type: "SELECT_WILD_COLOR"; color: CardColor })
  | (ActionBase & { type: "DECLARE_LAST_CARD" })
  | (ActionBase & { type: "CALL_OUT_PLAYER"; targetPlayerId: string });

export type ActionResult =
  | { ok: true; match: Match }
  | { ok: false; match: Match; error: string };

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  maxPlayers: 2,
  turnTimerEnabled: false,
  turnTimerSeconds: 30,
  drawStacking: false,
  drawUntilPlayable: false,
  scoreLimit: null,
  rounds: 1,
  lastCardPhrase: "Last Card!",
};
