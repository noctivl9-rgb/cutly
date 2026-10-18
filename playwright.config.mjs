// Tests de bout en bout CUTLY : Chrome installé sur la machine (aucun navigateur téléchargé),
// serveur local lancé sur une base SQLite jetable. Usage : npm run test:e2e
// Les e-mails passent par le transport de test (fichier) : ils prouvent le parcours CUTLY, pas la livraison réelle.
import { defineConfig, devices } from '@playwright/test';
import crypto from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const port = 3100;
// Les workers relisent cette configuration : les valeurs sont fixées une seule fois dans l'environnement du processus principal.
const work = process.env.CUTLY_E2E_DIR || mkdtempSync(path.join(tmpdir(), 'cutly-e2e-'));
process.env.CUTLY_E2E_DIR = work;
process.env.CUTLY_E2E_DB ||= path.join(work, 'cutly.sqlite');
process.env.CUTLY_E2E_MAILS ||= path.join(work, 'mails.jsonl');
process.env.CUTLY_E2E_MFA_KEY ||= crypto.randomBytes(32).toString('base64');
process.env.CUTLY_E2E_WEBHOOK_SECRET ||= 'whsec_' + crypto.randomBytes(24).toString('base64');

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${port}`, channel: 'chrome', trace: 'off', locale: 'fr-FR', timezoneId: 'Europe/Paris' },
  projects: [
    { name: 'iphone', use: { ...devices['iPhone 14'], browserName: 'chromium', channel: 'chrome' } },
    // Les scénarios d'e-mails (une connexion administrateur avec code à usage unique) ne tournent qu'une fois.
    { name: 'ordinateur', testIgnore: /emails\.spec/, use: { viewport: { width: 1440, height: 900 } } }
  ],
  webServer: {
    command: 'node server.js',
    url: `http://127.0.0.1:${port}/healthz`,
    reuseExistingServer: false,
    env: {
      PORT: String(port), CUTLY_HOST: '127.0.0.1', NODE_ENV: 'test', CUTLY_DB_PATH: process.env.CUTLY_E2E_DB,
      CUTLY_MFA_ENCRYPTION_KEY: process.env.CUTLY_E2E_MFA_KEY, CUTLY_PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
      CUTLY_EMAIL_TRANSPORT: 'file', CUTLY_EMAIL_OUTBOX_FILE: process.env.CUTLY_E2E_MAILS, CUTLY_OUTBOX_INTERVAL_MS: '500',
      RESEND_WEBHOOK_SECRET: process.env.CUTLY_E2E_WEBHOOK_SECRET, RESEND_API_KEY: '', CUTLY_EMAIL_FROM: '',
      CUTLY_DATABASE_URL: '', NETLIFY_DB_URL: '', DATABASE_URL: ''
    }
  }
});
