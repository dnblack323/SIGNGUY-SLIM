const API_ROOT = "/api/platform";
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export class PlatformApiError extends Error {
  constructor(message, status, detail = {}) {
    super(message);
    this.status = status;
    Object.assign(this, detail);
  }
}

export async function platformFetch(path, { method = "GET", body, csrfToken } = {}) {
  const upperMethod = method.toUpperCase();
  const response = await fetch(`${API_ROOT}${path}`, {
    method,
    credentials: "include",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(csrfToken && UNSAFE_METHODS.has(upperMethod) ? { "X-CSRF-Token": csrfToken } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    let detail = response.statusText;
    let parsed = {};
    try {
      parsed = await response.json();
      detail = parsed.error || detail;
    } catch {
      // Preserve status text for non-JSON errors.
    }
    throw new PlatformApiError(detail, response.status, parsed);
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return response.blob();
  return response.json();
}
