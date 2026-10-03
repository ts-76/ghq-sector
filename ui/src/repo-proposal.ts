import type { JsonValue } from "@visual-json/core";

/** Return a proposed draft; adding a repo never saves the config. */
export async function requestRepoProposal(
  config: JsonValue,
  repo: unknown,
  send: typeof fetch = fetch,
): Promise<JsonValue> {
  const response = await send("/api/repos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ config, repo }),
  });
  const payload = (await response.json()) as {
    ok?: boolean;
    value?: JsonValue;
    message?: string;
  };
  if (!response.ok || payload.ok !== true || payload.value === undefined) {
    throw new Error(payload.message ?? "Failed to propose repo draft");
  }
  return payload.value;
}
