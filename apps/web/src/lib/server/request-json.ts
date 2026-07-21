const MAX_REQUEST_BYTES = 64 * 1024;

export async function requestJson(request: Request): Promise<unknown> {
  if (!request.body) return undefined;

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_REQUEST_BYTES) throw new Error("REQUEST_TOO_LARGE");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new Error("REQUEST_TOO_LARGE");
    }
    chunks.push(value);
  }
  if (length === 0) return undefined;
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    throw new Error("JSON_REQUIRED");
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error("INVALID_JSON");
  }
}
