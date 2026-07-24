import { jobsSchema } from "@/lib/contracts";
import { requestAdminData } from "@/lib/server/require-admin";
import { JobsClient } from "./jobs-client";

export default async function JobsPage() {
  const reply = await requestAdminData("jobs", "/jobs");
  const result = jobsSchema.parse(reply.data);
  return <JobsClient initialJobs={result.jobs} initialCursor={result.nextCursor} initialNow={reply.receivedAt} />;
}
