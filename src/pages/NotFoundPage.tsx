import { Button } from "../components/ui/Button";

export function NotFoundPage() {
  return <section className="not-found container"><span className="eyebrow">404 · Wrong table</span><h1>This room isn’t on the guest list.</h1><p>The link may be old, or the room code may have slipped away.</p><Button to="/">Return home</Button></section>;
}
