"use client";

import { Component, type ReactNode } from "react";

/**
 * The last line of defence: if a kind card meets a shape it cannot draw, the chat keeps going and the card falls
 * back (to the raw JSON) instead of taking the conversation down with it.
 */
export class CardBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
