import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { rematchRequestSchema, rematchStatusSchema, remoteMatchSchema } from "./types";

const roomId = "11111111-1111-4111-8111-111111111111";
const matchId = "22222222-2222-4222-8222-222222222222";
const ownPlayerId = "33333333-3333-4333-8333-333333333333";
const opponentId = "44444444-4444-4444-8444-444444444444";
const ownParticipantId = "55555555-5555-4555-8555-555555555555";
const opponentParticipantId = "66666666-6666-4666-8666-666666666666";

describe("private/public match snapshots", () => {
  it("validates a reconnectable match snapshot with only the caller hand", () => {
    const parsed = remoteMatchSchema.parse({
      match: { id: matchId, phase: "playing", stateVersion: 4, startedAt: new Date().toISOString(), endedAt: null },
      publicState: {
        currentPlayerId: ownPlayerId,
        direction: 1,
        discardTop: { id: "crimson-7-1", color: "crimson", value: "7" },
        activeColor: "crimson",
        drawPileCount: 78,
        turnState: { drawnCardPending: true, pendingWildPlayerId: null, vulnerablePlayerId: null, declaredPlayerId: null, winnerId: null, lastPenalty: null },
      },
      participants: [
        { id: ownParticipantId, playerId: ownPlayerId, displayName: "Jamie", turnPosition: 1, handCount: 8, score: 0, stats: { cardsPlayed: 0 } },
        { id: opponentParticipantId, playerId: opponentId, displayName: "Alex", turnPosition: 2, handCount: 7, score: 0, stats: { cardsPlayed: 0 } },
      ],
      ownPlayerId,
      ownHand: [{ id: "azure-7-1", color: "azure", value: "7" }],
      ownDrawnCardId: "azure-7-1",
      events: [{ id: 1, stateVersion: 4, type: "card-drawn", actorPlayerId: ownPlayerId, payload: { message: "Jamie drew a card." }, createdAt: new Date().toISOString() }],
    });
    expect(parsed.ownHand[0]?.id).toBe("azure-7-1");
    expect(parsed.participants[1]).not.toHaveProperty("cards");
  });

  it("rejects a public snapshot containing an invalid card color", () => {
    const result = remoteMatchSchema.safeParse({
      match: { id: matchId, phase: "playing", stateVersion: 0, startedAt: "now", endedAt: null },
      publicState: { currentPlayerId: ownPlayerId, direction: 1, discardTop: { id: "bad", color: "purple", value: "7" }, activeColor: "crimson", drawPileCount: 1, turnState: {} },
      participants: [], ownPlayerId, ownHand: [], ownDrawnCardId: null, events: [], roomId,
    });
    expect(result.success).toBe(false);
  });
});

describe("Phase 4 authoritative migration", () => {
  const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260806190000_phase4_authoritative_gameplay.sql"), "utf8");

  it("keeps draw order and timing windows in an inaccessible internal table", () => {
    expect(migration).toContain("create table public.match_internal_state");
    expect(migration).toContain("alter table public.match_internal_state enable row level security");
    expect(migration).toContain("revoke all on public.match_internal_state from anon, authenticated");
  });

  it("locks and version-checks every authoritative action", () => {
    expect(migration).toContain("where id = target_match_id for update");
    expect(migration).toContain("target_match.state_version <> expected_version");
    expect(migration).toContain("DUPLICATE_ACTION");
    expect(migration).toContain("state_version = new_version");
  });

  it("supports every Phase 4 action through one transaction boundary", () => {
    for (const action of ["PLAY_CARD", "DRAW_CARD", "PLAY_DRAWN_CARD", "KEEP_DRAWN_CARD", "SELECT_WILD_COLOR", "DECLARE_LAST_CARD", "CALL_OUT_PLAYER"]) {
      expect(migration).toContain(`'${action}'`);
    }
    expect(migration).toContain("create function public.submit_game_action");
  });

  it("returns only the authenticated participant's cards", () => {
    expect(migration).toContain("'ownHand', (select cards from public.private_player_hands where participant_id = own_participant_id)");
    expect(migration).toContain("ps.auth_user_id = auth.uid()");
    expect(migration).not.toContain("'opponentHand'");
  });
});

describe("Phase 5 rematches and polish", () => {
  const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260806210000_phase5_polish_and_rematch.sql"), "utf8");

  it("validates rematch status and request responses", () => {
    expect(rematchStatusSchema.parse({ votedPlayerIds: [ownPlayerId], requiredVotes: 2, nextMatchId: null }).requiredVotes).toBe(2);
    expect(rematchRequestSchema.parse({ votes: 2, required: 2, matchId }).matchId).toBe(matchId);
  });

  it("creates at most one next match after unanimous votes", () => {
    expect(migration).toContain("previous_match_id uuid unique");
    expect(migration).toContain("primary key (match_id, player_id)");
    expect(migration).toContain("where id = target_match_id for update");
    expect(migration).toContain("status = 'active' for update");
    expect(migration).toContain("vote_count >= required_votes and required_votes >= 2");
  });

  it("rotates the starting seat and keeps deck setup server-side", () => {
    expect(migration).toContain("p.seat_number > previous_seat");
    expect(migration).toContain("public.build_game_deck()");
    expect(migration).toContain("order by gen_random_uuid()");
    expect(migration).toContain("public.create_match_for_room(target_match.room_id, next_start_player_id, target_match_id)");
  });

  it("limits rematch mutation to authenticated RPCs", () => {
    expect(migration).toContain("alter table public.rematch_votes enable row level security");
    expect(migration).toContain("revoke all on public.rematch_votes from anon, authenticated");
    expect(migration).toContain("grant execute on function public.request_rematch(uuid) to authenticated");
  });
});
