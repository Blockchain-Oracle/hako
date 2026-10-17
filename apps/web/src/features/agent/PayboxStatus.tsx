import { Wallet } from "lucide-react";

/**
 * The visitor's wallet state, said in words: PayBox is not connected. Paid runs are paid from the user's own PayBox
 * wallet; Connect PayBox replaces this label in a later stage, so it is a status, not a button.
 */
export function PayboxStatus() {
  return (
    <span
      className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm text-muted-foreground"
      title="Paid runs are paid from your PayBox wallet. Connecting PayBox here isn't available yet."
    >
      <Wallet className="size-4 text-muted-foreground" aria-hidden />
      <span>
        PayBox <span className="text-muted-foreground">· Not connected</span>
      </span>
    </span>
  );
}
