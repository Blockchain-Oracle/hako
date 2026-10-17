import { skillMarkdown } from "@/lib/skill";

export const dynamic = "force-static";

export function GET() {
  return new Response(skillMarkdown(), { headers: { "content-type": "text/markdown; charset=utf-8" } });
}
