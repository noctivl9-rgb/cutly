// Tâche planifiée CUTLY : envoie les e-mails en attente (rappels 24 h et 2 h, reprises après une panne du fournisseur).
// Les e-mails immédiats (compte, demande reçue, confirmation…) partent déjà juste après la requête qui les crée (api.mjs).
//
// Fréquence : toutes les 30 minutes, du vendredi au dimanche de 05 h à 17 h (UTC), c'est-à-dire les jours où Thomas
// reçoit (samedi et dimanche, 09 h–19 h) et la veille pour les rappels de 24 h. Cela limite les réveils de la base
// Netlify (quota de calcul du plan gratuit). Si Thomas ouvre d'autres jours, élargir ce créneau (cron ci-dessous).
import { createRequire } from 'node:module';
import { loadCutlyEnv } from '../runtime/env.mjs';

const require = createRequire(import.meta.url);
loadCutlyEnv();

const { databaseReady, db } = require('../../server.js');
const { processOutbox } = require('../../lib/notifications.js');

export default async () => {
  await databaseReady;
  const result = await processOutbox(db, { limit: 25 });
  // Journal sans donnée personnelle : seulement des compteurs.
  console.log(JSON.stringify({ job: 'send-notifications', ...result }));
};

export const config = { schedule: '*/30 5-17 * * 5,6,0' };
