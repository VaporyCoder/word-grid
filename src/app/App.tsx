import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BarChart3, ChevronDown, Grid2X2, Info, RotateCcw, Sparkles, Trophy, Volume2, VolumeX, X } from "lucide-react";
import type { BoardSize, GameStats, GeneratedBoard } from "../game/types";
import { areAdjacent, validatePath } from "../game/solver";
import { scoreWord } from "../game/scoring";
import { getRemainingSeconds } from "../game/timer";
import { closestTileAtPoint, distanceSquared, firstTileCrossed, type Point, type TileGeometry } from "../game/inputPath";

type Screen = "menu" | "loading" | "countdown" | "playing" | "results";
type FoundWord = { word: string; score: number };

const EMPTY_STATS: GameStats = {
  gamesPlayed: 0,
  highestScore: 0,
  mostWords: 0,
  longestWord: "",
  highScores: { 4: 0, 5: 0, 6: 0 },
};

function readStats(): GameStats {
  try {
    const stored = localStorage.getItem("lexigrid-stats");
    return stored ? { ...EMPTY_STATS, ...JSON.parse(stored) as GameStats } : EMPTY_STATS;
  } catch {
    return EMPTY_STATS;
  }
}

function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function useSound(enabled: boolean) {
  const contextRef = useRef<AudioContext | null>(null);
  return useCallback((kind: "tick" | "go" | "valid" | "invalid" | "end") => {
    if (!enabled) return;
    const AudioContextClass = window.AudioContext;
    const context = contextRef.current ?? new AudioContextClass();
    contextRef.current = context;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const tones = { tick: 440, go: 660, valid: 740, invalid: 180, end: 260 };
    oscillator.frequency.value = tones[kind];
    oscillator.type = kind === "invalid" ? "sawtooth" : "sine";
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.075, context.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + (kind === "end" ? 0.4 : 0.13));
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + (kind === "end" ? 0.42 : 0.15));
  }, [enabled]);
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={`brand ${compact ? "brand--compact" : ""}`}><span className="brand-mark"><Sparkles size={16} /></span><span>LEXI<span>GRID</span></span></div>;
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button className="icon-button" aria-label={label} title={label} onClick={onClick}>{children}</button>;
}

function Menu({ size, onSize, onStart, sound, onSound, stats }: {
  size: BoardSize; onSize: (size: BoardSize) => void; onStart: () => void; sound: boolean; onSound: () => void; stats: GameStats;
}) {
  const preview = "PLAYWORDGAMESFAST".split("");
  return <main className="menu-screen">
    <header className="menu-header"><Brand /><IconButton label={sound ? "Mute sound" : "Turn sound on"} onClick={onSound}>{sound ? <Volume2 /> : <VolumeX />}</IconButton></header>
    <section className="menu-hero">
      <div className="menu-copy">
        <div className="eyebrow"><span /> Two-minute word game</div>
        <h1>Find the words.<br/><em>Follow the spark.</em></h1>
        <p>Trace through neighboring letters. Twist, turn, and uncover as many words as you can before time runs out.</p>
        <div className="size-label"><span>Choose your grid</span><span>2:00 per round</span></div>
        <div className="size-picker" role="radiogroup" aria-label="Board size">
          {([4, 5, 6] as BoardSize[]).map((option) => <button key={option} role="radio" aria-checked={size === option} className={size === option ? "is-active" : ""} onClick={() => onSize(option)}><strong>{option} × {option}</strong><small>{option === 4 ? "Classic" : option === 5 ? "Roomy" : "Epic"}</small></button>)}
        </div>
        <button className="primary-button" onClick={onStart}><span>Start game</span><span className="button-arrow">↗</span></button>
        <div className="menu-stats">
          <div><strong>{stats.gamesPlayed}</strong><span>Games played</span></div>
          <div><strong>{stats.highestScore.toLocaleString()}</strong><span>Best score</span></div>
          <div><strong>{stats.longestWord || "—"}</strong><span>Longest word</span></div>
        </div>
      </div>
      <div className="menu-art" aria-hidden="true">
        <div className="orbit orbit-one"/><div className="orbit orbit-two"/>
        <div className="preview-board">
          {preview.map((letter, index) => <span key={index} className={[1, 5, 9, 10, 14].includes(index) ? "is-lit" : ""}>{letter}</span>)}
          <svg viewBox="0 0 100 100"><polyline points="37.5,12.5 37.5,37.5 37.5,62.5 62.5,62.5 62.5,87.5" /></svg>
        </div>
        <div className="floating-chip chip-one"><span>+800</span><small>5 letters</small></div>
        <div className="floating-chip chip-two"><Sparkles size={14}/><span>Diagonal moves count</span></div>
      </div>
    </section>
    <footer><span>Trace adjacent tiles · No repeats · 3 letters minimum</span><span>Local play · No account needed</span></footer>
  </main>;
}

