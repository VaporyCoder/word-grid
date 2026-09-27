import { Bug, RotateCcw, ShieldAlert } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { GameCard } from "../components/cards/GameCard";
import { Button } from "../components/ui/Button";
import { applyAction, canCallOut, createLocalPlayers, createMatch, currentPlayer, isPlayable, type Card, type PlayerAction } from "../features/game";

const visualValue: Record<Card["value"], string> = {
  "0": "0", "1": "1", "2": "2", "3": "3", "4": "4", "5": "5", "6": "6", "7": "7", "8": "8", "9": "9",
  skip: "⊘", reverse: "↺", "draw-two": "+2", wild: "W", "wild-draw-four": "+4",
};

export function DevSandboxPage() {
  const [playerCount, setPlayerCount] = useState<2 | 3 | 4>(2);
  const [seed, setSeed] = useState(42);
  const [match, setMatch] = useState(() => createMatch(createLocalPlayers(2), 42));
  const [error, setError] = useState<string | null>(null);
  const actionCounter = useRef(0);
  const activePlayer = currentPlayer(match);
  const topDiscard = match.discardPile.at(-1)!;
  const playableIds = useMemo(() => new Set(match.hands[activePlayer.id]!.filter((item) => isPlayable(item, topDiscard, match.activeColor)).map((item) => item.id)), [activePlayer.id, match, topDiscard]);

  function dispatch(builder: (base: { actionId: string; expectedVersion: number }) => PlayerAction) {
    actionCounter.current += 1;
    const result = applyAction(match, builder({ actionId: `sandbox-${actionCounter.current}`, expectedVersion: match.version }));
    if (result.ok) { setMatch(result.match); setError(null); }
    else setError(result.error);
  }

  function restart(nextCount = playerCount) {
    setPlayerCount(nextCount);
    setMatch(createMatch(createLocalPlayers(nextCount), seed));
    setError(null);
  }

  const catchPlayer = match.players.find((player) => canCallOut(match, player.id));

  return (
    <section className="sandbox-page container">
      <header className="sandbox-header">
        <div><span className="eyebrow"><Bug size={14} /> Developer sandbox</span><h1>Rules laboratory</h1><p>Run a complete local match with deterministic cards and no network connection.</p></div>
        <div className="sandbox-controls"><label>Players<select value={playerCount} onChange={(event) => restart(Number(event.target.value) as 2 | 3 | 4)}><option value="2">2</option><option value="3">3</option><option value="4">4</option></select></label><label>Seed<input type="number" value={seed} onChange={(event) => setSeed(Number(event.target.value) || 1)} /></label><Button variant="secondary" onClick={() => restart()} icon={<RotateCcw size={16} />}>Reset</Button></div>
      </header>

      <div className="sandbox-status panel">
        <div><span>VERSION</span><strong>{match.version}</strong></div><div><span>TURN</span><strong>{match.phase === "won" ? "Round complete" : activePlayer.displayName}</strong></div><div><span>DIRECTION</span><strong>{match.turn.direction === 1 ? "Clockwise" : "Counterclockwise"}</strong></div><div><span>ACTIVE COLOR</span><strong className={`color-text color-text--${match.activeColor}`}>{match.activeColor}</strong></div>
      </div>

      <div className="sandbox-board">
        <aside className="panel sandbox-players">
          <span className="small-label">All private hands · dev view</span>
          {match.players.map((player, index) => <div className={`sandbox-player ${index === match.turn.currentPlayerIndex ? "is-current" : ""}`} key={player.id}><span className="player-avatar">{player.displayName[0]}</span><div><strong>{player.displayName}</strong><span>{match.hands[player.id]!.length} cards</span></div>{match.vulnerablePlayerId === player.id && <ShieldAlert size={18} />}</div>)}
          {catchPlayer && match.vulnerablePlayerId && <Button variant="secondary" onClick={() => dispatch((base) => ({ ...base, type: "CALL_OUT_PLAYER", playerId: catchPlayer.id, targetPlayerId: match.vulnerablePlayerId! }))}>Catch {match.players.find((player) => player.id === match.vulnerablePlayerId)?.displayName}</Button>}
        </aside>

        <div className="sandbox-table panel">
          {match.phase === "won" ? <div className="sandbox-winner"><span className="eyebrow">Round complete</span><h2>{match.players.find((player) => player.id === match.winnerId)?.displayName} wins!</h2><Button onClick={() => restart()}>Play again</Button></div> : <>
            <span className="sandbox-turn">{activePlayer.displayName}’s turn</span>
            <div className="sandbox-piles"><button className="pile-button" onClick={() => dispatch((base) => ({ ...base, type: "DRAW_CARD", playerId: activePlayer.id }))} disabled={Boolean(match.turn.drawnCardId || match.turn.pendingWild)}><div className="game-card game-card--back sandbox-card-back"><span className="card-back-mark">CW</span></div><span>Draw · {match.drawPile.length}</span></button><div className="discard-wrap"><GameCard suit={topDiscard.color ?? "wild"} value={visualValue[topDiscard.value]} /><span className="active-color">{match.activeColor} active</span></div></div>
            {match.turn.pendingWild && <div className="color-picker"><strong>Choose the active color</strong><div>{(["crimson", "gold", "emerald", "azure"] as const).map((color) => <button key={color} className={`color-choice color-choice--${color}`} onClick={() => dispatch((base) => ({ ...base, type: "SELECT_WILD_COLOR", playerId: activePlayer.id, color }))}>{color}</button>)}</div></div>}
          </>}
        </div>

        <aside className="panel sandbox-log"><span className="small-label">Game events</span><ol>{[...match.events].reverse().slice(0, 10).map((event) => <li key={event.id}><span>v{event.version}</span>{event.message}</li>)}</ol></aside>
      </div>

      {match.phase === "playing" && <section className="sandbox-hand-section">
        <div className="sandbox-hand-head"><div><strong>{activePlayer.displayName}’s hand</strong><span>{match.turn.drawnCardId ? "Play the drawn card or keep it" : "Playable cards are raised"}</span></div><div>{(match.hands[activePlayer.id]!.length === 2 || match.vulnerablePlayerId === activePlayer.id) && <Button variant="secondary" onClick={() => dispatch((base) => ({ ...base, type: "DECLARE_LAST_CARD", playerId: activePlayer.id }))}>Last Card!</Button>}{match.turn.drawnCardId && <Button variant="secondary" onClick={() => dispatch((base) => ({ ...base, type: "KEEP_DRAWN_CARD", playerId: activePlayer.id }))}>Keep drawn card</Button>}</div></div>
        {error && <p className="sandbox-error" role="alert">{error}</p>}
        <div className="sandbox-hand">{match.hands[activePlayer.id]!.map((item) => {
          const playable = playableIds.has(item.id) && (!match.turn.drawnCardId || match.turn.drawnCardId === item.id) && !match.turn.pendingWild;
          return <button key={item.id} className={`sandbox-hand-card ${playable ? "is-playable" : ""}`} disabled={!playable} onClick={() => dispatch((base) => match.turn.drawnCardId ? ({ ...base, type: "PLAY_DRAWN_CARD", playerId: activePlayer.id, cardId: item.id }) : ({ ...base, type: "PLAY_CARD", playerId: activePlayer.id, cardId: item.id }))}><GameCard suit={item.color ?? "wild"} value={visualValue[item.value]} /></button>;
        })}</div>
      </section>}
    </section>
  );
}
