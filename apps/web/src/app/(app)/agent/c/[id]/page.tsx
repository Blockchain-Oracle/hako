import { AgentApp, chatEndpoints } from "@/features/agent";

export default async function AgentChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AgentApp endpoints={await chatEndpoints()} initialChatId={id} />;
}
