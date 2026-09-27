import { motion } from "framer-motion";
import { ArrowRight, LockKeyhole, Sparkles, Users } from "lucide-react";
import { GameCard } from "../components/cards/GameCard";
import { Button } from "../components/ui/Button";

export function LandingPage() {
  return (
    <section className="landing container">
      <motion.div className="hero-copy" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55 }}>
        <span className="eyebrow"><Sparkles size={14} /> Your private card night</span>
        <h1>A little competition,<br /><em>wherever you are.</em></h1>
        <p className="hero-lede">A cozy, quick-thinking card game made for two. Open a room, send the code, and meet at the table.</p>
        <div className="hero-actions">
          <Button to="/create" icon={<ArrowRight size={18} />}>Create a room</Button>
          <Button to="/join" variant="secondary">Join with a code</Button>
        </div>
        <div className="trust-row"><span><LockKeyhole size={15} /> Private by design</span><span><Users size={15} /> Made for 2–4</span></div>
      </motion.div>

      <motion.div className="hero-stage" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.12, duration: 0.65 }} aria-label="A fan of original playing cards">
        <div className="hero-glow" />
        <GameCard suit="emerald" value="4" className="hero-card hero-card--one" />
        <GameCard suit="gold" value="✦" className="hero-card hero-card--two" />
        <GameCard suit="crimson" value="7" className="hero-card hero-card--three" />
        <div className="floating-note"><span>ROOM FOR TWO</span><strong>One code. One table.</strong></div>
      </motion.div>

      <div className="landing-note"><span>01</span><p>Create a private room</p><span>02</span><p>Invite your favorite rival</p><span>03</span><p>Play from anywhere</p></div>
    </section>
  );
}
