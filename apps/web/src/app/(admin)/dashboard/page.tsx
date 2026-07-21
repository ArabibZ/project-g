import { dashboardSchema } from "@/lib/contracts";
import { requestAdminData } from "@/lib/server/require-admin";
import { DashboardClient } from "./dashboard-client";

export default async function DashboardPage() {
  const reply = await requestAdminData("dashboard", "/dashboard");
  const data = dashboardSchema.parse(reply.data);
  return <DashboardClient initialData={data} initialNow={reply.receivedAt} />;
}
