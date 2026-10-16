// SignGuy Slim service worker: never cache private app/API responses.
const CACHE = "signguy-slim-v1";
const STATIC_ASSETS = ["/manifest.webmanifest"];

function isPrivateRequest(requestUrl) {
  return requestUrl.origin !== self.location.origin
    || requestUrl.pathname.startsWith("/api/")
    || requestUrl.pathname === "/"
    || requestUrl.pathname.startsWith("/platform")
    || requestUrl.pathname.endsWith(".html");
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(STATIC_ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (isPrivateRequest(url)) return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request).then((response) => {
        if (response.headers.get("Cache-Control")?.includes("no-store")) return response;
        if (response && response.status === 200 && response.type === "basic") {
          const clone = response.clone();
          caches.open(CACHE).then((c) => c.put(event.request, clone));
        }
        return response;
      }).catch(() => cached || Response.error());
      return cached || network;
    })
  );
});
