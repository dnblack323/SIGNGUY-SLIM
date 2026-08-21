const API_ROOT = "/api";

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function apiRequest(path, { token, method = "GET", body } = {}) {
  const response = await fetch(`${API_ROOT}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      detail = (await response.json()).error || detail;
    } catch {
      // Preserve the status text when the server returns a non-JSON error.
    }
    throw new ApiError(detail, response.status);
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return response.blob();
  return response.json();
}

export async function downloadApiFile(path, { token, filename, method = "GET", body }) {
  const blob = await apiRequest(path, { token, method, body });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function uploadApiFile(path, { token, file, fields = {} }) {
  const body = new FormData();
  body.append("file", file);
  for (const [key, value] of Object.entries(fields)) body.append(key, value ?? "");
  const response = await fetch(`${API_ROOT}${path}`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
    throw new ApiError(detail, response.status);
  }
  return response.json();
}

export async function blobApiFile(path, { token }) {
  const response = await fetch(`${API_ROOT}${path}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      detail = (await response.json()).error || detail;
    } catch {
      // Preserve status text for non-JSON Blob failures.
    }
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
