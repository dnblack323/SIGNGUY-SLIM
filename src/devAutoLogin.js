export async function ensureDevAutoLogin() {
  if (!import.meta.env.DEV) return;

  try {
    const existing = await fetch("/api/auth/me", { credentials: "include" });
    if (existing.ok || existing.status !== 401) return;

    await fetch("/__signguy-slim-dev-auto-login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  } catch {
    // Development convenience only. Normal login remains available when this fails.
  }
}
