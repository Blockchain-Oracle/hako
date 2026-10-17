import "./global.css";

import { RootProvider } from "fumadocs-ui/provider/next";
import type { Metadata } from "next";

import { fontVariables } from "@/lib/fonts";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(site.docs),
  title: { default: "Hako Docs", template: "%s · Hako Docs" },
  description:
    "Hako gives your agent a box of paid tools: discover and inspect for free, run any tool for a fixed price per call in USDC on Base, paid with your PayBox wallet.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <body className="flex min-h-dvh flex-col">
        {/* Dark first, like Monid's docs; the toggle still offers light. */}
        <RootProvider theme={{ defaultTheme: "dark", enableSystem: false, storageKey: site.themeStorageKey }}>
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
