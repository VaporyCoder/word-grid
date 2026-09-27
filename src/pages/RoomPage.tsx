import { Check, Clock3, Copy, Link2, LoaderCircle, LogOut, Settings2, Sparkles, Users, WifiOff } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { CardBack, GameCard } from "../components/cards/GameCard";
import { Button } from "../components/ui/Button";
import { RemoteGameTable } from "../components/game/RemoteGameTable";
import { joinRemoteRoom, leaveRemoteRoom, returnRemoteRoomToLobby, startRemoteRoom } from "../features/rooms/roomService";
import type { PresenceStatus, RoomLobby, RoomPlayer } from "../features/rooms/types";
import { useRoomLobby } from "../features/rooms/useRoomLobby";
import { isSupabaseConfigured } from "../lib/supabase/client";
import { displayNameSchema } from "../lib/validation/room";

type RoomLocationState = { playerName?: string; isHost?: boolean; mode?: "remote" | "preview" } | null;

export function RoomPage() {
  const { roomCode = "WILD24" } = useParams();
  const state = useLocation().state as RoomLocationState;
  const configured = isSupabaseConfigured();
  const remoteEnabled = configured && state?.mode !== "preview";

  if (remoteEnabled) return <RemoteRoom roomCode={roomCode.toUpperCase()} />;
  if (!configured && state?.mode !== "preview") return <ConfigurationRequired />;
  return <PreviewRoom roomCode={roomCode.toUpperCase()} playerName={state?.playerName || "Jamie"} isHost={state?.isHost ?? true} />;
}

function RemoteRoom({ roomCode }: { roomCode: string }) {
  const navigate = useNavigate();
  const { lobby, error, loading, connection, connectedPlayerIds, refresh } = useRoomLobby(roomCode, true);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  if (loading) return <RoomLoading />;
  if (!lobby && error === "Enter your display name to join this room.") return <InvitationJoin roomCode={roomCode} onJoined={() => void refresh()} />;
  if (!lobby) return <RoomError message={error || "This room isn’t available."} />;

  async function leave() {
    setBusy(true);
    try { await leaveRemoteRoom(roomCode); navigate("/"); }
    catch (nextError) { setActionError(nextError instanceof Error ? nextError.message : "We couldn’t leave the room."); setBusy(false); }
  }

  async function start() {
    setBusy(true);
    setActionError("");
    try { await startRemoteRoom(roomCode); await refresh(); }
    catch (nextError) { setActionError(nextError instanceof Error ? nextError.message : "The game couldn’t start."); }
    finally { setBusy(false); }
  }

  async function returnToLobby() {
    setBusy(true);
    setActionError("");
    try { await returnRemoteRoomToLobby(roomCode); await refresh(); }
    catch (nextError) { setActionError(nextError instanceof Error ? nextError.message : "The lobby couldn’t be restored."); }
    finally { setBusy(false); }
  }

  if (lobby.room.status === "active") return <RemoteGameTable roomCode={roomCode} roomId={lobby.room.id} isHost={lobby.room.hostPlayerId === lobby.currentPlayerId} onReturnLobby={() => void returnToLobby()} onLeave={() => void leave()} />;

  const currentPlayer = lobby.players.find((player) => player.id === lobby.currentPlayerId)!;
  const isHost = lobby.room.hostPlayerId === lobby.currentPlayerId;
  const effectiveConnected = new Set(connectedPlayerIds);
  if (connection === "connected") effectiveConnected.add(lobby.currentPlayerId);
  const connectedCount = lobby.players.filter((player) => effectiveConnected.has(player.id)).length;

  return (
    <RoomFrame
      lobby={lobby}
      currentPlayer={currentPlayer}
      connection={connection}
      connectedPlayerIds={effectiveConnected}
      busy={busy}
      error={actionError}
      onLeave={() => void leave()}
      onStart={() => void start()}
      canStart={isHost && connectedCount >= 2}
    />
  );
}

