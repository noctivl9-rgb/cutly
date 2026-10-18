// Parcours e-mails de bout en bout : compte, vérification, bienvenue, mot de passe, réservation, décision de Thomas,
// annulation, suivi par webhook. Transport de test (fichier) : on vérifie ce que CUTLY envoie, pas la livraison par Resend.
import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { totp } = require('../lib/auth');
const BASE = 'http://127.0.0.1:3100';
const MAILS = process.env.CUTLY_E2E_MAILS;
const DB = process.env.CUTLY_E2E_DB;
const ADMIN = { email: 'thomas.e2e@cutly.test', password: 'Mot-de-passe-Thomas-2030' };
const CLIENT = { firstName: 'Sarah', lastName: 'Martin', email: 'sarah.e2e@cutly.test', phone: '+33612345001', password: 'Premier-mot-de-passe-2030' };
const NEW_PASSWORD = 'Second-mot-de-passe-2030';

const readMails = () => (fs.existsSync(MAILS) ? fs.readFileSync(MAILS, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : []);
async function waitForMail(to, subject, { since = 0, timeout = 15_000 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = readMails().slice(since).find(mail => mail.to === to && (subject instanceof RegExp ? subject.test(mail.subject) : mail.subject === subject));
    if (found) return found;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Aucun e-mail « ${subject} » pour ${to} (reçus : ${readMails().map(m => `${m.to}|${m.subject}`).join(' ; ') || 'aucun'})`);
}
const linkIn = (mail, pattern) => mail.html.match(pattern)?.[1].replace(/&amp;/g, '&');
const query = (sql, ...args) => { const db = new DatabaseSync(DB, { readOnly: true }); try { return db.prepare(sql).get(...args); } finally { db.close(); } };

test.describe.configure({ mode: 'serial' });

let adminSecret;
test.beforeAll(() => {
  // Premier administrateur (obligatoire avant toute inscription) ; le secret TOTP n'est affiché qu'une fois.
  const output = execFileSync(process.execPath, ['scripts/bootstrap-admin.js'], {
    env: { ...process.env, NODE_ENV: 'test', CUTLY_DB_PATH: DB, CUTLY_MFA_ENCRYPTION_KEY: process.env.CUTLY_E2E_MFA_KEY, CUTLY_BOOTSTRAP_ADMIN_EMAIL: ADMIN.email, CUTLY_BOOTSTRAP_ADMIN_PASSWORD: ADMIN.password },
    encoding: 'utf8'
  });
  adminSecret = output.match(/now: ([A-Z2-7]{32})/)[1];
});

test('inscription : e-mail de vérification, lien à usage unique, bienvenue envoyée une seule fois', async ({ page, context }) => {
  await page.addInitScript(() => localStorage.setItem('cutly-install-dismissed-v1', '1'));
  await page.goto('/account.html?mode=register&return=recap.html');
  await page.evaluate(() => sessionStorage.setItem('cutly-booking-v2', JSON.stringify({ serviceId: 'burst-fade', date: '2030-11-02', time: '11:00' })));
  for (const [name, value] of Object.entries({ firstName: CLIENT.firstName, lastName: CLIENT.lastName, email: CLIENT.email, phone: CLIENT.phone, password: CLIENT.password })) await page.locator(`#register-form [name=${name}]`).fill(value);
  await page.locator('#register-form [name=privacy]').check();
  await page.locator('#register-form button[type=submit]').click();
  await expect(page).toHaveURL(/mode=verify/);

  const verification = await waitForMail(CLIENT.email, 'Confirmez votre adresse e-mail — CUTLY');
  expect(verification.text).toMatch(/Bonjour Sarah,/);
  expect(verification.text).toMatch(/30 minutes/);
  const link = linkIn(verification, /href="(http:\/\/127\.0\.0\.1:3100\/account\.html\?verifyEmail=[^"]+)"/);
  expect(link).toBeTruthy();
  // Rien de « confirmé » ni de bienvenue avant le clic.
  expect(readMails().filter(m => m.to === CLIENT.email && /Bienvenue/.test(m.subject))).toHaveLength(0);
  expect(query('SELECT email_verified_at FROM users WHERE email=?', CLIENT.email).email_verified_at).toBeNull();

  // Le lien s'ouvre dans un autre onglet (comme depuis une messagerie) : la réservation en cours est reprise.
  const mailTab = await context.newPage();
  await mailTab.goto(link);
  await expect(mailTab).toHaveURL(/\/recap\.html$/);
  expect(query('SELECT email_verified_at FROM users WHERE email=?', CLIENT.email).email_verified_at).not.toBeNull();
  const draft = await mailTab.evaluate(() => JSON.parse(sessionStorage.getItem('cutly-booking-v2')));
  expect(draft).toMatchObject({ serviceId: 'burst-fade', date: '2030-11-02', time: '11:00' });

  await waitForMail(CLIENT.email, 'Bienvenue chez CUTLY');
  // Le même lien ne fonctionne qu'une fois, et ne relance pas de bienvenue.
  const replay = await context.request.post('/api/auth/client/verify-email', { headers: { origin: BASE }, data: { token: new URL(link).searchParams.get('verifyEmail') } });
  expect(replay.status()).toBe(400);
  await new Promise(resolve => setTimeout(resolve, 1500));
  expect(readMails().filter(m => m.to === CLIENT.email && /Bienvenue/.test(m.subject))).toHaveLength(1);
  // Le lien à usage unique ne reste pas dans l'historique en base.
  const row = query("SELECT payload_json,status,provider_status FROM notification_outbox WHERE kind='verify-email'");
  expect(row.payload_json).not.toMatch(/verifyEmail/);
  expect(row.status).toBe('SENT');
});

