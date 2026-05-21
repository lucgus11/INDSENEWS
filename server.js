const express = require('express');
const webpush = require('web-push');
const path = require('path');
const { kv } = require('@vercel/kv');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configuration VAPID via les variables d'environnement Vercel
const publicVapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const privateVapidKey = process.env.VAPID_PRIVATE_KEY;
const vapidEmail = process.env.VAPID_EMAIL || 'mailto:contact@indsenews.com';

if (publicVapidKey && privateVapidKey) {
  webpush.setVapidDetails(vapidEmail, publicVapidKey, privateVapidKey);
}

// Route pour transmettre la clé publique au client
app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: publicVapidKey });
});

// Enregistrement d'un abonné dans Vercel KV
app.post('/api/subscribe', async (req, res) => {
  const subscription = req.body;
  
  try {
    // Récupérer la liste existante ou créer un tableau vide
    let subscriptions = (await kv.get('indsenews_subs')) || [];
    
    // Vérifier si l'abonné existe déjà
    if (!subscriptions.some(sub => sub.endpoint === subscription.endpoint)) {
      subscriptions.push(subscription);
      await kv.set('indsenews_subs', subscriptions);
    }
    
    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Envoi d'une notification en direct à tous les abonnés stockés
app.post('/api/broadcast', async (req, res) => {
  const { title, body, url } = req.body;

  const payload = JSON.stringify({
    title: title || 'INDSENEWS Flash',
    body: body || 'Une information de dernière minute est disponible.',
    url: url || '/'
  });

  try {
    let subscriptions = (await kv.get('indsenews_subs')) || [];
    let validSubscriptions = [...subscriptions];

    const pushPromises = subscriptions.map(subscription => {
      return webpush.sendNotification(subscription, payload)
        .catch(async (err) => {
          // Si l'abonnement n'est plus valide (désinstallé / expiré), on le marque pour suppression
          if (err.statusCode === 410 || err.statusCode === 404) {
            validSubscriptions = validSubscriptions.filter(sub => sub.endpoint !== subscription.endpoint);
          }
        });
    });

    await Promise.all(pushPromises);
    
    // Mettre à jour la base de données en retirant les abonnés invalides
    await kv.set('indsenews_subs', validSubscriptions);

    res.json({ success: true, message: `Notification envoyée à ${validSubscriptions.length} abonnés.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = app;
