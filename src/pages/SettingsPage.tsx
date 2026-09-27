import { PageIntro } from "../components/ui/PageIntro";
import { usePreferences } from "../store/preferences";
import { playGameSound } from "../features/settings/gameSounds";
import { Button } from "../components/ui/Button";

export function SettingsPage() {
  const preferences = usePreferences();
  return (
    <section className="content-page container settings-page">
      <PageIntro eyebrow="Your preferences" title="Make it feel just right." description="These settings stay on this device and never affect the other player." />
      <div className="panel settings-panel">
        <Setting label="Game sounds" description="Play original gentle cues for turns and cards" value={preferences.sound} onChange={preferences.setSound} />
        <label className="range-setting"><span><strong>Sound volume</strong><small>{Math.round(preferences.volume * 100)}%</small></span><input aria-label="Sound volume" type="range" min="0" max="1" step="0.05" value={preferences.volume} onChange={(event) => preferences.setVolume(Number(event.target.value))} /><Button variant="secondary" onClick={() => playGameSound("turn")} disabled={!preferences.sound}>Preview</Button></label>
        <Setting label="Confirm before playing" description="Select a card, then confirm the move" value={preferences.confirmPlay} onChange={preferences.setConfirmPlay} />
        <Setting label="Color-vision patterns" description="Add distinct patterns to every card color" value={preferences.colorVision} onChange={preferences.setColorVision} />
        <Setting label="Reduce motion" description="Keep transitions calm regardless of device settings" value={preferences.reducedMotion} onChange={preferences.setReducedMotion} />
        <Setting label="Show match history" description="Keep the event-log control available at the table" value={preferences.showEventLog} onChange={preferences.setShowEventLog} />
        <label className="select-setting"><span><strong>Card size</strong><small>Adjust how your hand fits on screen</small></span><select value={preferences.cardSize} onChange={(event) => preferences.setCardSize(event.target.value as typeof preferences.cardSize)}><option value="compact">Compact</option><option value="comfortable">Comfortable</option><option value="large">Large</option></select></label>
        <label className="select-setting"><span><strong>Animation detail</strong><small>Choose how lively turns and cards feel</small></span><select value={preferences.animationLevel} onChange={(event) => preferences.setAnimationLevel(event.target.value as typeof preferences.animationLevel)}><option value="full">Full</option><option value="subtle">Subtle</option><option value="off">Off</option></select></label>
      </div>
    </section>
  );
}

function Setting({ label, description, value, onChange }: { label: string; description: string; value: boolean; onChange: (value: boolean) => void }) {
  return <label className="toggle-setting"><span><strong>{label}</strong><small>{description}</small></span><input type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} /><span className="toggle" /></label>;
}
