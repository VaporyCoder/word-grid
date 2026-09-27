import { usePreferences } from "../../store/preferences";

export type GameSound = "play" | "draw" | "turn" | "action" | "declare" | "victory" | "invalid";

const notes: Record<GameSound, number[]> = {
  play: [440, 590], draw: [310], turn: [520, 660], action: [360, 480, 610],
  declare: [620, 780], victory: [440, 554, 659, 880], invalid: [190, 155],
};

let context: AudioContext | null = null;

export function playGameSound(kind: GameSound): void {
  const { sound, volume } = usePreferences.getState();
  if (!sound || volume <= 0 || typeof window === "undefined") return;
  const AudioContextClass = window.AudioContext;
  if (!AudioContextClass) return;
  context ??= new AudioContextClass();
  if (context.state === "suspended") void context.resume();
  const start = context.currentTime;
  notes[kind].forEach((frequency, index) => {
    const oscillator = context!.createOscillator();
    const gain = context!.createGain();
    const noteStart = start + index * 0.075;
    oscillator.type = kind === "invalid" ? "square" : "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, noteStart);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume * 0.12), noteStart + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.12);
    oscillator.connect(gain).connect(context!.destination);
    oscillator.start(noteStart);
    oscillator.stop(noteStart + 0.13);
  });
}