function RoomFrame({ lobby, currentPlayer, connection, connectedPlayerIds, busy, error, onLeave, onStart, canStart }: {
  lobby: RoomLobby;
  currentPlayer: RoomPlayer;
  connection: PresenceStatus;
  connectedPlayerIds: Set<string>;
  busy: boolean;
  error: string;
  onLeave: () => void;
  onStart: () => void;
  canStart: boolean;
}) {
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  async function copy(kind: "code" | "link") {
    const value = kind === "code" ? lobby.room.code : `${window.location.origin}/room/${lobby.room.code}`;
    await navigator.clipboard?.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1400);
  }
  const slots = Array.from({ length: lobby.room.maxPlayers }, (_, index) => lobby.players.find((player) => player.seatNumber === index + 1) ?? null);
  const isHost = lobby.room.hostPlayerId === currentPlayer.id;

  return (
    <section className="room-page container">
      <div className="room-heading"><div><span className="eyebrow">Live private room</span><h1>Tonight’s table</h1><p>Share the code with your favorite rivals.</p></div><Button variant="ghost" onClick={onLeave} disabled={busy} icon={<LogOut size={17} />}>Leave room</Button></div>
      <div className="room-layout">
        <div className="panel invite-card">
          <span className="small-label">Room code</span><div className="room-code">{lobby.room.code}</div>
          <div className="invite-actions"><Button variant="secondary" onClick={() => void copy("code")} icon={copied === "code" ? <Check size={17} /> : <Copy size={17} />}>{copied === "code" ? "Copied" : "Copy code"}</Button><Button variant="secondary" onClick={() => void copy("link")} icon={copied === "link" ? <Check size={17} /> : <Link2 size={17} />}>{copied === "link" ? "Copied" : "Invite link"}</Button></div>
          <ConnectionBadge status={connection} />
        </div>
        <div className="panel players-card">
          <div className="panel-title"><div><span className="small-label">Players</span><h2>{canStart ? "The table is ready" : "Waiting for company"}</h2></div><Users size={20} /></div>
          {slots.map((player, index) => player ? <PlayerSlot key={player.id} name={player.displayName} label={player.id === currentPlayer.id ? player.isHost ? "You · Host" : "You" : player.isHost ? "Host" : `Seat ${player.seatNumber}`} status={connectedPlayerIds.has(player.id) ? "connected" : player.connectionStatus === "reconnecting" ? "reconnecting" : "disconnected"} /> : <PlayerSlot key={index} name="Open seat" label="Waiting…" status="waiting" />)}
        </div>
        <div className="panel room-settings-card">
          <div className="panel-title"><div><span className="small-label">Room setup</span><h2>Classic night</h2></div><Settings2 size={20} /></div>
          <div className="room-setting"><span>Players</span><strong>Up to {lobby.room.maxPlayers}</strong></div><div className="room-setting"><span>Draw stacking</span><strong>{lobby.settings.drawStacking ? "On" : "Off"}</strong></div><div className="room-setting"><span>Final call</span><strong>“{lobby.settings.lastCardPhrase}”</strong></div><div className="room-setting"><span>Turn timer</span><strong>{lobby.settings.turnTimerEnabled ? `${lobby.settings.turnTimerSeconds}s` : "Relaxed"}</strong></div>
        </div>
      </div>
      {error && <p className="room-action-error" role="alert">{error}</p>}
      <div className="room-footer-action"><div className="waiting-copy"><Clock3 size={17} /><span>{canStart ? "Everyone’s connected." : isHost ? "At least two connected players are needed." : "The host will start when everyone is ready."}</span></div><Button disabled={!canStart || busy} onClick={onStart} icon={busy ? <LoaderCircle className="spin" size={18} /> : <Sparkles size={18} />}>{busy ? "Starting…" : "Start the game"}</Button></div>
    </section>
  );
}

function InvitationJoin({ roomCode, onJoined }: { roomCode: string; onJoined: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = displayNameSchema.safeParse(name);
    if (!parsed.success) { setError("Choose a display name between 1 and 24 characters."); return; }
    setBusy(true);
    try { await joinRemoteRoom(roomCode, parsed.data); onJoined(); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : "We couldn’t join the room."); }
    finally { setBusy(false); }
  }
  return <section className="flow-page container invitation-gate"><div className="page-intro"><span className="eyebrow">You’ve been invited</span><h1>Join room {roomCode}.</h1><p>Choose the name your friends will see at the table.</p></div><form className="panel form-panel" onSubmit={submit}><label htmlFor="invite-name">Your display name</label><input id="invite-name" autoFocus maxLength={24} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Sam" />{error && <p className="form-error" role="alert">{error}</p>}<Button type="submit" disabled={busy}>{busy ? "Finding your seat…" : "Join this room"}</Button></form></section>;
}

function ConnectionBadge({ status }: { status: PresenceStatus }) {
  return <div className={`connection-badge connection-badge--${status}`}>{status === "disconnected" && <WifiOff size={13} />}<span className="connection-dot" />{status === "connected" ? "Connected" : status === "reconnecting" ? "Reconnecting…" : "Disconnected"}</div>;
}

function PlayerSlot({ name, label, status }: { name: string; label: string; status: PresenceStatus | "waiting" }) {
  const connected = status === "connected";
  return <div className={`player-slot ${connected ? "player-slot--connected" : ""}`}><span className="player-avatar">{status === "waiting" ? "+" : name.charAt(0).toUpperCase()}</span><div><strong>{name}</strong><span>{label}{status === "reconnecting" ? " · Reconnecting" : status === "disconnected" ? " · Disconnected" : ""}</span></div><span className={`connection-dot connection-dot--${status}`} aria-label={status} /></div>;
}

function RoomLoading() {
  return <section className="room-state container"><LoaderCircle className="spin" size={30} /><span className="eyebrow">Restoring your room</span><h1>Pulling up your seat…</h1></section>;
}

