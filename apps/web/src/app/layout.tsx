import "@/styles/index.css";

import type { Metadata } from "next";

import { SITE_NAME, SITE_URL } from "@/lib/constants/site";
import { fontVariables } from "@/lib/fonts";
import { THEME_SCRIPT } from "@/lib/theme";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${SITE_NAME} · every tool your agent needs, paid with PayBox`, template: `%s · ${SITE_NAME}` },
  description:
    "80+ paid tools for agents: live web search, page extraction, cited answers, research papers, weather, FX, " +
    "packages and more. Your agent discovers and inspects tools for free and pays per call in USDC on Base with " +
    "your PayBox wallet.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // The theme class is set by THEME_SCRIPT before hydration, so the server's <html> differs on purpose.
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh bg-background text-foreground">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
