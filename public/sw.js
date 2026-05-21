self.addEventListener('push', event => {
  // Options par défaut si le texte ne peut pas être lu
  let title = 'INDSENEWS Flash';
  let body = 'Une nouvelle information vient de tomber !';
  let url = '/';

  if (event.data) {
    try {
      // On tente de lire le JSON
      const data = event.data.json();
      title = data.title || title;
      body = data.body || body;
      url = data.url || url;
    } catch (e) {
      // Si ce n'est pas du JSON, on prend le texte brut reçu
      body = event.data.text();
    }
  }

  const options = {
    body: body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    vibrate: [100, 50, 100],
    data: { url: url }
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data.url)
  );
});