function RoomError({ message }: { message: string }) {
  return <section className="room-state container"><WifiOff size={30} /><span className="eyebrow">Room unavailable</span><h1>We couldn’t reach this table.</h1><p>{message}</p><Button to="/join">Try another code</Button></section>;
}

function ConfigurationRequired() {
  return <section className="room-state container"><Settings2 size={30} /><span className="eyebrow">Setup needed</span><h1>Connect Supabase to join live rooms.</h1><p>The local rules sandbox is still available while the project environment is being configured.</p><Button to="/join">Return to join</Button></section>;
}

function PreviewRoom({ roomCode, playerName, isHost }: { roomCode: string; playerName: string; isHost: boolean }) {
  const [gameStarted, setGameStarted] = useState(false);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [guestJoined, setGuestJoined] = useState(false);
  async function copy(kind: "code" | "link") { const value = kind === "code" ? roomCode : `${window.location.origin}/room/${roomCode}`; await navigator.clipboard?.writeText(value); setCopied(kind); window.setTimeout(() => setCopied(null), 1400); }
  if (gameStarted) return <MockGameTable roomCode={roomCode} playerName={playerName} />;
  return <section className="room-page container"><div className="preview-banner">Local preview — this room is not synchronized</div><div className="room-heading"><div><span className="eyebrow">Preview room</span><h1>Tonight’s table</h1><p>Explore the lobby before connecting Supabase.</p></div><Button to="/" variant="ghost" icon={<LogOut size={17} />}>Leave room</Button></div><div className="room-layout"><div className="panel invite-card"><span className="small-label">Room code</span><div className="room-code">{roomCode}</div><div className="invite-actions"><Button variant="secondary" onClick={() => void copy("code")} icon={copied === "code" ? <Check size={17} /> : <Copy size={17} />}>{copied === "code" ? "Copied" : "Copy code"}</Button><Button variant="secondary" onClick={() => void copy("link")} icon={<Link2 size={17} />}>Invite link</Button></div></div><div className="panel players-card"><div className="panel-title"><div><span className="small-label">Players</span><h2>{guestJoined ? "The table is ready" : "Waiting for company"}</h2></div><Users size={20} /></div><PlayerSlot name={playerName} label={isHost ? "You · Host" : "You"} status="connected" /><PlayerSlot name={guestJoined ? "Alex" : "Open seat"} label={guestJoined ? "Guest" : "Waiting…"} status={guestJoined ? "connected" : "waiting"} />{!guestJoined && <button className="demo-link" onClick={() => setGuestJoined(true)}>Preview a player joining</button>}</div><div className="panel room-settings-card"><div className="panel-title"><div><span className="small-label">Room setup</span><h2>Classic night</h2></div><Settings2 size={20} /></div><div className="room-setting"><span>Players</span><strong>2</strong></div><div className="room-setting"><span>Draw stacking</span><strong>Off</strong></div><div className="room-setting"><span>Final call</span><strong>“Last Card!”</strong></div><div className="room-setting"><span>Turn timer</span><strong>Relaxed</strong></div></div></div><div className="room-footer-action"><div className="waiting-copy"><Clock3 size={17} /><span>{guestJoined ? "Everyone’s here." : "Preview another player joining to continue."}</span></div><Button disabled={!guestJoined || !isHost} onClick={() => setGameStarted(true)} icon={<Sparkles size={18} />}>Start preview</Button></div></section>;
}

function MockGameTable({ roomCode, playerName }: { roomCode: string; playerName: string }) {
  const hand = [["crimson", "7"], ["azure", "2"], ["gold", "✦"], ["emerald", "5"], ["wild", "W"]] as const;
  return <section className="game-room"><div className="preview-banner">Local preview — gameplay is not synchronized</div><div className="game-topbar"><div><span>ROOM {roomCode}</span><strong>Your turn</strong></div><Button variant="ghost" to="/settings" icon={<Settings2 size={17} />}>Settings</Button></div><div className="opponent"><span className="player-avatar">A</span><div><strong>Alex</strong><span>7 cards · Connected</span></div><div className="opponent-hand">{Array.from({ length: 5 }, (_, index) => <CardBack key={index} className={`mini-card mini-card--${index}`} />)}</div></div><div className="table-surface"><div className="turn-banner"><span className="connection-dot" /> Your turn — match crimson or 7</div><div className="piles"><button className="pile-button" aria-label="Draw a card"><CardBack /><span>Draw</span></button><div className="discard-wrap"><GameCard suit="crimson" value="7" /><span className="active-color">CRIMSON ACTIVE</span></div></div><div className="game-message">Alex played a crimson 7</div></div><div className="player-zone"><div className="player-zone__head"><div><strong>{playerName}</strong><span>Your hand · 5 cards</span></div><Button variant="secondary">Last Card!</Button></div><div className="player-hand">{hand.map(([suit, value], index) => <button className="hand-card" key={`${suit}-${value}`}><GameCard suit={suit} value={value} className={index === 0 ? "is-playable" : ""} /></button>)}</div></div></section>;
}
