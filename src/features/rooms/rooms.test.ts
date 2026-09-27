import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { roomErrorMessage } from "./roomErrors";
import { roomLobbySchema, roomSessionSchema } from "./types";

const playerId = "11111111-1111-4111-8111-111111111111";
const roomId = "22222222-2222-4222-8222-222222222222";

describe("room response validation", () => {
  it("accepts a valid secure room session", () => {
    expect(roomSessionSchema.parse({ roomId, roomCode: "ABC234", playerId })).toEqual({ roomId, roomCode: "ABC234", playerId });
  });

  it("rejects malformed room sessions", () => {
    expect(roomSessionSchema.safeParse({ roomId: "not-a-uuid", roomCode: "O00111", playerId }).success).toBe(false);
  });

  it("validates the complete public lobby payload", () => {
    const result = roomLobbySchema.safeParse({
      room: { id: roomId, code: "ABC234", status: "lobby", visibility: "private", hostPlayerId: playerId, maxPlayers: 2, stateVersion: 1, expiresAt: new Date().toISOString() },
      settings: { turnTimerEnabled: false, turnTimerSeconds: 30, drawStacking: false, drawUntilPlayable: false, scoreLimit: null, rounds: 1, lastCardPhrase: "Last Card!" },
      players: [{ id: playerId, displayName: "Jamie", seatNumber: 1, connectionStatus: "connected", lastSeenAt: new Date().toISOString(), isHost: true }],
      currentPlayerId: playerId,
    });
    expect(result.success).toBe(true);
  });

  it("maps database errors to friendly room messages", () => {
    expect(roomErrorMessage(new Error("P0001: ROOM_FULL"))).toMatch(/already full/i);
    expect(roomErrorMessage(new Error("P0001: HOST_ONLY"))).toMatch(/only the host/i);
  });
});

describe("Phase 3 migration safeguards", () => {
  const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260806130000_phase3_rooms.sql"), "utf8");

  it("enables RLS and protects private hands by session ownership", () => {
    expect(migration).toContain("alter table public.private_player_hands enable row level security");
    expect(migration).toContain('create policy "players read only their own hand"');
    expect(migration).toContain("ps.auth_user_id = auth.uid()");
  });

  it("uses locked server functions for concurrent joins and starts", () => {
    expect(migration.match(/for update;/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration).toContain("state_version = state_version + 1");
    expect(migration).toContain("unique (auth_user_id, room_id)");
  });

  it("authorizes private Realtime topics by room membership", () => {
    expect(migration).toContain("realtime.topic()");
    expect(migration).toContain("public.is_room_member");
    expect(migration).toContain("extension in ('broadcast', 'presence')");
  });
});
