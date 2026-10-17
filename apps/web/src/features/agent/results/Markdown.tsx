"use client";

import { type ComponentProps, useState } from "react";
import { type Components, defaultRehypePlugins, Streamdown } from "streamdown";

import { cn } from "@/lib/utils";

import { CLAMP_BREAK_MIN_SHARE } from "./constants";
import { cutText } from "./format";
import { ExtLink } from "./primitives";

type WithNode<T> = T & { node?: unknown };

/** Streamdown hands each override its hast `node`; it must not reach the DOM. */
function dom<T extends object>(props: WithNode<T>): T {
  const copy = { ...props };
  delete copy.node;
  return copy;
}

/**
 * Element overrides in Monid paint. They also keep the look independent of Streamdown's own utility classes,
 * and keep provider markdown inert: links open in a new tab through the http(s)-only ExtLink, images are dropped
 * (a scraped page's images are tracking pixels as often as content), raw HTML is skipped.
 */
const COMPONENTS: Components = {
  a: ({ href, children }) => <ExtLink href={href}>{children}</ExtLink>,
  img: ({ alt }) => (alt ? <span className="text-muted-foreground">[image: {alt}]</span> : null),
  p: (props) => <p {...dom(props)} className="my-2 leading-relaxed" />,
  h1: (props) => <h3 {...dom(props)} className="mt-4 mb-1.5 font-display text-lg font-semibold tracking-[-0.02em] text-foreground" />,
  h2: (props) => <h4 {...dom(props)} className="mt-4 mb-1.5 font-display text-base font-semibold tracking-[-0.02em] text-foreground" />,
  h3: (props) => <h5 {...dom(props)} className="mt-3 mb-1 font-display text-[0.9375rem] font-semibold text-foreground" />,
  h4: (props) => <h6 {...dom(props)} className="mt-3 mb-1 text-sm font-semibold text-foreground" />,
  h5: (props) => <h6 {...dom(props)} className="mt-3 mb-1 text-sm font-semibold text-foreground" />,
  h6: (props) => <h6 {...dom(props)} className="mt-3 mb-1 text-sm font-semibold text-foreground" />,
  ul: (props) => <ul {...dom(props)} className="my-2 list-disc space-y-1 pl-5" />,
  ol: (props) => <ol {...dom(props)} className="my-2 list-decimal space-y-1 pl-5" />,
  li: (props) => <li {...dom(props)} className="leading-relaxed" />,
  blockquote: (props) => <blockquote {...dom(props)} className="my-3 border-l-2 border-line-default pl-3 text-muted-foreground" />,
  hr: () => <hr className="my-4 border-line" />,
  strong: (props) => <strong {...dom(props)} className="font-semibold text-foreground" />,
  table: (props) => (
    <div className="my-3 overflow-x-auto rounded-sm border border-line">
      <table {...dom(props)} className="w-full border-collapse text-left text-xs" />
    </div>
  ),
  th: (props) => <th {...dom(props)} className="border-b border-line bg-subtle px-2.5 py-1.5 font-medium text-foreground" />,
  td: (props) => <td {...dom(props)} className="border-b border-line px-2.5 py-1.5 align-top" />,
  code: (props: WithNode<ComponentProps<"code">>) => {
    if ("data-block" in props) {
      return (
        <pre className="my-3 overflow-x-auto rounded-sm border border-line bg-subtle p-3 font-mono text-xs leading-relaxed text-ink-2">
          <code>{props.children}</code>
        </pre>
      );
    }
    return <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground">{props.children}</code>;
  },
};

// Streamdown's defaults minus rehype-raw: raw HTML in provider markdown stays unparsed, and skipHtml then drops it.
const REHYPE_PLUGINS = [defaultRehypePlugins.sanitize, defaultRehypePlugins.harden].filter((p) => p !== undefined);

function Render({ text }: { text: string }) {
  return (
    <Streamdown
      mode="static"
      skipHtml
      rehypePlugins={REHYPE_PLUGINS}
      controls={false}
      linkSafety={{ enabled: false }}
      components={COMPONENTS}
    >
      {text}
    </Streamdown>
  );
}

/** Provider markdown, rendered inert; past `clampChars` it collapses behind a fade with a Show more toggle. */
export function Markdown({ children, clampChars, className }: { children: string; clampChars?: number; className?: string }) {
  const [open, setOpen] = useState(false);
  const long = clampChars !== undefined && children.length > clampChars;
  const text = long && !open ? cutText(children, clampChars, CLAMP_BREAK_MIN_SHARE) : children;
  return (
    <div className={cn("text-[0.875rem] break-words text-ink-2", className)}>
      <div className="relative">
        <Render text={text} />
        {long && !open && <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-linear-to-t from-background" />}
      </div>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="mt-1 text-[0.8125rem] font-medium text-brand underline-offset-4 hover:underline"
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
