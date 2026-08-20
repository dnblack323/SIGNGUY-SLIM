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
  if (contentType.includes("application/pdf")) return response.blob();
  return response.json();
}

export async function downloadApiFile(path, { token, filename }) {
  const blob = await apiRequest(path, { token });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function cents(value) {
  return Math.round(Number(value || 0) * 100);
}

export function money(centsValue, currency = "USD", locale = "en-US") {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format((centsValue || 0) / 100);
}
