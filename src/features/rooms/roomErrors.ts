const friendlyMessages: Record<string, string> = {
  AUTH_REQUIRED: "Your private player session expired. Refresh and try again.",
  INVALID_DISPLAY_NAME: "Choose a display name between 1 and 24 characters.",
  INVALID_PLAYER_LIMIT: "Rooms can have between two and four players.",
  INVALID_LAST_CARD_PHRASE: "The final-card phrase must be between 1 and 32 characters.",
  ROOM_NOT_FOUND: "We couldn’t find that room. Check the code and try again.",
  ROOM_EXPIRED: "That room has expired. Ask the host to create a new one.",
  ROOM_FULL: "That room is already full.",
  ROOM_ALREADY_STARTED: "That game has already started.",
  ROOM_NOT_ACTIVE: "This room has already returned to the lobby.",
  NOT_ROOM_MEMBER: "Enter your display name to join this room.",
  HOST_ONLY: "Only the host can manage this room.",
  NEED_TWO_PLAYERS: "Wait for at least one more connected player.",
  MATCH_NOT_FOUND: "The match hasn’t been created yet.",
  MATCH_ALREADY_ENDED: "This round has already ended.",
  MATCH_NOT_FINISHED: "Finish this round before starting another.",
  NOT_MATCH_PARTICIPANT: "Your player session is no longer part of this match.",
  INVALID_STARTING_PLAYER: "The next round couldn’t choose a starting player.",
  STALE_VERSION: "The table changed before that move arrived. Your game has been refreshed.",
  DUPLICATE_ACTION: "That move was already received.",
  NOT_YOUR_TURN: "It isn’t your turn yet.",
  WILD_COLOR_REQUIRED: "Choose the active color before continuing.",
  CARD_NOT_IN_HAND: "That card is no longer in your hand.",
  ILLEGAL_CARD_PLAY: "That card doesn’t match the active color, number, or action.",
  RESOLVE_DRAWN_CARD_FIRST: "Play or keep the card you just drew first.",
  ONLY_DRAWN_CARD_ALLOWED: "Only the card you just drew can be played now.",
  ALREADY_DREW_CARD: "You already drew a card this turn.",
  INVALID_LAST_CARD_DECLARATION: "You can call Last Card only just before or after reaching one card.",
  INVALID_CALLOUT: "There is no legal callout right now.",
};

export function roomErrorMessage(error: unknown): string {
  const source = error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String(error.message) : "";
  const key = Object.keys(friendlyMessages).find((candidate) => source.includes(candidate));
  return key ? friendlyMessages[key]! : "Something interrupted the room. Please try again.";
}
