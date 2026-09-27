type Suit = "crimson" | "gold" | "emerald" | "azure" | "wild";

export function GameCard({ suit, value, className = "" }: { suit: Suit; value: string; className?: string }) {
  return (
    <div className={`game-card game-card--${suit} ${className}`} aria-label={`${suit} ${value} card`}>
      <span className="game-card__corner">{value}</span>
      <span className="game-card__orbit" />
      <strong className="game-card__value">{value}</strong>
      <span className="game-card__corner game-card__corner--bottom">{value}</span>
    </div>
  );
}

export function CardBack({ className = "" }: { className?: string }) {
  return <div className={`game-card game-card--back ${className}`} aria-label="Face-down card"><span className="card-back-mark">CW</span></div>;
}
