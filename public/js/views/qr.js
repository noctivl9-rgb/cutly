// Résolution des QR codes de ressources et scanner intégré.
import { api, busy, errorMessage, h, link, modal, navigate, store } from '../core.js';
import { logo, icon } from '../art.js';

const KIND_TEXT = { lieu: 'un lieu', indice: 'une pièce à conviction', temoignage: 'un témoignage', document: 'un document', enveloppe: 'une enveloppe', evenement: 'un événement' };

/** Exécute le scan dans une partie et ouvre la ressource dans son contexte. */
export async function scanInGame(session, kind, key) {
  const res = await api(`/api/games/${session.gameId}/scan`, { method: 'POST', player: session.token, body: { kind, key } });
  try {
    sessionStorage.setItem('dx.open', JSON.stringify(res));
  } catch { /* ignore */ }
  return res;
}

export function qrView(kind, key) {
  const box = h('div', null, h('div', { class: 'skeleton', style: { height: '120px' } }));
  const el = h('div', null,
    h('header', { class: 'topbar' }, h('div', { class: 'topbar-inner' }, link('/', { class: 'brand' }, logo(22), 'DOSSIER X'))),
    h('main', { class: 'wrap narrow' }, box),
  );
  (async () => {
    let resource;
    try {
      resource = await api(`/api/resolve/${encodeURIComponent(kind)}/${encodeURIComponent(key)}`);
    } catch (ex) {
      box.replaceChildren(h('h1', null, 'Carte inconnue'), h('div', { class: 'error-box' }, errorMessage(ex)), h('p'), link('/', { class: 'btn' }, 'Accueil'));
      return;
    }
    const players = store.players();
    let sessions = [];
    if (players.length) {
      try {
        const r = await api('/api/me/sessions', { method: 'POST', body: { players: players.map((p) => p.token) } });
        sessions = r.players.filter((p) => p.status !== 'ended' && p.scenario === resource.scenario?.slug).map((p) => ({ ...p, token: players[p.tokenIndex].token }));
      } catch { /* hors ligne */ }
    }
    const heading = [h('p', { class: 'ref' }, `${resource.kind.toUpperCase()} · ${resource.key}`), h('h1', null, resource.kind === 'lieu' ? resource.label : 'Carte scannée'), h('p', { class: 'muted' }, `Cette carte représente ${KIND_TEXT[resource.kind] ?? 'une ressource'} de l'enquête « ${resource.scenario?.title ?? '?'} ».`)];
    const open = async (s, btn) => {
      try {
        await scanInGame(s, resource.kind, resource.key);
        navigate(`/partie/${s.code}`, { replace: true });
      } catch (ex) {
        box.append(h('div', { class: 'error-box' }, errorMessage(ex)));
      }
    };
    if (sessions.length === 1) {
      box.replaceChildren(...heading, h('p', null, 'Ouverture dans votre partie…'));
      return open(sessions[0]);
    }
    if (sessions.length > 1) {
      box.replaceChildren(...heading, h('p', { class: 'section-label' }, 'Dans quelle partie ?'),
        ...sessions.map((s) => {
          const b = h('button', { class: 'resume-item' }, h('div', { class: 'spacer' }, h('strong', null, s.title), h('span', { class: 'ref' }, `${s.code} · ${s.nickname}`)), h('span', { class: 'caps red' }, 'Ouvrir'));
          b.addEventListener('click', busy(b, () => open(s)));
          return b;
        }));
      return;
    }
    // Aucune partie active : on garde la destination pour après l'inscription.
    store.setPending({ kind: resource.kind, key: resource.key, scenario: resource.scenario?.slug });
    box.replaceChildren(...heading,
      h('div', { class: 'info-box' }, "Vous n'avez aucune partie en cours de cette enquête sur cet appareil. Rejoignez ou créez-en une : cette carte s'ouvrira ensuite automatiquement."),
      h('p'),
      h('div', { class: 'stack' }, link('/rejoindre', { class: 'btn paper block big' }, 'Rejoindre une partie'), link('/creer', { class: 'btn ghost block' }, 'Créer une partie'), link('/recuperer', { class: 'btn ghost block' }, 'Récupérer mon accès')),
    );
  })();
  return el;
}