type HitDebug = { tiles: TileGeometry[]; pointer: Point; chosen: number | null };

function GameBoard({ board, selected, status, boardRef, debug, onStart, onMove, onEnd }: {
  board: GeneratedBoard; selected: number[]; status: "idle" | "valid" | "invalid";
  boardRef: React.RefObject<HTMLDivElement | null>; debug: HitDebug | null;
  onStart: (index: number, event: React.PointerEvent) => void; onMove: (event: React.PointerEvent) => void; onEnd: () => void;
}) {
  const selectedSet = new Set(selected);
  const [pathGeometry, setPathGeometry] = useState({ width: 1, height: 1, points: "" });

  useLayoutEffect(() => {
    const boardElement = boardRef.current;
    if (!boardElement) return;
    const measure = () => {
      const boardRect = boardElement.getBoundingClientRect();
      const overlayRect = boardElement.querySelector<SVGSVGElement>(".path-layer")?.getBoundingClientRect() ?? boardRect;
      const points = selected.map((index) => {
        const tile = boardElement.querySelector<HTMLElement>(`[data-tile="${index}"]`);
        if (!tile) return "";
        const rect = tile.getBoundingClientRect();
        return `${rect.left + rect.width / 2 - overlayRect.left},${rect.top + rect.height / 2 - overlayRect.top}`;
      }).filter(Boolean).join(" ");
      setPathGeometry({ width: overlayRect.width, height: overlayRect.height, points });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(boardElement);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [boardRef, selected]);

  return <>
    <div ref={boardRef} className={`letter-board board-${board.size} path-${status}`} style={{ "--size": board.size } as React.CSSProperties} onPointerMove={onMove} onPointerUp={onEnd} onPointerCancel={onEnd} onLostPointerCapture={onEnd}>
      <svg className="path-layer" viewBox={`0 0 ${pathGeometry.width} ${pathGeometry.height}`} preserveAspectRatio="none" aria-hidden="true"><polyline points={pathGeometry.points} vectorEffect="non-scaling-stroke"/></svg>
      {board.letters.map((letter, index) => <button key={index} data-tile={index} aria-label={`Letter ${letter}, row ${Math.floor(index / board.size) + 1}, column ${(index % board.size) + 1}`} className={`letter-tile ${selectedSet.has(index) ? "is-selected" : ""}`} onPointerDown={(event) => onStart(index, event)}><span>{letter}</span></button>)}
    </div>
    {debug && <div className="hit-debug" aria-hidden="true">
      {debug.tiles.map((tile) => <span key={tile.index} className={`hit-debug-zone ${debug.chosen === tile.index ? "is-chosen" : ""}`} style={{ left: tile.center.x - tile.radius, top: tile.center.y - tile.radius, width: tile.radius * 2, height: tile.radius * 2 }}><i/></span>)}
      <span className="hit-debug-pointer" style={{ left: debug.pointer.x, top: debug.pointer.y }}/>
    </div>}
  </>;
}

function Gameplay({ board, sound, onSound, onEnd, onMenu }: { board: GeneratedBoard; sound: boolean; onSound: () => void; onEnd: (words: FoundWord[]) => void; onMenu: () => void }) {
  const [remaining, setRemaining] = useState(120);
  const [selected, setSelected] = useState<number[]>([]);
  const [found, setFound] = useState<FoundWord[]>([]);
  const [feedback, setFeedback] = useState<{ text: string; kind: "valid" | "invalid"; points?: number } | null>(null);
  const [pathStatus, setPathStatus] = useState<"idle" | "valid" | "invalid">("idle");
  const startedAt = useRef(Date.now());
  const active = useRef(false);
  const foundRef = useRef<FoundWord[]>([]);
  const selectedRef = useRef<number[]>([]);
  const boardRef = useRef<HTMLDivElement>(null);
  const previousPointRef = useRef<Point | null>(null);
  const pendingCandidateRef = useRef<{ index: number; samples: number } | null>(null);
  const debugEnabled = useMemo(() => new URLSearchParams(window.location.search).get("debugHitAreas") === "1", []);
  const [hitDebug, setHitDebug] = useState<HitDebug | null>(null);
  const possible = useMemo(() => new Set(board.words), [board.words]);
  const playSound = useSound(sound);
  const score = found.reduce((sum, item) => sum + item.score, 0);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      const next = getRemainingSeconds(startedAt.current, Date.now());
      setRemaining(next);
      if (next <= 0) {
        playSound("end");
        onEnd(foundRef.current);
        return;
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [onEnd, playSound]);

  useEffect(() => { foundRef.current = found; }, [found]);
  useEffect(() => {
    if (remaining <= 10 && remaining > 0) playSound("tick");
  }, [remaining, playSound]);

  const currentWord = selected.map((index) => board.letters[index]).join("");

  const tileGeometries = () => {
    if (!boardRef.current) return [];
    return [...boardRef.current.querySelectorAll<HTMLElement>("[data-tile]")].map((tile) => {
      const rect = tile.getBoundingClientRect();
      return { index: Number(tile.dataset.tile), center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, radius: Math.min(rect.width, rect.height) * 0.4 };
    });
  };

  const eligibleGeometries = (tiles: TileGeometry[]) => {
    const path = selectedRef.current;
    const last = path[path.length - 1];
    if (last === undefined) return [];
    return tiles.filter((tile) => !path.includes(tile.index) && areAdjacent(last, tile.index, board.size));
  };

  const addTile = (index: number) => {
    const path = selectedRef.current;
    if (path.includes(index) || (path.length && !areAdjacent(path[path.length - 1]!, index, board.size))) return false;
    const next = [...path, index];
    selectedRef.current = next;
    setSelected(next);
    pendingCandidateRef.current = null;
    return true;
  };

  const processPoint = (point: Point) => {
    const allTiles = tileGeometries();
    let segmentStart = previousPointRef.current ?? point;
    let chosen: number | null = null;

    // A smaller swept radius is the hysteresis band: quick, intentional passes
    // register, while a line that only clips a tile's outer edge does not.
    for (let step = 0; step < 4; step += 1) {
      const eligible = eligibleGeometries(allTiles);
      const hit = firstTileCrossed(segmentStart, point, eligible, 0.85);
      if (!hit || !addTile(hit.tile.index)) break;
      chosen = hit.tile.index;
      const progress = Math.min(1, hit.t + 0.002);
      segmentStart = {
        x: segmentStart.x + (point.x - segmentStart.x) * progress,
        y: segmentStart.y + (point.y - segmentStart.y) * progress,
      };
    }

    const eligible = eligibleGeometries(allTiles);
    const candidate = closestTileAtPoint(point, eligible);
    if (candidate) {
      const deepInside = distanceSquared(point, candidate.center) <= (candidate.radius * 0.75) ** 2;
      const pending = pendingCandidateRef.current;
      const samples = pending?.index === candidate.index ? pending.samples + 1 : 1;
      pendingCandidateRef.current = { index: candidate.index, samples };
      if ((deepInside || samples >= 2) && addTile(candidate.index)) chosen = candidate.index;
    } else {
      pendingCandidateRef.current = null;
    }

    previousPointRef.current = point;
    if (debugEnabled) setHitDebug({ tiles: allTiles, pointer: point, chosen });
  };

  const startPath = (index: number, event: React.PointerEvent) => {
    event.preventDefault();
    active.current = true;
    boardRef.current?.setPointerCapture(event.pointerId);
    selectedRef.current = [index];
    setSelected([index]);
    setPathStatus("idle");
    const point = { x: event.clientX, y: event.clientY };
    previousPointRef.current = point;
    pendingCandidateRef.current = null;
    if (debugEnabled) setHitDebug({ tiles: tileGeometries(), pointer: point, chosen: index });
  };

  const movePath = (event: React.PointerEvent) => {
    if (!active.current) return;
    event.preventDefault();
    const nativeEvent = event.nativeEvent;
    const coalesced = nativeEvent.getCoalescedEvents?.() ?? [];
    const samples = coalesced.length ? coalesced : [nativeEvent];
    for (const sample of samples) processPoint({ x: sample.clientX, y: sample.clientY });
    const last = samples[samples.length - 1];
    if (!last || last.clientX !== nativeEvent.clientX || last.clientY !== nativeEvent.clientY) processPoint({ x: nativeEvent.clientX, y: nativeEvent.clientY });
  };

  const finishPath = () => {
    if (!active.current) return;
    active.current = false;
    previousPointRef.current = null;
    pendingCandidateRef.current = null;
    const completedPath = selectedRef.current;
    const word = completedPath.map((index) => board.letters[index]).join("").toLowerCase();
    let message = "Not a word";
    if (word.length < 3) message = "Too short";
    else if (!validatePath(completedPath, board.size)) message = "Invalid path";
    else if (foundRef.current.some((item) => item.word === word)) message = "Already found";
    else if (possible.has(word)) {
      const points = scoreWord(word);
      const nextFound = [{ word, score: points }, ...foundRef.current];
      foundRef.current = nextFound;
      setFound(nextFound);
      setPathStatus("valid");
      setFeedback({ text: word.toUpperCase(), kind: "valid", points });
      playSound("valid");
      window.setTimeout(() => { selectedRef.current = []; setSelected([]); setPathStatus("idle"); setFeedback(null); }, 380);
      return;
    }
    setPathStatus("invalid");
    setFeedback({ text: message, kind: "invalid" });
    playSound("invalid");
    window.setTimeout(() => { selectedRef.current = []; setSelected([]); setPathStatus("idle"); setFeedback(null); }, 380);
  };

  return <main className="game-screen">
    <header className="game-header"><Brand compact/><div className="game-header-actions"><IconButton label={sound ? "Mute sound" : "Turn sound on"} onClick={onSound}>{sound ? <Volume2/> : <VolumeX/>}</IconButton><IconButton label="Quit to menu" onClick={onMenu}><X/></IconButton></div></header>
    <section className="game-layout">
      <aside className="score-panel">
        <div className="panel-label">Round score</div><div className="big-score">{score.toLocaleString()}</div>
        <div className="rule"/>
        <div className="stat-pair"><div><strong>{found.length}</strong><span>Words found</span></div><div><strong>{board.words.length}</strong><span>On this board</span></div></div>
        <div className="micro-tip"><Info size={15}/><span>Drag through any adjacent letters—even diagonally.</span></div>
      </aside>
      <section className="play-zone">
        <div className={`timer ${remaining <= 10 ? "is-urgent" : ""}`}><span>Time left</span><strong>{formatTime(remaining)}</strong></div>
        <div className={`word-display ${feedback?.kind ?? ""}`}>
          <span>{feedback?.text ?? (currentWord || "Trace a word")}</span>
          {feedback?.points && <b>+{feedback.points}</b>}
        </div>
        <GameBoard board={board} selected={selected} status={pathStatus} boardRef={boardRef} debug={debugEnabled ? hitDebug : null} onStart={startPath} onMove={movePath} onEnd={finishPath}/>
      </section>
      <aside className="found-panel">
        <div className="found-heading"><div><span className="panel-label">Found words</span><strong>{found.length}</strong></div><Sparkles size={18}/></div>
        {found.length ? <div className="found-list">{found.map((item) => <div key={item.word}><span>{item.word}</span><small>+{item.score}</small></div>)}</div> : <div className="empty-found"><Grid2X2/><p>Your words will collect here.</p></div>}
      </aside>
    </section>
  </main>;
}

function Results({ board, found, score, onReplay, onMenu }: { board: GeneratedBoard; found: FoundWord[]; score: number; onReplay: () => void; onMenu: () => void }) {
  const [missedOpen, setMissedOpen] = useState(false);
  const foundSet = new Set(found.map((item) => item.word));
  const missed = board.words.filter((word) => !foundSet.has(word)).sort((a, b) => b.length - a.length || a.localeCompare(b));
  const longest = [...found].sort((a, b) => b.word.length - a.word.length)[0]?.word ?? "—";
  const best = [...found].sort((a, b) => b.score - a.score)[0]?.word ?? "—";
  const percent = board.words.length ? Math.round(found.length / board.words.length * 100) : 0;
  return <main className="results-screen">
    <header className="results-header"><Brand compact/></header>
    <section className="results-wrap">
      <div className="results-hero"><div className="trophy"><Trophy/></div><div><span className="eyebrow">Round complete</span><h1>Nice searching.</h1><p>You uncovered {found.length} of {board.words.length} possible words.</p></div></div>
      <div className="result-score-card"><span>Final score</span><strong>{score.toLocaleString()}</strong><small>Top {Math.max(1, 100 - percent)}% of this board explored</small></div>
      <div className="result-grid">
        <div><BarChart3/><strong>{found.length}</strong><span>Words found</span></div><div><Sparkles/><strong>{percent}%</strong><span>Board discovered</span></div><div><span className="letter-icon">Aa</span><strong>{longest}</strong><span>Longest word</span></div><div><Trophy/><strong>{best}</strong><span>Best scoring word</span></div>
      </div>
      <div className="results-columns">
        <section className="result-list-card"><div className="result-list-heading"><div><span>Your words</span><strong>{found.length}</strong></div><small>Sorted by score</small></div>{found.length ? <div className="result-words">{[...found].sort((a,b) => b.score - a.score).map((item) => <div key={item.word}><span>{item.word}</span><small>+{item.score}</small></div>)}</div> : <div className="empty-result">No words this time. The next board is waiting.</div>}</section>
        <section className="missed-card"><button onClick={() => setMissedOpen((open) => !open)} aria-expanded={missedOpen}><div><span>Words you missed</span><small>{missed.length} waiting to be discovered</small></div><ChevronDown className={missedOpen ? "is-open" : ""}/></button>{missedOpen && <div className="missed-list">{missed.map((word) => <span key={word}>{word}</span>)}</div>}</section>
      </div>
      <div className="result-actions"><button className="primary-button" onClick={onMenu}><span>Main menu</span><span className="button-arrow">↗</span></button><button className="secondary-button" onClick={onReplay}><RotateCcw size={17}/> Play again</button></div>
    </section>
  </main>;
}

export function App() {
  const [screen, setScreen] = useState<Screen>("menu");
  const [size, setSize] = useState<BoardSize>(4);
  const [sound, setSound] = useState(() => localStorage.getItem("lexigrid-sound") !== "off");
  const [stats, setStats] = useState(readStats);
  const [board, setBoard] = useState<GeneratedBoard | null>(null);
  const [found, setFound] = useState<FoundWord[]>([]);
  const [countdown, setCountdown] = useState("3");
  const playSound = useSound(sound);

  const toggleSound = () => setSound((value) => {
    localStorage.setItem("lexigrid-sound", value ? "off" : "on");
    return !value;
  });

  const beginCountdown = useCallback(() => {
    setFound([]);
    setCountdown("3");
    setScreen("countdown");
  }, []);

  useEffect(() => {
    if (screen !== "countdown") return;
    const steps = [[0, "3"], [700, "2"], [1400, "1"], [2100, "GO"]] as const;
    const timers = steps.map(([delay, label]) => window.setTimeout(() => { setCountdown(label); playSound(label === "GO" ? "go" : "tick"); }, delay));
    timers.push(window.setTimeout(() => setScreen("playing"), 2700));
    return () => timers.forEach(window.clearTimeout);
  }, [screen, playSound]);

  const buildBoard = useCallback(() => {
    setScreen("loading");
    const worker = new Worker(new URL("../game/board.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<GeneratedBoard>) => { setBoard(event.data); worker.terminate(); beginCountdown(); };
    worker.onerror = () => { worker.terminate(); setScreen("menu"); };
    worker.postMessage({ size });
  }, [beginCountdown, size]);

  const finishGame = useCallback((words: FoundWord[]) => {
    setFound(words);
    const total = words.reduce((sum, item) => sum + item.score, 0);
    const longest = [...words].sort((a, b) => b.word.length - a.word.length)[0]?.word ?? "";
    setStats((current) => {
      const next: GameStats = { gamesPlayed: current.gamesPlayed + 1, highestScore: Math.max(current.highestScore, total), mostWords: Math.max(current.mostWords, words.length), longestWord: longest.length > current.longestWord.length ? longest : current.longestWord, highScores: { ...current.highScores, [size]: Math.max(current.highScores[size], total) } };
      localStorage.setItem("lexigrid-stats", JSON.stringify(next));
      return next;
    });
    setScreen("results");
  }, [size]);

  const totalScore = found.reduce((sum, item) => sum + item.score, 0);
  if (screen === "menu") return <Menu size={size} onSize={setSize} onStart={buildBoard} sound={sound} onSound={toggleSound} stats={stats}/>;
  if (screen === "loading") return <div className="loading-screen"><Brand/><div className="loader-grid">{"LEXIGRIDPLAYWORD".split("").map((letter, index) => <span key={index}>{letter}</span>)}</div><h1>Building your board…</h1><p>Searching for a lively mix of hidden words.</p></div>;
  if (screen === "countdown") return <div className="countdown-screen"><Brand compact/><div className="countdown-ring"><span key={countdown}>{countdown}</span></div><p>Get ready to trace</p></div>;
  if (screen === "playing" && board) return <Gameplay key={`${board.letters.join("")}-${stats.gamesPlayed}`} board={board} sound={sound} onSound={toggleSound} onEnd={finishGame} onMenu={() => setScreen("menu")}/>;
  if (screen === "results" && board) return <Results board={board} found={found} score={totalScore} onReplay={beginCountdown} onMenu={() => setScreen("menu")}/>;
  return null;
}
