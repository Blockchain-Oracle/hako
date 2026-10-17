import { THEME_STORAGE_KEY } from "@/lib/constants/site";

/**
 * Light or dark, as the `.dark` class on <html>. THEME_SCRIPT sets it before the first paint (the visitor's saved
 * choice, else the system's), so the page never flashes the wrong theme; the toggle then reads and changes the class
 * through this tiny external store (useSyncExternalStore).
 */
export type Theme = "light" | "dark";

const DARK_CLASS = "dark";
const DARK_QUERY = "(prefers-color-scheme: dark)";
const listeners = new Set<() => void>();

/**
 * Inlined into <head>. It also follows the system while the visitor has not chosen. Values are inlined, not
 * imported, because the script runs before any bundle.
 */
export const THEME_SCRIPT = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)},q=matchMedia(${JSON.stringify(DARK_QUERY)}),r=document.documentElement;function a(){var s=localStorage.getItem(k);r.classList.toggle(${JSON.stringify(DARK_CLASS)},s?s==="dark":q.matches)}a();q.addEventListener("change",a)}catch(e){}})()`;

export function currentTheme(): Theme {
  return document.documentElement.classList.contains(DARK_CLASS) ? "dark" : "light";
}

export function setTheme(theme: Theme): void {
  document.documentElement.classList.toggle(DARK_CLASS, theme === "dark");
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // storage blocked: the choice lasts for this page only
  }
  for (const listener of listeners) listener();
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener("change", listener); // the head script flips the class when the system changes
  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", listener);
  };
}

/** The server cannot know the theme; the toggle renders light until hydration, then the real one. */
export const serverTheme = (): Theme => "light";
