import { botSchema, subscribersSchema } from "@/lib/contracts";
import { requestAdminData } from "@/lib/server/require-admin";
import { BotClient } from "./bot-client";

export default async function BotPage() {
  const [botData, subscribersData] = await Promise.all([
    requestAdminData("bot", "/bot"),
    requestAdminData("bot/subscribers", "/bot")
  ]);
  const bot = botSchema.parse(botData.data);
  const subscribers = subscribersSchema.parse(subscribersData.data).subscribers;
  return <BotClient initialBot={bot} initialSubscribers={subscribers} />;
}
