import { HakoMark } from "@hako/brand/react";
import Image from "next/image";

import { LOGO_IDS } from "@/lib/constants/logos";
import { cn } from "@/lib/utils";

const SIZES = { sm: 20, md: 28, lg: 44 } as const;
const HAKO_ID = "hako";

/** A provider's mark from public/logos (fetched once by scripts/fetch-logos.mjs) or a monogram tile. */
export function ProviderLogo({ id, name, size = "md", className }: {
  id: string;
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const px = SIZES[size];
  if (id === HAKO_ID) {
    return (
      <span
        aria-hidden
        style={{ width: px, height: px }}
        className={cn("inline-flex shrink-0 items-center justify-center rounded-[6px] bg-primary text-primary-foreground", className)}
      >
        <HakoMark className="size-[72%]" label={null} />
      </span>
    );
  }
  if (LOGO_IDS.has(id)) {
    return (
      <Image
        src={`/logos/${id}.png`}
        alt=""
        width={px}
        height={px}
        className={cn("shrink-0 rounded-[6px] border border-border bg-white object-contain p-[2px]", className)}
      />
    );
  }
  return (
    <span
      aria-hidden
      style={{ width: px, height: px }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[6px] bg-primary font-display text-[0.75em] font-semibold text-primary-foreground",
        className,
      )}
    >
      {name.slice(0, 1)}
    </span>
  );
}