test('mot de passe oublié : e-mail, lien sécurisé, nouveau mot de passe, anciennes sessions révoquées', async ({ page, request }) => {
  const before = readMails().length;
  await page.goto('/account.html?mode=forgot');
  await page.locator('#reset-request-form [name=email]').fill(CLIENT.email);
  await page.locator('#reset-request-form button[type=submit]').click();
  await expect(page.locator('#reset-request-message')).toContainText('demande de récupération a été acceptée');
  // Une adresse inconnue reçoit la même réponse et aucun e-mail (pas de fuite d'existence de compte).
  const unknown = await request.post('/api/auth/client/password-reset', { headers: { origin: BASE }, data: { email: 'inconnu@cutly.test' } });
  expect(unknown.status()).toBe(202);

  const mail = await waitForMail(CLIENT.email, 'Réinitialisez votre mot de passe CUTLY', { since: before });
  expect(mail.text).toMatch(/ne vous demandera jamais votre mot de passe/);
  expect(mail.html + mail.text).not.toContain(CLIENT.password);
  await page.goto(linkIn(mail, /href="(http:\/\/127\.0\.0\.1:3100\/account\.html\?resetPassword=[^"]+)"/));
  await page.locator('#reset-confirm-form [name=password]').fill(NEW_PASSWORD);
  await page.locator('#reset-confirm-form button[type=submit]').click();
  await expect(page.locator('#reset-confirm-message')).toContainText('Mot de passe mis à jour');

  const stale = await request.post('/api/auth/client/login', { headers: { origin: BASE }, data: { email: CLIENT.email, password: CLIENT.password } });
  expect(stale.status()).toBe(401);
  const fresh = await request.post('/api/auth/client/login', { headers: { origin: BASE }, data: { email: CLIENT.email, password: NEW_PASSWORD } });
  expect(fresh.status()).toBe(200);
});

let adminRequest, clientRequest, firstId, secondId;
const SATURDAY = (() => { const day = new Date(Date.now() + 9 * 86400000); while (day.getUTCDay() !== 6) day.setUTCDate(day.getUTCDate() + 1); return day.toISOString().slice(0, 10); })();

test('réservation : demande reçue (client) et nouvelle demande (Thomas), jamais « confirmé » avant la décision', async ({ playwright }) => {
  clientRequest = await playwright.request.newContext({ baseURL: BASE, extraHTTPHeaders: { origin: BASE } });
  await clientRequest.post('/api/auth/client/login', { data: { email: CLIENT.email, password: NEW_PASSWORD } });
  const before = readMails().length;
  const booking = time => clientRequest.post('/api/bookings', { data: { serviceId: 'degrade-classique', date: SATURDAY, time, idempotencyKey: `e2e-mail-booking-${time.replace(":", "h")}-0001`, expectedPriceCents: 500, expectedDurationMinutes: 30 } });
  const first = await booking('15:00');
  expect(first.status(), await first.text()).toBe(201);
  firstId = (await first.json()).booking.id;
  const second = await booking('15:30');
  expect(second.status(), await second.text()).toBe(201);
  secondId = (await second.json()).booking.id;

  const received = await waitForMail(CLIENT.email, 'Votre demande de rendez-vous a été reçue — CUTLY', { since: before });
  expect(received.text).toMatch(/Bonjour Sarah,/);
  expect(received.text).toMatch(/Dégradé classique/);
  expect(received.text).toMatch(/Statut : En attente de validation par Thomas/);
  expect((received.html + received.text).replace(/pas encore confirmé/g, '')).not.toMatch(/confirmé/i);
  const toThomas = await waitForMail(ADMIN.email, 'Nouvelle demande de rendez-vous — CUTLY', { since: before });
  expect(toThomas.text).toMatch(/Sarah Martin/);
});

