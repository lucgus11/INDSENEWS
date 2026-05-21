const express = require('express');
const webpush = require('web-push');
const path = require('path');
const { kv } = require('@vercel/kv');

const app = express();

// Permet de lire le format JSON envoyé dans les requêtes
app.use(express.json());

// Sert les fichiers statiques du dossier 'public' (index.html, admin.html, manifest.json, sw.js)
app.use(express.static(path.join(__dirname, 'public')));

// Configuration VAPID récupérée depuis les variables d'environnement Vercel
const publicVapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const privateVapidKey = process.env.VAPID_PRIVATE_KEY;
const vapidEmail = process.env.VAPID_EMAIL || 'mailto:contact@indsenews.com';

if (publicVapidKey && privateVapidKey) {
  webpush.setVapidDetails(vapidEmail, publicVapidKey, privateVapidKey);
} else {
  console.warn("Attention : Les clés VAPID ne sont pas configurées dans l'environnement Vercel.");
}

/**
 * 1. ROUTE : Fournir la clé publique au frontend
 * Permet au client de s'abonner sans avoir à écrire la clé en dur dans le code HTML.
 */
app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: publicVapidKey });
});

/**
 * 2. ROUTE : Enregistrer un nouvel abonné
 * Stocke l'objet de souscription généré par le navigateur dans Vercel KV.
 */
app.post('/api/subscribe', async (req, res) => {
  const subscription = req.body;
  
  try {
    // Récupère la liste existante des abonnés ou crée un tableau vide si elle n'existe pas
    let subscriptions = (await kv.get('indsenews_subs')) || [];
    
    // Évite les doublons si le même appareil tente de se réabonner
    if (!subscriptions.some(sub => sub.endpoint === subscription.endpoint)) {
      subscriptions.push(subscription);
      await kv.set('indsenews_subs', subscriptions);
    }
    
    res.status(201).json({ success: true });
  } catch (err) {
    console.error("Erreur d'inscription KV :", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 3. ROUTE : Envoyer un flash info en direct (Espace Admin)
 * Valide le code secret et envoie la notification push à tous les terminaux enregistrés.
 */
app.post('/api/broadcast', async (req, res) => {
  const { password, title, body, url } = req.body;

  // Sécurité : Vérification du code secret défini sur Vercel
  if (!password || password !== process.env.ADMIN_SECRET_CODE) {
    return res.status(403).json({ error: "Accès refusé : Code secret invalide." });
  }

  // Structure du message envoyé au Service Worker
  const payload = JSON.stringify({
    title: title || 'INDSENEWS Flash',
    body: body || 'Une information de dernière minute est disponible.',
    url: url || '/'
  });

  try {
    // Récupération de tous les abonnés depuis la base KV
    let subscriptions = (await kv.get('indsenews_subs')) || [];
    let validSubscriptions = [...subscriptions];

    // Création d'un tableau de promesses pour envoyer à tout le monde en parallèle
    const pushPromises = subscriptions.map(subscription => {
      return webpush.sendNotification(subscription, payload)
        .catch(async (err) => {
          // Si le code d'erreur indique que l'abonnement a expiré ou a été révoqué (désinstallation)
          if (err.statusCode === 410 || err.statusCode === 404) {
            // On filtre le tableau pour retirer cet abonné obsolète
            validSubscriptions = validSubscriptions.filter(sub => sub.endpoint !== subscription.endpoint);
          }
        });
    });

    // Attend la fin des envois
    await Promise.all(pushPromises);
    
    // Met à jour la base de données Vercel KV pour supprimer définitivement les anciens abonnés
    await kv.set('indsenews_subs', validSubscriptions);

    res.json({ 
      success: true, 
      message: `Notification envoyée avec succès à ${validSubscriptions.length} appareils.` 
    });
  } catch (err) {
    console.error("Erreur de diffusion :", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Export requis pour que Express fonctionne correctement avec l'architecture Serverless de Vercel
module.exports = app;
