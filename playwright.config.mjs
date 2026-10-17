// Tests de bout en bout CUTLY : Chrome installé sur la machine (aucun navigateur téléchargé),
// serveur local lancé sur une base SQLite jetable. Usage : npm run test:e2e
import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const port = 3100;
const dbPath = process.env.CUTLY_E2E_DB || path.join(mkdtempSync(path.join(tmpdir(), 'cutly-e2e-')), 'cutly.sqlite');
process.env.CUTLY_E2E_DB = dbPath;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${port}`, channel: 'chrome', trace: 'off', locale: 'fr-FR', timezoneId: 'Europe/Paris' },
  projects: [
    { name: 'iphone', use: { ...devices['iPhone 14'], browserName: 'chromium', channel: 'chrome' } },
    { name: 'ordinateur', use: { viewport: { width: 1440, height: 900 } } }
  ],
  webServer: {
    command: 'node server.js',
    url: `http://127.0.0.1:${port}/healthz`,
    reuseExistingServer: false,
    env: { PORT: String(port), CUTLY_HOST: '127.0.0.1', NODE_ENV: 'test', CUTLY_DB_PATH: dbPath, RESEND_API_KEY: '', CUTLY_DATABASE_URL: '', NETLIFY_DB_URL: '', DATABASE_URL: '' }
  }
});
