// TaxiLive Service Worker — Web-Push für Fahrer-Benachrichtigungen.
// Läuft auch, wenn die App im Hintergrund/Tab inaktiv oder geschlossen ist,
// und zeigt eine Benachrichtigung bei neuen Fahrtangeboten.

self.addEventListener("install", (event) => {
  // Sofort aktiv werden, ohne auf das Schließen alter Tabs zu warten.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "TaxiLive", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "🚕 Neue Fahrtanfrage";
  const options = {
    body: data.body || "",
    tag: data.tag || "taxilive",
    renotify: true,
    requireInteraction: true,
    vibrate: [200, 100, 200],
    icon: "/logo.png",
    badge: "/logo.png",
    data: { url: data.url || "/fahrer", ...(data.data || {}) },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/fahrer";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Bereits offenes Fahrer-Fenster fokussieren, sonst neues öffnen.
      for (const client of clients) {
        if (client.url.includes("/fahrer") && "focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});
