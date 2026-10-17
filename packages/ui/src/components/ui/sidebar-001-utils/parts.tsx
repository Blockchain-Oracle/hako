"use client";

// 21st.dev unlumen/sidebar-001 (21517): the separator, header and footer, moved unchanged out of sidebar-001.tsx to
// keep each file under the repo's 400-line limit; sidebar-001.tsx re-exports them under the same names.

import * as React from "react";
import { cn } from "@hako/ui/lib/utils";

// ─── Sidebar001Separator ──────────────────────────────────────────────────────

export function Sidebar001Separator({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "px-0 py-3.5 mt-2 text-sm font-medium text-foreground/40",
        className,
      )}
    >
      {children}
    </div>
  );
}

// ─── Sidebar001Header ─────────────────────────────────────────────────────────

export function Sidebar001Header({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("shrink-0 px-3 pt-4 pb-2", className)}>{children}</div>
  );
}

// ─── Sidebar001Footer ─────────────────────────────────────────────────────────

export function Sidebar001Footer({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "shrink-0 px-3 pb-4 pt-2 border-t border-border/50",
        className,
      )}
    >
      {children}
    </div>
  );
}
