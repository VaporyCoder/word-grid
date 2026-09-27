import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { ensureAnonymousIdentity } from "../auth/anonymousIdentity";
import { getSupabaseClient } from "../../lib/supabase/client";
import { roomErrorMessage } from "../rooms/roomErrors";
import { rematchRequestSchema, rematchStatusSchema, remoteMatchSchema, type RematchStatus, type RemoteActionType, type RemoteMatch } from "./types";

function requireClient(): SupabaseClient {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase isn’t configured.");
  return client;
}

export async function fetchRemoteMatch(roomCode: string): Promise<RemoteMatch> {
  const client = requireClient();
  await ensureAnonymousIdentity(client);
  const { data, error } = await client.rpc("get_active_match", { room_code: roomCode });
  if (error) throw new Error(roomErrorMessage(error));
  return remoteMatchSchema.parse(data);
}

export async function submitRemoteAction(match: RemoteMatch, actionType: RemoteActionType, payload: Record<string, unknown> = {}): Promise<number> {
  const client = requireClient();
  await ensureAnonymousIdentity(client);
  const { data, error } = await client.rpc("submit_game_action", {
    target_match_id: match.match.id,
    action_id: crypto.randomUUID(),
    expected_version: match.match.stateVersion,
    action_type: actionType,
    action_payload: payload,
  });
  if (error) throw new Error(roomErrorMessage(error));
  const result = data as unknown;
  if (!result || typeof result !== "object" || !("stateVersion" in result) || typeof result.stateVersion !== "number") throw new Error("The server returned an invalid action result.");
  return result.stateVersion;
}

export async function fetchRematchStatus(matchId: string): Promise<RematchStatus> {
  const client = requireClient();
  await ensureAnonymousIdentity(client);
  const { data, error } = await client.rpc("get_rematch_status", { target_match_id: matchId });
  if (error) throw new Error(roomErrorMessage(error));
  return rematchStatusSchema.parse(data);
}

export async function requestRemoteRematch(matchId: string): Promise<string> {
  const client = requireClient();
  await ensureAnonymousIdentity(client);
  const { data, error } = await client.rpc("request_rematch", { target_match_id: matchId });
  if (error) throw new Error(roomErrorMessage(error));
  return rematchRequestSchema.parse(data).matchId;
}

export async function subscribeToMatch(roomId: string, matchId: string, ownParticipantId: string, onChanged: () => void): Promise<{ channel: RealtimeChannel; dispose: () => Promise<void> }> {
  const client = requireClient();
  await ensureAnonymousIdentity(client);
  await client.realtime.setAuth();
  const channel = client.channel(`room:${roomId}`, { config: { private: true } });
  channel
    .on("postgres_changes", { event: "*", schema: "public", table: "public_match_state", filter: `match_id=eq.${matchId}` }, onChanged)
    .on("postgres_changes", { event: "*", schema: "public", table: "match_participants", filter: `match_id=eq.${matchId}` }, onChanged)
    .on("postgres_changes", { event: "*", schema: "public", table: "game_events", filter: `match_id=eq.${matchId}` }, onChanged)
    .on("postgres_changes", { event: "*", schema: "public", table: "rematch_votes", filter: `match_id=eq.${matchId}` }, onChanged)
    .on("postgres_changes", { event: "*", schema: "public", table: "private_player_hands", filter: `participant_id=eq.${ownParticipantId}` }, onChanged)
    .subscribe();
  return { channel, dispose: async () => { await client.removeChannel(channel); } };
}
