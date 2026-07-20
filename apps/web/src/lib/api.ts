export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

type ApiInit = Omit<RequestInit, "signal"> & { signal?: AbortSignal | undefined };

export async function api(path: string, init: ApiInit = {}): Promise<unknown> {
  const { signal, ...requestInit } = init;
  const response = await fetch(path, {
    ...requestInit,
    ...(signal ? { signal } : {}),
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers
    }
  });

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    // Empty success responses are valid. Errors use fallback message below.
  }
  if (!response.ok) {
    const record = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
    const message = typeof record.error === "string" ? record.error : "Request failed";
    throw new ApiError(message, response.status);
  }
  return data;
}
