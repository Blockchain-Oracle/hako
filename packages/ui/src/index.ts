/**
 * @hako/ui: every installed component (plan §3 Chat UI, §6). Apps and cards may import a component by its own path
 * (`@hako/ui/components/ui/button`), which keeps a page's bundle to what it uses; this index lists the whole set.
 * Provenance of each file: apps/web/.21st/design.json. Installed code keeps its author's style; colours are the
 * @hako/brand tokens.
 */

// shadcn first-party chat components (radix-nova)
export * from "./components/ui/message-scroller.tsx";
export * from "./components/ui/message.tsx";
export * from "./components/ui/bubble.tsx";
export * from "./components/ui/trace.tsx";
export * from "./components/ui/code-block.tsx";
export * from "./components/ui/marker.tsx";
export * from "./components/ui/item.tsx";
export * from "./components/ui/questionnaire.tsx";
export * from "./components/ui/attachment.tsx";

// shadcn primitives (radix-nova), and the ones the chat components and the Kawase ports build on
export * from "./components/ui/button.tsx";
export * from "./components/ui/input.tsx";
export * from "./components/ui/textarea.tsx";
export * from "./components/ui/dialog.tsx";
export * from "./components/ui/sheet.tsx";
export * from "./components/ui/tooltip.tsx";
export * from "./components/ui/accordion.tsx";
export * from "./components/ui/collapsible.tsx";
export * from "./components/ui/separator.tsx";
export * from "./components/ui/skeleton.tsx";
export * from "./components/ui/sonner.tsx";
export * from "./components/ui/empty.tsx";

// 21st.dev installs (plan §6 list)
export * from "./components/ui/sidebar-001.tsx";
export * from "./components/ui/task-steps.tsx";
export * from "./components/ui/stepper.tsx";
export * from "./components/ui/skeleton-swap.tsx";
export * from "./components/ui/empty-state.tsx";
export * from "./components/ui/text-shimmer.tsx";
export * from "./components/ui/drawer.tsx";

// Kawase ui-web ports (21st originals reskinned for Senryo, and prompt-kit's prompt input and response stream)
export * from "./components/ui/number-flow.tsx";
export * from "./components/ui/slide-action-button.tsx";
export * from "./components/ui/hold-to-confirm.tsx";
export * from "./components/ui/segmented-control.tsx";
export * from "./components/ui/prompt-input.tsx";
export * from "./components/ui/response-stream.tsx";

// Real marks: Kawase's Mark lives in @hako/identity with TokenMark (one implementation, re-exported here).
export { Mark, TokenMark, type MarkProps, type TokenMarkProps } from "@hako/identity";

export { cn } from "./lib/utils.ts";
export { useHighlightedCode } from "./hooks/use-highlighted-code.ts";
export { highlightCode, loadHighlighter } from "./lib/highlighter.tsx";