test('Thomas accepte une demande et en refuse une autre : e-mails adaptés, créneau refusé libéré', async ({ playwright }) => {
  adminRequest = await playwright.request.newContext({ baseURL: BASE, extraHTTPHeaders: { origin: BASE } });
  // Le code à 6 chiffres ne sert qu'une fois : on prend le premier pas encore utilisé de la fenêtre acceptée.
  const step = Math.floor(Date.now() / 30000) + 1;
  const login = await adminRequest.post('/api/auth/admin/login', { data: { email: ADMIN.email, password: ADMIN.password, otp: totp(adminSecret, step) } });
  expect(login.status()).toBe(200);
  const before = readMails().length;
  const decide = async (id, status) => {
    const { version } = query('SELECT version FROM appointments WHERE id=?', id);
    return adminRequest.patch(`/api/admin/appointments/${id}/status`, { data: { status, version, reason: 'Créneau indisponible' } });
  };
  expect((await decide(firstId, 'CONFIRMED')).status()).toBe(200);
  expect((await decide(secondId, 'REJECTED')).status()).toBe(200);

  const confirmed = await waitForMail(CLIENT.email, 'Votre rendez-vous est confirmé — CUTLY', { since: before });
  expect(confirmed.text).toMatch(/Statut : Confirmé par Thomas/);
  expect(confirmed.html).toMatch(/Voir mon rendez-vous/);
  expect(confirmed.html).toContain(`appointment.html?id=${firstId}`);
  const refused = await waitForMail(CLIENT.email, 'Mise à jour de votre demande — CUTLY', { since: before });
  expect(refused.html).toMatch(/Choisir un autre créneau/);
  expect(refused.text).not.toMatch(/est confirmé/);
  const day = await (await clientRequest.get(`/api/availability?service=degrade-classique&date=${SATURDAY}`)).json();
  expect(day.entries.find(entry => entry.time === '15:30').status).toBe('AVAILABLE');
  expect(day.entries.find(entry => entry.time === '15:00').status).toBe('OCCUPIED');
});

test('annulation par le client : e-mail adapté et rappels abandonnés', async () => {
  const before = readMails().length;
  const response = await clientRequest.post(`/api/client/appointments/${firstId}/cancellation`, { data: { reason: 'Empêchement' } });
  expect(response.status()).toBe(200);
  expect((await response.json()).type).toBe('CANCELLED');
  const mail = await waitForMail(CLIENT.email, 'Votre rendez-vous a été annulé — CUTLY', { since: before });
  expect(mail.html).toMatch(/Réserver à nouveau/);
  const reminders = query("SELECT COUNT(*) AS n FROM notification_outbox WHERE kind LIKE 'reminder:%' AND status IN ('PENDING','RETRYING')");
  expect(reminders.n).toBe(0);
});

test('suivi du fournisseur : webhook signé accepté, falsifié refusé, rejeu ignoré ; historique réservé à Thomas', async ({ playwright }) => {
  const row = query("SELECT id,provider_message_id FROM notification_outbox WHERE kind='appointment_status:CONFIRMED'");
  expect(row.provider_message_id).toMatch(/^file-/);
  const secret = process.env.CUTLY_E2E_WEBHOOK_SECRET;
  const body = JSON.stringify({ type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: row.provider_message_id, to: [CLIENT.email] } });
  const id = `msg_${crypto.randomUUID()}`, timestamp = String(Math.floor(Date.now() / 1000));
  const sign = value => 'v1,' + crypto.createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64')).update(`${id}.${timestamp}.${value}`).digest('base64');
  const anonymous = await playwright.request.newContext({ baseURL: BASE });
  const send = (signature, payload = body) => anonymous.post('/api/webhooks/resend', { headers: { 'content-type': 'application/json', 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': signature }, data: payload });

  expect((await send('v1,faux')).status()).toBe(401);
  expect((await send(sign(body), body.replace('delivered', 'bounced'))).status()).toBe(401);
  const accepted = await send(sign(body));
  expect(accepted.status()).toBe(200);
  expect(query('SELECT provider_status FROM notification_outbox WHERE id=?', row.id).provider_status).toBe('DELIVERED');
  expect((await (await send(sign(body))).json()).duplicate).toBe(true);

  expect((await anonymous.get('/api/admin/notifications')).status()).toBe(401);
  const list = await (await adminRequest.get('/api/admin/notifications')).json();
  expect(list.provider).toBe('TEST_TRANSPORT');
  expect(list.notifications.find(item => item.id === row.id).providerStatus).toBe('DELIVERED');
  expect(JSON.stringify(list)).not.toMatch(/sarah\.e2e|payload|verifyEmail/);
});

test('e-mail de test depuis l’administration : envoyé à l’administrateur, refusé sans session', async ({ playwright }) => {
  const anonymous = await playwright.request.newContext({ baseURL: BASE, extraHTTPHeaders: { origin: BASE } });
  expect((await anonymous.post('/api/admin/email-test', { data: {} })).status()).toBe(401);
  const before = readMails().length;
  const response = await adminRequest.post('/api/admin/email-test', { data: {} });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({ status: 'ACCEPTED', provider: 'file-test' });
  expect(body.to).not.toContain(ADMIN.email);
  const mail = await waitForMail(ADMIN.email, 'Test d’envoi — CUTLY', { since: before });
  expect(mail.text).toMatch(/l’envoi des e-mails fonctionne/);
});
