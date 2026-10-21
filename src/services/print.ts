// Production des supports physiques : QR codes (PNG, SVG) et planches A4 (PDF vectoriel).
import QRCode from 'qrcode';
import PDFDocument from 'pdfkit';
import type { Query } from '../db.ts';
import { HttpError } from '../http.ts';
import { loadVersion } from './scenarios.ts';

export interface PrintResource { id: string; kind: string; key: string; ref: string; title: string; classification: string; url: string; scenario: string; caseNumber: string }

const CLASSIFICATION: Record<string, string> = {
  lieu: 'LIEU', indice: 'PIÈCE À CONVICTION', temoignage: 'TÉMOIGNAGE', document: 'DOCUMENT', enveloppe: 'ENVELOPPE SCELLÉE', evenement: 'ÉVÉNEMENT',
};

export function publicBaseUrl() {
  return (process.env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
}

/** Le domaine est-il prêt pour une impression définitive ? */
export function domainStatus() {
  const base = publicBaseUrl();
  const problems: string[] = [];
  let host = '';
  try {
    const u = new URL(base);
    host = u.hostname;
    if (u.protocol !== 'https:') problems.push("L'adresse publique doit utiliser HTTPS.");
    if (/^(localhost|127\.|10\.|192\.168\.|\[::1\])/.test(host) || host.endsWith('.local')) problems.push('Adresse locale : les QR codes ne fonctionneraient pas sur les téléphones des joueurs.');
    if (/--|deploy-preview|\.ngrok|\.trycloudflare\.com|\.loca\.lt/.test(host)) problems.push('Adresse temporaire de prévisualisation ou de tunnel.');
  } catch {
    problems.push("Aucune adresse publique valide n'est configurée (PUBLIC_BASE_URL).");
  }
  if (process.env.PRINT_DOMAIN_CONFIRMED !== 'true') problems.push("Le domaine définitif n'est pas confirmé (PRINT_DOMAIN_CONFIRMED=true).");
  return { base: base || null, host, final: problems.length === 0, problems };
}

export function resourceUrl(kind: string, key: string, base = publicBaseUrl()) {
  return `${base || 'https://domaine-a-configurer.invalid'}/q/${kind}/${encodeURIComponent(key)}`;
}

export async function listResources(q: Query, scenarioId?: string): Promise<PrintResource[]> {
  const rows = await q(
    `select r.*, s.slug, s.case_number,
       (select v.id from scenario_versions v where v.scenario_id = r.scenario_id and v.status = 'published' order by v.version desc limit 1) as version_id
     from resources r join scenarios s on s.id = r.scenario_id
     ${scenarioId ? 'where r.scenario_id = $1' : ''} order by s.case_number, r.kind, r.key`,
    scenarioId ? [scenarioId] : [],
  );
  const out: PrintResource[] = [];
  for (const r of rows) {
    let title = r.ref;
    if (r.version_id) {
      const c = await loadVersion(q, r.version_id);
      title =
        c.locations.find((x) => x.ref === r.ref)?.name ??
        c.items.find((x) => x.ref === r.ref)?.title ??
        c.envelopes.find((x) => x.ref === r.ref)?.title ??
        c.events.find((x) => x.ref === r.ref)?.title ??
        `${r.ref} (absent de la dernière version)`;
    }
    out.push({ id: r.id, kind: r.kind, key: r.key, ref: r.ref, title, classification: CLASSIFICATION[r.kind] ?? r.kind.toUpperCase(), url: resourceUrl(r.kind, r.key), scenario: r.slug, caseNumber: r.case_number });
  }
  return out;
}

const QR_OPTS = { errorCorrectionLevel: 'M' as const, margin: 4, color: { dark: '#000000', light: '#FFFFFF' } };
export const qrPng = (text: string, width = 1024) => QRCode.toBuffer(text, { ...QR_OPTS, type: 'png', width });
export const qrSvg = (text: string) => QRCode.toString(text, { ...QR_OPTS, type: 'svg' });

/** Contrôle des destinations avant impression : chaque ressource doit être résolue et exister. */
export async function checkResources(q: Query, resources: PrintResource[]) {
  const domain = domainStatus();
  const results = resources.map((r) => {
    const issues: string[] = [];
    if (r.title.includes('absent de la dernière version')) issues.push("La ressource n'existe plus dans la dernière version publiée.");
    if (!/^https?:\/\/[^/]+\/q\/[a-z]+\/[A-Za-z0-9._~%-]+$/.test(r.url)) issues.push('URL mal formée.');
    if (r.url.length > 120) issues.push('URL trop longue pour un QR code lisible.');
    return { id: r.id, url: r.url, ok: issues.length === 0, issues };
  });
  return { domain, results, ready: domain.final && results.every((r) => r.ok) };
}

/** Vérifie en ligne que le domaine public résout réellement chaque ressource vers la bonne entité. */
export async function checkOnline(resources: PrintResource[]) {
  const base = publicBaseUrl();
  if (!base) throw new HttpError(409, "Aucune adresse publique n'est configurée.");
  const out: any[] = [];
  for (const r of resources) {
    try {
      const ctrl = AbortSignal.timeout(8000);
      const res = await fetch(`${base}/api/resolve/${r.kind}/${encodeURIComponent(r.key)}`, { signal: ctrl });
      const body: any = await res.json().catch(() => ({}));
      out.push({ id: r.id, ok: res.ok && body?.ref === r.ref, status: res.status });
    } catch (err) {
      out.push({ id: r.id, ok: false, status: 0, error: (err as Error).message });
    }
  }
  return out;
}

const A4 = { w: 595.28, h: 841.89 };
const LAYOUTS: Record<number, { cols: number; rows: number }> = { 1: { cols: 1, rows: 1 }, 4: { cols: 2, rows: 2 }, 6: { cols: 2, rows: 3 }, 8: { cols: 2, rows: 4 }, 9: { cols: 3, rows: 3 } };

export async function renderSheet(resources: PrintResource[], opts: { perPage?: number; cutMarks?: boolean } = {}) {
  if (!resources.length) throw new HttpError(400, 'Aucune ressource sélectionnée.');
  const layout = LAYOUTS[opts.perPage ?? 6] ?? LAYOUTS[6];
  const domain = domainStatus();
  const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false, info: { Title: 'DOSSIER X — Planches de QR codes', Author: 'DOSSIER X', Creator: 'DOSSIER X' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const margin = 28;
  const gap = 0;
  const cardW = (A4.w - margin * 2 - gap * (layout.cols - 1)) / layout.cols;
  const cardH = (A4.h - margin * 2 - 18 - gap * (layout.rows - 1)) / layout.rows;
  const perPage = layout.cols * layout.rows;

  for (let i = 0; i < resources.length; i++) {
    if (i % perPage === 0) {
      doc.addPage();
      doc.fontSize(7).fillColor('#555').font('Helvetica').text(
        domain.final ? `DOSSIER X — planche ${Math.floor(i / perPage) + 1} — ${domain.host}` : 'BROUILLON — domaine définitif non confirmé — ne pas imprimer pour le jeu',
        margin, A4.h - margin + 6, { width: A4.w - margin * 2, align: 'center' },
      );
      if (!domain.final) {
        doc.save().rotate(-35, { origin: [A4.w / 2, A4.h / 2] }).fontSize(54).fillColor('#A82B35').opacity(0.12)
          .text('BROUILLON', 0, A4.h / 2 - 30, { width: A4.w, align: 'center' }).restore().opacity(1);
      }
    }
    const k = i % perPage;
    const x = margin + (k % layout.cols) * (cardW + gap);
    const y = margin + Math.floor(k / layout.cols) * (cardH + gap);
    drawCard(doc, resources[i], x, y, cardW, cardH, opts.cutMarks !== false);
  }
  doc.end();
  return done;
}

function drawCard(doc: PDFKit.PDFDocument, r: PrintResource, x: number, y: number, w: number, h: number, cutMarks: boolean) {
  const pad = Math.max(10, w * 0.06);
  // Repères de découpe aux quatre coins
  if (cutMarks) {
    doc.save().lineWidth(0.4).strokeColor('#999');
    for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
      doc.moveTo(cx - 6, cy).lineTo(cx + 6, cy).stroke();
      doc.moveTo(cx, cy - 6).lineTo(cx, cy + 6).stroke();
    }
    doc.restore();
  }
  doc.save().lineWidth(0.8).strokeColor('#17191D').rect(x + 4, y + 4, w - 8, h - 8).stroke().restore();
  // En-tête
  doc.font('Helvetica-Bold').fontSize(Math.min(14, w / 14)).fillColor('#0B0C0E').text('DOSSIER X', x + pad, y + pad, { width: w - pad * 2, characterSpacing: 2 });
  doc.font('Helvetica').fontSize(7).fillColor('#A82B35').text(`${r.classification} · DOSSIER ${r.caseNumber}`, x + pad, y + pad + 16, { width: w - pad * 2, characterSpacing: 1 });
  // QR code vectoriel, zone de silence de 4 modules incluse
  const qr = QRCode.create(r.url, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const footer = 46;
  const top = y + pad + 30;
  const avail = Math.min(w - pad * 2, h - (top - y) - footer - pad);
  const module = avail / (n + 8);
  const size = module * (n + 8);
  const qx = x + (w - size) / 2;
  doc.save().rect(qx, top, size, size).fill('#FFFFFF');
  doc.fillColor('#000000');
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (qr.modules.data[row * n + col]) doc.rect(qx + (col + 4) * module, top + (row + 4) * module, module + 0.02, module + 0.02);
    }
  }
  doc.fill().restore();
  // Référence et titre
  const ty = top + size + 4;
  doc.font('Courier-Bold').fontSize(10).fillColor('#0B0C0E').text(r.key.toUpperCase(), x + pad, ty, { width: w - pad * 2, align: 'center' });
  doc.font('Helvetica').fontSize(Math.min(10, w / 20)).fillColor('#17191D').text(r.title, x + pad, ty + 14, { width: w - pad * 2, align: 'center', height: 26, ellipsis: true });
}
