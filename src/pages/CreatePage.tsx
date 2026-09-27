import { ArrowRight, EyeOff, Sparkles } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { PageIntro } from "../components/ui/PageIntro";
import { createRemoteRoom } from "../features/rooms/roomService";
import { isSupabaseConfigured } from "../lib/supabase/client";
import { displayNameSchema } from "../lib/validation/room";

const roomCharacters = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function CreatePage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [maxPlayers, setMaxPlayers] = useState<2 | 3 | 4>(2);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const configured = isSupabaseConfigured();
  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsedName = displayNameSchema.safeParse(name);
    if (!parsedName.success) { setError("Choose a display name between 1 and 24 characters."); return; }
    setBusy(true);
    setError("");
    if (configured) {
      try {
        const session = await createRemoteRoom(parsedName.data, maxPlayers);
        navigate(`/room/${session.roomCode}`, { state: { mode: "remote" } });
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "The room couldn’t be created.");
      } finally { setBusy(false); }
      return;
    }
    const code = Array.from({ length: 6 }, () => roomCharacters[Math.floor(Math.random() * roomCharacters.length)]).join("");
    navigate(`/room/${code}`, { state: { playerName: parsedName.data, isHost: true, mode: "preview" } });
  }
  return (
    <section className="flow-page container">
      <PageIntro eyebrow="Host a game" title="Set the table." description="Choose how you’ll appear, then we’ll make a private room for your game night." />
      <form className="panel form-panel" onSubmit={submit}>
        <label htmlFor="display-name">Your display name</label>
        <input id="display-name" autoFocus maxLength={24} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Jules" />
        {!configured && <p className="config-note">Local preview mode — add your Supabase settings to create a live room.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="setting-preview"><EyeOff size={19} /><div><strong>Private room</strong><span>Only people with your code can join</span></div><span className="status-pill">Default</span></div>
        <div className="setting-preview"><Sparkles size={19} /><div><strong>Classic rules</strong><span>A relaxed two-player match</span></div><span className="status-pill">Ready</span></div>
        <label htmlFor="player-limit">Maximum players</label>
        <select id="player-limit" value={maxPlayers} onChange={(event) => setMaxPlayers(Number(event.target.value) as 2 | 3 | 4)}><option value="2">2 players</option><option value="3">3 players</option><option value="4">4 players</option></select>
        <Button type="submit" disabled={busy} icon={<ArrowRight size={18} />}>{busy ? "Preparing your room…" : configured ? "Create my room" : "Preview a room"}</Button>
      </form>
    </section>
  );
}
