import { z } from "zod";
import { CARD_COLORS } from "../game/types";

export const remoteCardSchema = z.object({
  id: z.string().min(1),
  color: z.enum(CARD_COLORS).nullable(),
  value: z.enum(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "skip", "reverse", "draw-two", "wild", "wild-draw-four"]),
});

const penaltySchema = z.object({
  playerId: z.string().uuid(),
  amount: z.number().int(),
  reason: z.string(),
});

export const remoteMatchSchema = z.object({
  match: z.object({
    id: z.string().uuid(),
    phase: z.enum(["playing", "won", "abandoned"]),
    stateVersion: z.number().int().nonnegative(),
    startedAt: z.string(),
    endedAt: z.string().nullable(),
  }),
  publicState: z.object({
    currentPlayerId: z.string().uuid(),
    direction: z.union([z.literal(1), z.literal(-1)]),
    discardTop: remoteCardSchema,
    activeColor: z.enum(CARD_COLORS),
    drawPileCount: z.number().int().nonnegative(),
    turnState: z.object({
      drawnCardPending: z.boolean(),
      pendingWildPlayerId: z.string().uuid().nullable(),
      vulnerablePlayerId: z.string().uuid().nullable(),
      declaredPlayerId: z.string().uuid().nullable(),
      winnerId: z.string().uuid().nullable(),
      lastPenalty: penaltySchema.nullable(),
    }),
  }),
  participants: z.array(z.object({
    id: z.string().uuid(),
    playerId: z.string().uuid(),
    displayName: z.string(),
    turnPosition: z.number().int(),
    handCount: z.number().int().nonnegative(),
    score: z.number().int(),
    stats: z.record(z.string(), z.number()),
  })),
  ownPlayerId: z.string().uuid(),
  ownHand: z.array(remoteCardSchema),
  ownDrawnCardId: z.string().nullable(),
  events: z.array(z.object({
    id: z.number().int(),
    stateVersion: z.number().int(),
    type: z.string(),
    actorPlayerId: z.string().uuid().nullable(),
    payload: z.object({ message: z.string() }).passthrough(),
    createdAt: z.string(),
  })),
});

export type RemoteCard = z.infer<typeof remoteCardSchema>;
export type RemoteMatch = z.infer<typeof remoteMatchSchema>;
export const rematchStatusSchema = z.object({
  votedPlayerIds: z.array(z.string().uuid()),
  requiredVotes: z.number().int().nonnegative(),
  nextMatchId: z.string().uuid().nullable(),
});
export const rematchRequestSchema = z.object({
  votes: z.number().int().nonnegative(),
  required: z.number().int().nonnegative(),
  matchId: z.string().uuid(),
});
export type RematchStatus = z.infer<typeof rematchStatusSchema>;
export type RemoteActionType = "PLAY_CARD" | "DRAW_CARD" | "PLAY_DRAWN_CARD" | "KEEP_DRAWN_CARD" | "SELECT_WILD_COLOR" | "DECLARE_LAST_CARD" | "CALL_OUT_PLAYER";
