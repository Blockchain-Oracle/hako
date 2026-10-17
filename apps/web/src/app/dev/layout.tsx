import { notFound } from "next/navigation";

/**
 * Development-only pages (`/dev/gallery`: every card in every state for QA, plan D28). A production build answers 404
 * for everything under `/dev`, so the gallery and its fixtures never ship to visitors.
 */
export default function DevLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  if (process.env.NODE_ENV === "production") notFound();
  return children;
}
