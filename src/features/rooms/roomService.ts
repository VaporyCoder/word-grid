import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { ensureAnonymousIdentity } from "../auth/anonymousIdentity";
import { roomCodeSchema } from "../../lib/validation/room";
import { getSupabaseClient } from "../../lib/supabase/client";
import { roomErrorMessage } from "./roomErrors";
import { roomLobbySchema, roomSessionSchema, type RoomLobby, type RoomSession } from "./types";
import { z } from "zod";

function requireClient(): SupabaseClient {
  const client = getSupabaseClient();
  if (!client) throw new Error("SUPABASE_NOT_CONFIGURED");
  return client;
}

async function callRoomRpc(functionName: string, parameters: Record<string, unknown>): Promise<unknown> {
  const client = requireClient();
  await ensureAnonymousIdentity(client);
  const { data, error } = await client.rpc(functionName, parameters);
  if (error) throw new Error(error.message);
  return data;
}

export async function createRemoteRoom(displayName: string, maxPlayers: 2 | 3 | 4 = 2): Promise<RoomSession> {
  try {
    const data = await callRoomRpc("create_room", { player_name: displayName, room_visibility: "private", player_limit: maxPlayers, final_card_phrase: "Last Card!" });
    return roomSessionSchema.parse(data);
  } catch (error) {
    throw new Error(roomErrorMessage(error));
  }
}

export async function joinRemoteRoom(roomCode: string, displayName: string): Promise<RoomSession> {
  try {
    const code = roomCodeSchema.parse(roomCode);
    const data = await callRoomRpc("join_room", { room_code: code, player_name: displayName });
    return roomSessionSchema.parse(data);
  } catch (error) {
    throw new Error(roomErrorMessage(error));
  }
}

export async function fetchRoomLobby(roomCode: string): Promise<RoomLobby> {
  try {
    const data = await callRoomRpc("get_room_lobby", { room_code: roomCodeSchema.parse(roomCode) });
    return roomLobbySchema.parse(data);
  } catch (error) {
    throw new Error(roomErrorMessage(error));
  }
}

export async function leaveRemoteRoom(roomCode: string): Promise<void> {
  try { await callRoomRpc("leave_room", { room_code: roomCode }); }
  catch (error) { throw new Error(roomErrorMessage(error)); }
}

export async function startRemoteRoom(roomCode: string): Promise<string> {
  try { return z.string().uuid().parse(await callRoomRpc("start_room", { room_code: roomCode })); }
  catch (error) { throw new Error(roomErrorMessage(error)); }
}

export async function returnRemoteRoomToLobby(roomCode: string): Promise<void> {
  try { await callRoomRpc("return_room_to_lobby", { room_code: roomCode }); }
  catch (error) { throw new Error(roomErrorMessage(error)); }
}

export async function updateConnectionStatus(roomCode: string, status: "connected" | "reconnecting" | "disconnected"): Promise<void> {
  try { await callRoomRpc("touch_room_presence", { room_code: roomCode, next_status: status }); }
  catch { /* Presence is best-effort; lobby data remains authoritative. */ }
}

type RoomSubscription = {
  channel: RealtimeChannel;
  dispose: () => Promise<void>;
};

export async function subscribeToRoom(
  lobby: RoomLobby,
  onLobbyChanged: () => void,
  onPresenceChanged: (connectedPlayerIds: Set<string>) => void,
  onConnectionChanged: (status: "connected" | "reconnecting" | "disconnected") => void,
): Promise<RoomSubscription> {
  const client = requireClient();
  await ensureAnonymousIdentity(client);
  await client.realtime.setAuth();
  const channel = client.channel(`room:${lobby.room.id}`, { config: { private: true, presence: { key: lobby.currentPlayerId } } });

  const syncPresence = () => {
    const connected = new Set<string>();
    for (const presences of Object.values(channel.presenceState())) {
      for (const presence of presences) {
        const payload = presence as unknown as Record<string, unknown>;
        const playerId = typeof payload.playerId === "string" ? payload.playerId : null;
        if (playerId) connected.add(playerId);
      }
    }
    onPresenceChanged(connected);
  };

  channel
    .on("presence", { event: "sync" }, syncPresence)
    .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `id=eq.${lobby.room.id}` }, onLobbyChanged)
    .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `room_id=eq.${lobby.room.id}` }, onLobbyChanged)
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        onConnectionChanged("connected");
        await updateConnectionStatus(lobby.room.code, "connected");
        await channel.track({ playerId: lobby.currentPlayerId, onlineAt: new Date().toISOString() });
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        onConnectionChanged("reconnecting");
      } else if (status === "CLOSED") {
        onConnectionChanged("disconnected");
      }
    });

  const heartbeat = window.setInterval(() => void updateConnectionStatus(lobby.room.code, "connected"), 30_000);

  return {
    channel,
    dispose: async () => {
      window.clearInterval(heartbeat);
      await updateConnectionStatus(lobby.room.code, "disconnected");
      await channel.untrack();
      await client.removeChannel(channel);
    },
  };
}
