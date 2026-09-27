import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

export function PageIntro({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="page-intro">
      <Link className="back-link" to="/"><ArrowLeft size={16} /> Back home</Link>
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  );
}
