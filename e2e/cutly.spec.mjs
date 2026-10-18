// Parcours CUTLY de bout en bout, sur iPhone et sur ordinateur (voir playwright.config.mjs).
import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';

const BASE = 'http://127.0.0.1:3100';
const fmt = (options, date) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', ...options }).format(date);

// Prochain samedi situé au moins deux jours plus tard (aucun créneau passé).
function nextSaturday() {
  const day = new Date(Date.now() + 2 * 86400000);
  while (fmt({ weekday: 'long' }, day) !== 'samedi') day.setTime(day.getTime() + 86400000);
  return new Date(day.toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }) + 'T12:00:00Z');
}
const SATURDAY = nextSaturday();
const DATE = SATURDAY.toISOString().slice(0, 10);
const DAY_LABEL = fmt({ weekday: 'long', day: 'numeric', month: 'long' }, SATURDAY);

// Comptes vérifiés créés directement dans la base jetable, avec une session par compte.
function seedAccount(email, phone) {
  const db = new DatabaseSync(process.env.CUTLY_E2E_DB);
  try {
    const now = new Date().toISOString();
    const existing = db.prepare('SELECT id FROM users WHERE email=?').get(email);
    const id = existing?.id ?? crypto.randomUUID();
    if (!existing) db.prepare("INSERT INTO users(id,email,phone,first_name,last_name,password_hash,email_verified_at,role,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'CLIENT',?,?)")
      .run(id, email, phone, 'Client', 'E2E', 'e2e-no-password-login', now, now, now);
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions(id_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)')
      .run(crypto.createHash('sha256').update(token).digest('hex'), id, now, new Date(Date.now() + 3600e3).toISOString());
    return token;
  } finally { db.close(); }
}
const cookie = token => ({ name: 'cutly_session', value: token, url: BASE, httpOnly: true, sameSite: 'Strict' });

test.describe.configure({ mode: 'serial' });

let clientToken, otherToken, myTime;
test.beforeAll(async ({ request }, testInfo) => {
  const suffix = testInfo.project.name;
  clientToken = seedAccount(`client.${suffix}@cutly.test`, suffix === 'iphone' ? '+33600000101' : '+33600000102');
  otherToken = seedAccount(`autre.${suffix}@cutly.test`, suffix === 'iphone' ? '+33600000201' : '+33600000202');
  myTime = suffix === 'iphone' ? '11:00' : '12:00';
  // Un autre client occupe 10:00 (Burst Fade, 30 min) : ce créneau doit apparaître « occupé ».
  await request.post('/api/bookings', {
    headers: { cookie: `cutly_session=${otherToken}`, origin: BASE },
    data: { serviceId: 'burst-fade', date: DATE, time: '10:00', idempotencyKey: `e2e-other-${DATE}`, expectedPriceCents: 700, expectedDurationMinutes: 30 }
  });
});

