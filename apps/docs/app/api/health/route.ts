/** Coolify's container health check (`curl /api/health`): the process is up and serving. */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok", service: "docs" });
}

export function HEAD() {
  return new Response(null);
}
