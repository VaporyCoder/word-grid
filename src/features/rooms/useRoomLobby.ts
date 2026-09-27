import { useCallback, useEffect, useRef, useState } from "react";
import { fetchRoomLobby, subscribeToRoom } from "./roomService";
import type { PresenceStatus, RoomLobby } from "./types";

export function useRoomLobby(roomCode: string, enabled: boolean) {
  const [lobby, setLobby] = useState<RoomLobby | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [connection, setConnection] = useState<PresenceStatus>("reconnecting");
  const [connectedPlayerIds, setConnectedPlayerIds] = useState<Set<string>>(new Set());
  const refreshInFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (!enabled || refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      const nextLobby = await fetchRoomLobby(roomCode);
      setLobby(nextLobby);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "The room couldn’t be loaded.");
    } finally {
      refreshInFlight.current = false;
      setLoading(false);
    }
  }, [enabled, roomCode]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!lobby || !enabled) return;
    let disposed = false;
    let cleanup: (() => Promise<void>) | null = null;
    void subscribeToRoom(lobby, () => void refresh(), setConnectedPlayerIds, setConnection).then((subscription) => {
      if (disposed) void subscription.dispose();
      else cleanup = subscription.dispose;
    });
    return () => { disposed = true; if (cleanup) void cleanup(); };
  }, [enabled, lobby?.room.id, lobby?.currentPlayerId, refresh]);

  return { lobby, error, loading, connection, connectedPlayerIds, refresh };
}
