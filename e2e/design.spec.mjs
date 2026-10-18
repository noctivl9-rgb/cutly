// Direction artistique : accessibilité automatisable (axe-core), aucun débordement horizontal (320 px compris),
// barre de verre présente partout, planche photographique décorative, fidélité fondée sur les vraies données.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';

const BASE = 'http://127.0.0.1:3100';
const PUBLIC_PAGES = ['/', '/services.html', '/shop.html', '/booking.html', '/calendar.html', '/account.html', '/terms.html'];
const CLIENT_PAGES = ['/appointments.html', '/loyalty.html', '/profile.html'];

function seedClient(points) {
  const db = new DatabaseSync(process.env.CUTLY_E2E_DB);
  try {
    const now = new Date().toISOString(), id = crypto.randomUUID();
    db.prepare("INSERT INTO users(id,email,phone,first_name,last_name,password_hash,email_verified_at,role,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'CLIENT',?,?)")
      .run(id, `design.${id}@cutly.test`, `+3361${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`, 'Design', 'E2E', 'no-login', now, now, now);
    for (let i = 0; i < points; i++) db.prepare("INSERT INTO loyalty_ledger(id,user_id,appointment_id,kind,points,cycle_number,actor_id,reason,created_at) VALUES(?,?,NULL,'CORRECTION',1,1,NULL,'test',?)").run(crypto.randomUUID(), id, now);
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions(id_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').run(crypto.createHash('sha256').update(token).digest('hex'), id, now, new Date(Date.now() + 3600e3).toISOString());
    return token;
  } finally { db.close(); }
}

test.beforeEach(async ({ page }) => { await page.addInitScript(() => localStorage.setItem('cutly-install-dismissed-v1', '1')); });

async function audit(page, path) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  // Les titres se révèlent mot à mot : on attend la fin de l'animation avant de mesurer les contrastes.
  await page.waitForTimeout(1200);
  // Accueil (hors périmètre de la refonte) : les mots du manifeste s’allument au défilement ; à mi-parcours leur opacité est volontairement basse.
  const results = await new AxeBuilder({ page }).exclude('section[aria-labelledby="manifesto-title"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = results.violations.filter(v => ['serious', 'critical'].includes(v.impact));
  expect(serious.map(v => `${v.id} : ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`), `${path}`).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `${path} déborde`).toBeLessThanOrEqual(0);
}

for (const path of PUBLIC_PAGES) test(`accessibilité et mise en page : ${path}`, async ({ page }) => audit(page, path));

test('espace client : accessibilité, mise en page et fidélité réelle (4 / 10)', async ({ page, context }) => {
  await context.addCookies([{ name: 'cutly_session', value: seedClient(4), url: BASE, httpOnly: true, sameSite: 'Strict' }]);
  for (const path of CLIENT_PAGES) await audit(page, path);
  await page.goto('/loyalty.html');
  await expect(page.locator('.loyalty-count')).toHaveText('4/ 10');
  await expect(page.locator('.loyalty-stamps span.is-earned')).toHaveCount(4);
  await expect(page.locator('.loyalty-stamps')).toHaveAttribute('aria-label', '4 prestations éligibles sur 10');
  await expect(page.locator('.loyalty-note')).toContainText('Encore 6 prestations');
});

test('verre et planches : barre présente partout, photographie décorative, petit écran 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const path of ['/services.html', '/shop.html', '/slots.html', '/account.html']) {
    await page.goto(path);
    await expect(page.locator('.topbar-glass')).toBeVisible();
    if (path !== '/slots.html' || await page.locator('.scene').count()) await expect(page.locator('.scene')).toHaveAttribute('aria-hidden', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `${path} à 320 px`).toBeLessThanOrEqual(0);
    // La barre ne recouvre pas le titre de la page.
    const [bar, title] = await Promise.all([page.locator('.topbar').boundingBox(), page.locator('main h1').first().boundingBox()]);
    if (title) expect(title.y, `${path} : titre sous la barre`).toBeGreaterThanOrEqual(bar.y + bar.height);
  }
});
