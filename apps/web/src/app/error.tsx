"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main id="main" className="mx-auto flex max-w-[680px] flex-col items-center px-4 py-32 text-center">
      <h1 className="display text-5xl">Something broke.</h1>
      <p className="mt-4 text-lg text-muted-foreground">The page failed to render. Nothing was charged.</p>
      <button onClick={reset} className="mt-8 rounded-md bg-brand px-5 py-2.5 font-medium text-primary-foreground hover:bg-brand-hover">
        Try again
      </button>
    </main>
  );
}
