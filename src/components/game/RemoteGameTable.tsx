import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown, History, LoaderCircle, LogOut, Settings2, WifiOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { GameCard } from "../cards/GameCard";
import { Button } from "../ui/Button";
import { isPlayable } from "../../features/game";
import { playGameSound } from "../../features/settings/gameSounds";
import { fetchRematchStatus, requestRemoteRematch, submitRemoteAction } from "../../features/multiplayer/matchService";
import type { RematchStatus, RemoteActionType, RemoteCard, RemoteMatch } from "../../features/multiplayer/types";
import { useRemoteMatch } from "../../features/multiplayer/useRemoteMatch";
import { usePreferences } from "../../store/preferences";

const visualValue: Record<RemoteCard["value"], string> = {
  "0": "0", "1": "1", "2": "2", "3": "3", "4": "4", "5": "5", "6": "6", "7": "7", "8": "8", "9": "9",
  skip: "⊘", reverse: "↺", "draw-two": "+2", wild: "W", "wild-draw-four": "+4",
};
const spokenValue: Record<RemoteCard["value"], string> = { ...visualValue, skip: "skip", reverse: "reverse", "draw-two": "draw two", wild: "wild", "wild-draw-four": "wild draw four" };

type Props = { roomCode: string; roomId: string; isHost: boolean; onReturnLobby: () => void; onLeave: () => void };

export function RemoteGameTable({ roomCode, roomId, isHost, onReturnLobby, onLeave }: Props) {
  const { match, error: loadError, loading, refresh } = useRemoteMatch(roomCode, roomId, true);
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [rematch, setRematch] = useState<RematchStatus | null>(null);
  const lastVersion = useRef<number | null>(null);

  useEffect(() => {
    if (!match || match.match.phase !== "won") { setRematch(null); return; }
    void fetchRematchStatus(match.match.id).then(setRematch).catch(() => setRematch(null));
  }, [match]);

  useEffect(() => {
    if (!match) return;
    if (lastVersion.current !== null && match.match.stateVersion > lastVersion.current) {
      if (match.match.phase === "won") playGameSound("victory");
      else if (match.publicState.currentPlayerId === match.ownPlayerId) playGameSound("turn");
    }
    lastVersion.current = match.match.stateVersion;
  }, [match]);

  async function act(actionType: RemoteActionType, payload: Record<string, unknown> = {}) {
    if (!match || busy) return;
    setBusy(true); setActionError("");
    try {
      await submitRemoteAction(match, actionType, payload);
      playGameSound(actionType.includes("PLAY") ? "play" : actionType.includes("DRAW") ? "draw" : actionType.includes("DECLARE") || actionType.includes("CALL") ? "declare" : "action");
      await refresh();
    } catch (nextError) {
      playGameSound("invalid");
      setActionError(nextError instanceof Error ? nextError.message : "That move couldn’t be completed.");
      await refresh();
    } finally { setBusy(false); }
  }

  async function voteRematch() {
    if (!match || busy) return;
    setBusy(true); setActionError("");
    try {
      const nextMatchId = await requestRemoteRematch(match.match.id);
      const status = await fetchRematchStatus(match.match.id);
      setRematch(status);
      if (nextMatchId !== match.match.id || status.nextMatchId) await refresh();
    } catch (nextError) { setActionError(nextError instanceof Error ? nextError.message : "Your rematch vote couldn’t be saved."); }
    finally { setBusy(false); }
  }

  if (loading) return <MatchState icon={<LoaderCircle className="spin" />} eyebrow="Reconnecting" title="Restoring your private hand…" />;
  if (!match) return <MatchState icon={<WifiOff />} eyebrow="Match unavailable" title="We couldn’t restore the table." message={loadError || "Try refreshing the page."} />;
  return <MatchBoard match={match} busy={busy} error={actionError} logOpen={logOpen} rematch={rematch} isHost={isHost} onReturnLobby={onReturnLobby} onRematch={() => void voteRematch()} onToggleLog={() => setLogOpen((value) => !value)} onAction={(type, payload) => void act(type, payload)} roomCode={roomCode} onLeave={onLeave} />;
}

