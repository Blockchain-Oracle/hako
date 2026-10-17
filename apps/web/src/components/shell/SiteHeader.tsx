import { Menu, MessageSquare } from "lucide-react";
import Link from "next/link";

import { Logo } from "@/components/brand/Logo";
import { GitHubMark } from "@/components/common/GitHubMark";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { NAV, REPO_URL } from "@/lib/constants/site";

/** Wordmark, primary navigation, and a visible path into the agent. */
export function SiteHeader({ active }: { active?: string }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between gap-6 px-4 sm:px-6">
        <Logo />
        <nav aria-label="Main" className="hidden items-center gap-8 text-[0.9375rem] md:flex">
          {NAV.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className={
                active === item.label
                  ? "font-medium text-foreground"
                  : "text-muted-foreground transition-colors hover:text-foreground"
              }
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <a
            href={REPO_URL}
            className="hidden size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
            aria-label="Hako on GitHub"
          >
            <GitHubMark className="size-[18px]" />
          </a>
          <details className="relative md:hidden">
            <summary className="flex size-9 cursor-pointer list-none items-center justify-center rounded-md text-ink-2 hover:bg-muted [&::-webkit-details-marker]:hidden" aria-label="Menu">
              <Menu className="size-5" aria-hidden />
            </summary>
            <nav aria-label="Main" className="absolute right-0 mt-2 w-44 rounded-md border border-line bg-background p-1.5 shadow-card-hover">
              {NAV.map((item) => (
                <Link key={item.label} href={item.href} className="block rounded-sm px-3 py-2 text-sm hover:bg-muted">
                  {item.label}
                </Link>
              ))}
            </nav>
          </details>
          <Link
            href="/agent"
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <MessageSquare className="size-3.5" aria-hidden />
            <span className="sm:hidden">Agent</span>
            <span className="hidden sm:inline">Try the agent</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
