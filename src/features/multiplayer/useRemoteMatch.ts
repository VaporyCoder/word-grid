import { useCallback, useEffect, useRef, useState } from "react";
import { fetchRemoteMatch, subscribeToMatch } from "./matchService";
import type { RemoteMatch } from "./types";

export function useRemoteMatch(roomCode: string, roomId: string, enabled: boolean) {
  const [match, setMatch] = useState<RemoteMatch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const refreshInFlight = useRef(false);
  const refreshQueued = useRef(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    if (refreshInFlight.current) { refreshQueued.current = true; return; }
    refreshInFlight.current = true;
    try {
      do {
        refreshQueued.current = false;
        setMatch(await fetchRemoteMatch(roomCode));
        setError(null);
      } while (refreshQueued.current);
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : "The match couldn’t be restored."); }
    finally { refreshInFlight.current = false; setLoading(false); }
  }, [enabled, roomCode]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!match || !enabled) return;
    let disposed = false;
    let cleanup: (() => Promise<void>) | null = null;
    const ownParticipantId = match.participants.find((participant) => participant.playerId === match.ownPlayerId)?.id;
    if (!ownParticipantId) return;
    void subscribeToMatch(roomId, match.match.id, ownParticipantId, () => void refresh()).then((subscription) => {
      if (disposed) void subscription.dispose(); else cleanup = subscription.dispose;
    });
    return () => { disposed = true; if (cleanup) void cleanup(); };
  }, [enabled, match?.match.id, refresh, roomId]);

  return { match, error, loading, refresh };
}
