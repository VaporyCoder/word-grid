import { Heart, Settings, Volume2, VolumeX } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { usePreferences } from "../../store/preferences";

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { sound, setSound, colorVision, cardSize, reducedMotion, animationLevel } = usePreferences();
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.colorVision = colorVision ? "on" : "off";
    root.dataset.cardSize = cardSize;
    root.dataset.motion = reducedMotion ? "off" : animationLevel;
  }, [animationLevel, cardSize, colorVision, reducedMotion]);
  const compact = pathname.startsWith("/room/");
  return (
    <div className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <header className={compact ? "site-header site-header--compact" : "site-header"}>
        <Link className="brand" to="/" aria-label="Couples Wild home">
          <span className="brand-mark"><Heart size={15} fill="currentColor" /></span>
          <span>COUPLES WILD</span>
        </Link>
        <nav className="utility-nav" aria-label="Quick settings">
          <button className="icon-button" aria-label={sound ? "Mute sound" : "Turn sound on"} aria-pressed={!sound} onClick={() => setSound(!sound)}>{sound ? <Volume2 size={18} /> : <VolumeX size={18} />}</button>
          <Link className="icon-button" to="/settings" aria-label="Open settings"><Settings size={18} /></Link>
        </nav>
      </header>
      <main>{children}</main>
      {!compact && <footer className="site-footer"><span>Made for playful people</span><span>Private rooms · No account needed</span></footer>}
      {import.meta.env.DEV && !compact && <Link className="dev-shortcut" to="/dev/sandbox"><BugIcon /> Rules sandbox</Link>}
    </div>
  );
}

function BugIcon() {
  return <span aria-hidden="true">⌁</span>;
}
