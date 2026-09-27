import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "../ui/Button";

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Couples Wild render error", error, info); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <section className="room-state container"><span className="eyebrow">A card slipped off the table</span><h1>Let’s restore your game.</h1><p>Your live room is safely stored. Reload to reconnect.</p><div className="error-boundary-actions"><Button onClick={() => window.location.reload()}>Reload game</Button><Button variant="secondary" to="/">Go home</Button></div></section>;
  }
}
