const API_ROOT = "/api";
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export class ApiError extends Error {
  constructor(message, status, detail = {}) {
    super(message);
    this.status = status;
    Object.assign(this, detail);
  }
}

export async function apiRequest(path, { method = "GET", body, csrfToken, onUnauthorized } = {}) {
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
      // Preserve the status text when the server returns a non-JSON error.
    }
    if (response.status === 401) onUnauthorized?.();
    throw new ApiError(detail, response.status, parsed);
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return response.blob();
  return response.json();
}

export async function downloadApiFile(path, { filename, method = "GET", body, csrfToken, onUnauthorized }) {
  const blob = await apiRequest(path, { method, body, csrfToken, onUnauthorized });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function uploadApiFile(path, { file, fields = {}, csrfToken, onUnauthorized }) {
  const body = new FormData();
  body.append("file", file);
  for (const [key, value] of Object.entries(fields)) body.append(key, value ?? "");
  const response = await fetch(`${API_ROOT}${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
    },
    body,
  });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      detail = (await response.json()).error || detail;
    } catch {
      // Preserve status text for non-JSON upload failures.
    }
    if (response.status === 401) onUnauthorized?.();
    throw new ApiError(detail, response.status);
  }
  return response.json();
}

export async function blobApiFile(path, { onUnauthorized } = {}) {
  const response = await fetch(`${API_ROOT}${path}`, {
    credentials: "include",
  });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      detail = (await response.json()).error || detail;
    } catch {
      // Preserve status text for non-JSON Blob failures.
    }
    if (response.status === 401) onUnauthorized?.();
    throw new ApiError(detail, response.status);
  }
  return {
    blob: await response.blob(),
    filename: response.headers.get("content-disposition") || "",
    mime_type: response.headers.get("content-type") || "",
  };
}

export function cents(value) {
  return Math.round(Number(value || 0) * 100);
}

export function money(centsValue, currency = "USD", locale = "en-US") {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format((centsValue || 0) / 100);
}
