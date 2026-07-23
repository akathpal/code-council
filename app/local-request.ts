const LOCAL_API = "/local-api";

export async function localRequest<T>(
  requestPath: string,
  options?: RequestInit,
) {
  const response = await fetch(`${LOCAL_API}${requestPath}`, {
    ...options,
    headers: { "content-type": "application/json", ...options?.headers },
  });
  const body = await response.text();
  if (!body.trim()) {
    throw new Error(
      response.ok
        ? "The local companion returned an empty response."
        : `The local companion is unavailable (HTTP ${response.status}).`,
    );
  }

  let payload: T & { error?: string };
  try {
    payload = JSON.parse(body) as T & { error?: string };
  } catch {
    throw new Error(
      `The local companion returned invalid JSON (HTTP ${response.status}).`,
    );
  }
  if (!response.ok) throw new Error(payload.error ?? "Local request failed.");
  return payload;
}
