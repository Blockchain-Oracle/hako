import { notFound } from "next/navigation";

/**
 * The signing sandbox (SP4): `src/proxy.ts` rewrites every request on the sandbox host (sandbox.usehako.site) to
 * `app/sandbox/**`, a second origin where PayBox's signing window runs apart from the app's own. Wave 2 L4 builds it;
 * until then it answers 404.
 */
export default function SandboxPage() {
  notFound();
}