/** Interprète le contenu d'un QR code. Seules les adresses DOSSIER X sont acceptées. */
export function parseQr(text, allowedHosts) {
  try {
    const u = new URL(text);
    if (!allowedHosts.includes(u.host)) return { foreign: true };
    let m = /^\/q\/([a-z]+)\/([^/]+)\/?$/.exec(u.pathname);
    if (m) return { kind: m[1], key: decodeURIComponent(m[2]) };
    m = /^\/rejoindre\/([^/]+)/.exec(u.pathname);
    if (m) return { join: u.pathname + u.search };
  } catch { /* pas une URL */ }
  return null;
}

let jsqrLoading;
function loadJsQR() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  jsqrLoading ??= new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = '/vendor/jsQR.js';
    sc.onload = () => resolve(window.jsQR);
    sc.onerror = reject;
    document.head.append(sc);
  });
  return jsqrLoading;
}

/** Scanner intégré (caméra) avec saisie manuelle de la référence en secours. */
export function openScanner(onResult, { publicBaseUrl } = {}) {
  const hosts = [location.host];
  try {
    if (publicBaseUrl) hosts.push(new URL(publicBaseUrl).host);
  } catch { /* ignore */ }
  const video = h('video', { playsinline: true, muted: true, style: { width: '100%', borderRadius: '4px', background: '#000', aspectRatio: '1', objectFit: 'cover' } });
  const status = h('p', { class: 'small muted' }, 'Autorisez la caméra puis visez le QR code de la carte.');
  const manual = h('input', { type: 'text', placeholder: 'ex. IDX-014 ou reception', autocapitalize: 'characters', autocomplete: 'off' });
  const manualBtn = h('button', { class: 'btn', type: 'submit' }, 'Ouvrir');
  let stream;
  let stopped = false;
  const stop = () => {
    stopped = true;
    stream?.getTracks().forEach((t) => t.stop());
  };
  const close = modal(h('div', null,
    video, status,
    h('form', { class: 'row', style: { marginTop: '12px' }, onsubmit: (e) => {
      e.preventDefault();
      const v = manual.value.trim();
      if (!v) return;
      stop();
      close();
      onResult({ kind: 'auto', key: v });
    } }, h('div', { class: 'spacer' }, h('label', null, 'Ou saisir la référence imprimée'), manual), manualBtn),
  ), { title: 'Scanner une carte', onClose: stop });

  (async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      status.textContent = "La caméra n'est pas accessible ici. Utilisez l'appareil photo du téléphone ou saisissez la référence.";
      video.remove();
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      if (stopped) return stop();
      video.srcObject = stream;
      await video.play();
      const jsQR = await loadJsQR();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const tick = () => {
        if (stopped) return;
        if (video.readyState >= 2) {
          const w = 480;
          const hgt = Math.round((video.videoHeight / video.videoWidth) * w) || w;
          canvas.width = w;
          canvas.height = hgt;
          ctx.drawImage(video, 0, 0, w, hgt);
          const code = jsQR(ctx.getImageData(0, 0, w, hgt).data, w, hgt, { inversionAttempts: 'dontInvert' });
          if (code?.data) {
            const parsed = parseQr(code.data, hosts);
            if (parsed && !parsed.foreign) {
              stop();
              close();
              if (navigator.vibrate) navigator.vibrate(40);
              return onResult(parsed);
            }
            status.textContent = parsed?.foreign ? "Ce QR code n'appartient pas à DOSSIER X." : 'QR code non reconnu.';
          }
        }
        setTimeout(() => requestAnimationFrame(tick), 120);
      };
      tick();
    } catch {
      status.textContent = "Accès à la caméra refusé. Vous pouvez saisir la référence imprimée sous le QR code.";
      video.remove();
    }
  })();
}

export const scanIcon = () => icon('scan');
