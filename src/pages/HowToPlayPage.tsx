import { ArrowRight, Palette, RefreshCcw, ShieldCheck } from "lucide-react";
import { Button } from "../components/ui/Button";
import { PageIntro } from "../components/ui/PageIntro";

export function HowToPlayPage() {
  return (
    <section className="content-page container">
      <PageIntro eyebrow="The rules" title="Easy to learn. Delightfully hard to quit." description="Match by color, number, or symbol. Be the first to play every card in your hand." />
      <div className="rule-grid">
        <article className="panel rule-card"><span className="rule-number">01</span><Palette /><h2>Make a match</h2><p>Play a card matching the current color, number, or action symbol. Wild cards are always ready.</p></article>
        <article className="panel rule-card"><span className="rule-number">02</span><RefreshCcw /><h2>Change the rhythm</h2><p>Skip, reverse, and draw cards keep things lively. In a two-player game, reverse also skips.</p></article>
        <article className="panel rule-card"><span className="rule-number">03</span><ShieldCheck /><h2>Call your last card</h2><p>Down to one? Declare “Last Card!” before your opponent catches you, or draw two as a penalty.</p></article>
      </div>
      <div className="content-cta"><p>That’s everything you need for your first match.</p><Button to="/create" icon={<ArrowRight size={18} />}>Create a room</Button></div>
    </section>
  );
}
