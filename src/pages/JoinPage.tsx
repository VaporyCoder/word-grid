import { ArrowRight, KeyRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { PageIntro } from "../components/ui/PageIntro";
import { roomCodeSchema } from "../lib/validation/room";
import { displayNameSchema } from "../lib/validation/room";
import { joinRemoteRoom } from "../features/rooms/roomService";
import { isSupabaseConfigured } from "../lib/supabase/client";

export function JoinPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const configured = isSupabaseConfigured();
  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = roomCodeSchema.safeParse(code);
    if (!result.success) { setError(result.error.issues[0]?.message ?? "That room code is not valid."); return; }
    const parsedName = displayNameSchema.safeParse(name);
    if (!parsedName.success) { setError("Choose a display name between 1 and 24 characters."); return; }
    setBusy(true);
    if (configured) {
      try {
        const session = await joinRemoteRoom(result.data, parsedName.data);
        navigate(`/room/${session.roomCode}`, { state: { mode: "remote" } });
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "The room couldn’t be joined.");
      } finally { setBusy(false); }
      return;
    }
    navigate(`/room/${result.data}`, { state: { playerName: parsedName.data, isHost: false, mode: "preview" } });
  }
  return (
    <section className="flow-page container">
      <PageIntro eyebrow="Join a game" title="Your seat is waiting." description="Enter the room code your partner sent you. No account or setup needed." />
      <form className="panel form-panel" onSubmit={submit}>
        <label htmlFor="room-code">Room code</label>
        <div className="input-with-icon"><KeyRound size={20} /><input id="room-code" autoFocus value={code} onChange={(event) => { setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6)); setError(""); }} placeholder="ABC234" /></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <label htmlFor="join-name">Your display name</label>
        <input id="join-name" maxLength={24} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Sam" />
        {!configured && <p className="config-note">Local preview mode — add your Supabase settings to join a live room.</p>}
        <Button type="submit" disabled={busy} icon={<ArrowRight size={18} />}>{busy ? "Finding your seat…" : configured ? "Join the room" : "Preview the lobby"}</Button>
      </form>
    </section>
  );
}
