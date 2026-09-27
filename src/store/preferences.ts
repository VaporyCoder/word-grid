import { create } from "zustand";
import { persist } from "zustand/middleware";

export type AnimationLevel = "full" | "subtle" | "off";
export type CardSize = "compact" | "comfortable" | "large";

type Preferences = {
  sound: boolean;
  volume: number;
  confirmPlay: boolean;
  colorVision: boolean;
  reducedMotion: boolean;
  animationLevel: AnimationLevel;
  cardSize: CardSize;
  showEventLog: boolean;
  setSound: (value: boolean) => void;
  setVolume: (value: number) => void;
  setConfirmPlay: (value: boolean) => void;
  setColorVision: (value: boolean) => void;
  setReducedMotion: (value: boolean) => void;
  setAnimationLevel: (value: AnimationLevel) => void;
  setCardSize: (value: CardSize) => void;
  setShowEventLog: (value: boolean) => void;
};

export const usePreferences = create<Preferences>()(
  persist(
    (set) => ({
      sound: true,
      volume: 0.45,
      confirmPlay: false,
      colorVision: false,
      reducedMotion: false,
      animationLevel: "full",
      cardSize: "comfortable",
      showEventLog: true,
      setSound: (sound) => set({ sound }),
      setVolume: (volume) => set({ volume: Math.max(0, Math.min(1, volume)) }),
      setConfirmPlay: (confirmPlay) => set({ confirmPlay }),
      setColorVision: (colorVision) => set({ colorVision }),
      setReducedMotion: (reducedMotion) => set({ reducedMotion }),
      setAnimationLevel: (animationLevel) => set({ animationLevel }),
      setCardSize: (cardSize) => set({ cardSize }),
      setShowEventLog: (showEventLog) => set({ showEventLog }),
    }),
    { name: "couples-wild-preferences" },
  ),
);
