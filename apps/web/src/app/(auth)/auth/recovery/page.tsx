import { RecoveryForm } from "./recovery-form";

type RecoveryPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function RecoveryPage({ searchParams }: RecoveryPageProps) {
  const params = await searchParams;
  const token = Array.isArray(params.token_hash) ? params.token_hash[0] : params.token_hash;
  const type = Array.isArray(params.type) ? params.type[0] : params.type;
  return <RecoveryForm tokenHash={token ?? ""} validType={type === "recovery"} />;
}