test('accueil : île CUTLY et action de réservation évidente', async ({ page }, testInfo) => {
  await page.goto('/');
  // Première visite : le guide d'installation s'ouvre ; il se ferme discrètement et ne revient pas.
  const install = page.locator('#install-dialog');
  await expect(install).toBeVisible();
  await page.getByRole('button', { name: 'Fermer le guide d’installation' }).click();
  await expect(install).toBeHidden();
  await expect(page.locator('.island-logo')).toHaveText('CUTLY');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Coupe nette.');
  const cta = testInfo.project.name === 'iphone' ? page.locator('.hero-cta-mobile .button') : page.locator('.island-cta');
  await expect(cta).toBeVisible();
  await cta.click();
  await expect(page).toHaveURL(/\/booking\.html$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Quelle coupe ?');
});

test('réservation complète : créneaux occupés visibles et non sélectionnables, demande retrouvée', async ({ page, context }) => {
  await context.addCookies([cookie(clientToken)]);
  await page.goto('/booking.html');
  await page.getByRole('button', { name: /Taper/ }).click();
  await page.getByRole('button', { name: /Choisir une date/ }).click();
  await expect(page).toHaveURL(/calendar\.html/);
  const day = page.locator(`button[aria-label^="${DAY_LABEL}"]`);
  await page.locator('.calendar-day').first().waitFor();
  if (!(await day.count())) { await page.getByRole('button', { name: 'Mois suivant' }).click(); await page.locator('.calendar-day').first().waitFor(); }
  await day.click();
  await page.getByRole('button', { name: /Voir les horaires/ }).click();
  await expect(page).toHaveURL(/slots\.html/);
  // Départs toutes les 30 minutes : le créneau de 10:00 est occupé, les départs à 09:45, 10:15… n'existent pas.
  await expect(page.getByRole('button', { name: '10:00, occupé' })).toBeDisabled();
  for (const time of ['09:15', '09:45', '10:15', '13:15']) await expect(page.getByRole('button', { name: new RegExp(`^${time},`) })).toHaveCount(0);
  await page.getByRole('button', { name: `${myTime}, disponible` }).click();
  await expect(page.getByRole('button', { name: `${myTime}, sélectionné` })).toBeVisible();
  await page.getByRole('button', { name: /^Continuer/ }).click();
  await expect(page).toHaveURL(/recap\.html/);
  await expect(page.locator('#recap')).toContainText(myTime);
  await expect(page.locator('#send')).toBeEnabled();
  await page.locator('#send').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Votre demande a été envoyée');
  await expect(page.getByText('En attente de confirmation par Thomas')).toBeVisible();
  await page.getByRole('link', { name: 'Voir mon rendez-vous' }).click();
  await expect(page.locator('#appointment-detail')).toContainText('En attente de Thomas');
  await page.goto('/appointments.html?filter=pending');
  await expect(page.locator('#appointments-list')).toContainText('Taper');
});

test('double réservation du même créneau refusée par le serveur', async ({ request }) => {
  const response = await request.post('/api/bookings', {
    headers: { cookie: `cutly_session=${otherToken}`, origin: BASE },
    data: { serviceId: 'taper', date: DATE, time: myTime, idempotencyKey: `e2e-double-${myTime}`, expectedPriceCents: 500, expectedDurationMinutes: 30 }
  });
  expect(response.status()).toBe(409);
  expect((await response.json()).error).toBe('slot_unavailable');
});

test('Conditions générales ouvertes depuis le récapitulatif, retour sans perte de la sélection', async ({ page, context }) => {
  await context.addCookies([cookie(clientToken)]);
  await page.addInitScript(([date]) => { if (!sessionStorage.getItem('cutly-booking-v2')) sessionStorage.setItem('cutly-booking-v2', JSON.stringify({ serviceId: 'contours', date, time: '16:30' })); }, [DATE]);
  await page.goto('/recap.html');
  await expect(page.locator('#recap')).toContainText('16:30');
  await page.locator('.recap-legal').getByRole('link', { name: 'Conditions générales' }).click();
  await expect(page).toHaveURL(/terms\.html\?return=recap\.html/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Conditions générales');
  await page.getByRole('link', { name: /Retour au récapitulatif/ }).click();
  await expect(page).toHaveURL(/recap\.html/);
  await expect(page.locator('#recap')).toContainText('16:30');
  await expect(page.locator('#recap')).toContainText('Contours');
});

test('navigation : île (iPhone) et barre d’onglets', async ({ page, context }, testInfo) => {
  await context.addCookies([cookie(clientToken)]);
  await page.goto('/appointments.html');
  if (testInfo.project.name === 'iphone') {
    await expect(page.locator('.bottom-nav a[aria-current="page"]')).toHaveText('Rendez-vous');
    const toggle = page.locator('[data-island-toggle]');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[data-island-status]')).toHaveText(/^(Ouvert|Fermé)/);
    await expect(page.locator('.island-panel-links')).toContainText('Conditions générales');
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  } else {
    await expect(page.locator('.bottom-nav')).toBeHidden();
    await expect(page.locator('.island-links a[aria-current="page"]')).toHaveText('Rendez-vous');
  }
});

test('déconnexion : la session est révoquée', async ({ page, context }) => {
  await context.addCookies([cookie(clientToken)]);
  await page.goto('/settings.html');
  await page.locator('#account-logout').click();
  await expect(page).toHaveURL(/account\.html/);
  const profile = await page.request.get('/api/client/profile');
  expect(profile.status()).toBe(401);
});
