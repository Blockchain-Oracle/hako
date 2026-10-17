import { AgentApp } from "@/features/agent/AgentApp";
import { chatEndpoints } from "@/features/agent/endpoints.server";

export default async function AgentChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AgentApp endpoints={await chatEndpoints()} initialChatId={id} />;
}