function MatchBoard({ match, busy, error, logOpen, rematch, isHost, onReturnLobby, onRematch, onToggleLog, onAction, roomCode, onLeave }: {
  match: RemoteMatch; busy: boolean; error: string; logOpen: boolean; rematch: RematchStatus | null; isHost: boolean;
  onReturnLobby: () => void; onRematch: () => void; onToggleLog: () => void;
  onAction: (type: RemoteActionType, payload?: Record<string, unknown>) => void; roomCode: string; onLeave: () => void;
}) {
  const { confirmPlay, showEventLog, reducedMotion, animationLevel } = usePreferences();
  const systemReduced = useReducedMotion();
  const noMotion = systemReduced || reducedMotion || animationLevel === "off";
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  useEffect(() => setSelectedCardId(null), [match.match.stateVersion]);
  const ownParticipant = match.participants.find((participant) => participant.playerId === match.ownPlayerId)!;
  const opponents = match.participants.filter((participant) => participant.playerId !== match.ownPlayerId);
  const winner = match.participants.find((participant) => participant.playerId === match.publicState.turnState.winnerId);
  const isOwnTurn = match.publicState.currentPlayerId === match.ownPlayerId;
  const pendingWild = match.publicState.turnState.pendingWildPlayerId === match.ownPlayerId;
  const vulnerable = match.publicState.turnState.vulnerablePlayerId;
  const currentName = match.participants.find((participant) => participant.playerId === match.publicState.currentPlayerId)?.displayName ?? "Another player";
  const playableIds = useMemo(() => new Set(match.ownHand.filter((card) => isPlayable(card, match.publicState.discardTop, match.publicState.activeColor)).map((card) => card.id)), [match]);
  const selectedCard = match.ownHand.find((card) => card.id === selectedCardId);
  const voted = rematch?.votedPlayerIds.includes(match.ownPlayerId) ?? false;
  const duration = match.match.endedAt ? Math.max(1, Math.round((new Date(match.match.endedAt).getTime() - new Date(match.match.startedAt).getTime()) / 60000)) : 0;
  const announcement = match.events.at(-1)?.payload.message ?? (isOwnTurn ? "It is your turn." : `Waiting for ${currentName}.`);

  function canPlay(card: RemoteCard): boolean {
    if (!isOwnTurn || busy || pendingWild || match.match.phase !== "playing" || !playableIds.has(card.id)) return false;
    return match.ownDrawnCardId ? match.ownDrawnCardId === card.id : !match.publicState.turnState.drawnCardPending;
  }
  function play(card: RemoteCard) {
    if (confirmPlay) { setSelectedCardId(card.id); return; }
    onAction(match.ownDrawnCardId ? "PLAY_DRAWN_CARD" : "PLAY_CARD", { cardId: card.id });
  }
  function confirmSelected() {
    if (!selectedCard) return;
    onAction(match.ownDrawnCardId ? "PLAY_DRAWN_CARD" : "PLAY_CARD", { cardId: selectedCard.id });
  }

  return <section className="remote-game">
    <p className="sr-only" aria-live="polite">{announcement}</p>
    <div className="remote-game__topbar"><div><span>ROOM {roomCode}</span><strong>{isOwnTurn ? "Your turn" : `${currentName}’s turn`}</strong></div><div>{showEventLog && <button className="icon-button" onClick={onToggleLog} aria-label="Toggle match history"><History size={17} /></button>}<Button variant="ghost" to="/settings" icon={<Settings2 size={17} />}>Settings</Button><Button variant="ghost" onClick={onLeave} icon={<LogOut size={17} />}>Leave</Button></div></div>
    <div className="remote-opponents">{opponents.map((opponent) => <div className={`remote-opponent ${match.publicState.currentPlayerId === opponent.playerId ? "is-current" : ""}`} key={opponent.id}><span className="player-avatar">{opponent.displayName[0]}</span><div><strong>{opponent.displayName}</strong><span>{opponent.handCount} cards</span></div><div className="opponent-card-stack" aria-hidden="true">{Array.from({ length: Math.min(opponent.handCount, 7) }, (_, index) => <span key={index} />)}</div></div>)}</div>
    <div className="remote-table-surface">
      <AnimatePresence mode="wait"><motion.div key={`${match.publicState.currentPlayerId}-${match.match.stateVersion}`} initial={noMotion ? false : { opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={noMotion ? undefined : { opacity: 0 }} className={`remote-turn-pill ${isOwnTurn ? "is-own" : ""}`}><span className="connection-dot" />{isOwnTurn ? `Your turn — match ${match.publicState.activeColor} or ${visualValue[match.publicState.discardTop.value]}` : "Waiting for the next move"}</motion.div></AnimatePresence>
      <div className="remote-piles"><button className="remote-draw-pile" aria-label={`Draw from a pile of ${match.publicState.drawPileCount} cards`} disabled={!isOwnTurn || busy || Boolean(match.ownDrawnCardId) || pendingWild || match.match.phase !== "playing"} onClick={() => onAction("DRAW_CARD")}><div className="game-card game-card--back"><span className="card-back-mark">CW</span></div><span>Draw · {match.publicState.drawPileCount}</span></button><div className="discard-wrap"><GameCard suit={match.publicState.discardTop.color ?? "wild"} value={visualValue[match.publicState.discardTop.value]} /><span className={`active-color color-text--${match.publicState.activeColor}`}>{match.publicState.activeColor} active</span></div></div>
      {pendingWild && <div className="remote-color-picker"><strong>Choose the next color</strong><div>{(["crimson", "gold", "emerald", "azure"] as const).map((color) => <button key={color} className={`color-choice color-choice--${color}`} onClick={() => onAction("SELECT_WILD_COLOR", { color })} aria-label={`Choose ${color}`} />)}</div></div>}
      <AnimatePresence>{winner && <motion.div className="remote-victory" initial={noMotion ? false : { opacity: 0, scale: .96 }} animate={{ opacity: 1, scale: 1 }}><span className="eyebrow">Round complete · {duration} min</span><h2>{winner.displayName} wins!</h2><div className="victory-stats"><Stat label="Cards played" value={winner.stats.cardsPlayed ?? 0} /><Stat label="Cards drawn" value={winner.stats.cardsDrawn ?? 0} /><Stat label="Action + wild" value={(winner.stats.actionCardsUsed ?? 0) + (winner.stats.wildCardsUsed ?? 0)} /><Stat label="Callouts" value={winner.stats.successfulCallouts ?? 0} /></div><div className="victory-actions"><Button disabled={busy || voted} onClick={onRematch}>{voted ? `Waiting · ${rematch?.votedPlayerIds.length ?? 1}/${rematch?.requiredVotes ?? match.participants.length}` : "Play again"}</Button>{isHost && <Button variant="secondary" disabled={busy} onClick={onReturnLobby}>Return to lobby</Button>}<Button variant="ghost" onClick={onLeave}>Leave room</Button></div></motion.div>}</AnimatePresence>
    </div>
    <div className="remote-player-zone"><div className="remote-player-head"><div><strong>{ownParticipant.displayName}</strong><span>Your private hand · {match.ownHand.length} cards · state v{match.match.stateVersion}</span></div><div>{selectedCard && <Button variant="secondary" disabled={busy} onClick={confirmSelected}>Play selected</Button>}{((match.ownHand.length === 2 && isOwnTurn) || vulnerable === match.ownPlayerId) && <Button variant="secondary" disabled={busy} onClick={() => onAction("DECLARE_LAST_CARD")}>Last Card!</Button>}{vulnerable && vulnerable !== match.ownPlayerId && <Button variant="secondary" disabled={busy} onClick={() => onAction("CALL_OUT_PLAYER", { targetPlayerId: vulnerable })}>Catch Them</Button>}{match.ownDrawnCardId && <Button variant="secondary" disabled={busy} onClick={() => onAction("KEEP_DRAWN_CARD")}>Keep drawn card</Button>}</div></div>
      {error && <motion.p key={error} initial={noMotion ? false : { x: -7 }} animate={noMotion ? undefined : { x: [0, 7, -5, 0] }} className="remote-action-error" role="alert">{error}</motion.p>}
      <div className="remote-hand">{match.ownHand.map((card) => { const playable = canPlay(card); const selected = selectedCardId === card.id; const label = `${card.color ?? "wild"} ${spokenValue[card.value]} card${playable ? ", playable" : ", not playable"}${selected ? ", selected" : ""}`; return <motion.button layout={!noMotion} key={card.id} className={`remote-hand-card ${playable ? "is-playable" : ""} ${match.ownDrawnCardId === card.id ? "is-drawn" : ""} ${selected ? "is-selected" : ""}`} disabled={!playable} onClick={() => play(card)} aria-label={label} aria-pressed={selected}><GameCard suit={card.color ?? "wild"} value={visualValue[card.value]} /></motion.button>; })}</div>
    </div>
    {showEventLog && <aside className={`remote-log ${logOpen ? "is-open" : ""}`}><button onClick={onToggleLog}><span><History size={15} /> Match history</span><ChevronDown size={16} /></button><ol>{[...match.events].reverse().map((event) => <li key={event.id}><span>v{event.stateVersion}</span>{event.payload.message}</li>)}</ol></aside>}
  </section>;
}

function Stat({ label, value }: { label: string; value: number }) { return <div><strong>{value}</strong><span>{label}</span></div>; }
function MatchState({ icon, eyebrow, title, message }: { icon: React.ReactNode; eyebrow: string; title: string; message?: string }) { return <section className="room-state container">{icon}<span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{message && <p>{message}</p>}</section>; }
