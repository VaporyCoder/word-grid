import { z } from "zod";

export const roomPlayerSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().min(1).max(24),
  seatNumber: z.number().int().min(1).max(4),
  connectionStatus: z.enum(["connected", "reconnecting", "disconnected", "left"]),
  lastSeenAt: z.string(),
  isHost: z.boolean(),
});

export const roomLobbySchema = z.object({
  room: z.object({
    id: z.string().uuid(),
    code: z.string().length(6),
    status: z.enum(["lobby", "active", "closed", "expired"]),
    visibility: z.enum(["private", "invite-only"]),
    hostPlayerId: z.string().uuid().nullable(),
    maxPlayers: z.number().int().min(2).max(4),
    stateVersion: z.number().int().nonnegative(),
    expiresAt: z.string(),
  }),
  settings: z.object({
    turnTimerEnabled: z.boolean(),
    turnTimerSeconds: z.number().int(),
    drawStacking: z.boolean(),
    drawUntilPlayable: z.boolean(),
    scoreLimit: z.number().int().nullable(),
    rounds: z.number().int(),
    lastCardPhrase: z.string(),
  }),
  players: z.array(roomPlayerSchema),
  currentPlayerId: z.string().uuid(),
});

export const roomSessionSchema = z.object({
  roomId: z.string().uuid(),
  roomCode: z.string().length(6),
  playerId: z.string().uuid(),
});

export type RoomLobby = z.infer<typeof roomLobbySchema>;
export type RoomPlayer = z.infer<typeof roomPlayerSchema>;
export type RoomSession = z.infer<typeof roomSessionSchema>;
export type PresenceStatus = "connected" | "reconnecting" | "disconnected";
