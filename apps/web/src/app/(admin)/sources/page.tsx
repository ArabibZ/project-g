import { sourcesSchema } from "@/lib/contracts";
import { requestAdminData } from "@/lib/server/require-admin";
import { SourcesClient } from "./sources-client";

export default async function SourcesPage() {
  const reply = await requestAdminData("sources", "/sources");
  const result = sourcesSchema.parse(reply.data);
  const sources = [...result.sources].sort((a, b) => a.position - b.position);
  return <SourcesClient initialSources={sources} initialNow={reply.receivedAt} />;
}
