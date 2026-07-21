import { jobsSchema } from "@/lib/contracts";
import { requestAdminData } from "@/lib/server/require-admin";
import { JobsClient } from "./jobs-client";

export default async function JobsPage() {
  const result = jobsSchema.parse((await requestAdminData("jobs", "/jobs")).data);
  return <JobsClient initialJobs={result.jobs} initialCursor={result.nextCursor} />;
}
