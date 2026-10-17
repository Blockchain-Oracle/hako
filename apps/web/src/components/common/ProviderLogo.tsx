import { Mark, providerKey } from "@hako/identity";

const SIZES = { sm: 20, md: 28, lg: 44 } as const;

/** A catalog provider's real mark from @hako/identity (by catalog id), or its labelled neutral disc: never a stand-in. */
export function ProviderLogo({ id, name, size = "md", className }: {
  id: string;
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return <Mark entity={providerKey(id)} name={name} size={SIZES[size]} className={className} />;
}
