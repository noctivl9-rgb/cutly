// Noyau client : DOM sécurisé, API, stockage local des identités, temps réel, notifications.
// Le navigateur ne détient que des jetons opaques ; toutes les autorisations sont vérifiées
// par le serveur.

/** Crée un élément. Les chaînes deviennent des nœuds texte : aucun HTML injecté. */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'html') throw new Error('html interdit');
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

// ── Stockage local (identités sur cet appareil) ──
function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* stockage indisponible : la session reste valable jusqu'à la fermeture */ }
}

export const store = {
  players: () => read('dx.players', []),
  player: (gameIdOrCode) => store.players().find((p) => p.gameId === gameIdOrCode || p.code === gameIdOrCode),
  savePlayer(p) {
    write('dx.players', [p, ...store.players().filter((x) => x.gameId !== p.gameId)].slice(0, 20));
  },
  forgetPlayer(gameId) {
    write('dx.players', store.players().filter((x) => x.gameId !== gameId));
  },
  organizers: () => read('dx.organizers', []),
  organizer: (gameIdOrCode) => store.organizers().find((p) => p.gameId === gameIdOrCode || p.code === gameIdOrCode),
  saveOrganizer(o) {
    write('dx.organizers', [o, ...store.organizers().filter((x) => x.gameId !== o.gameId)].slice(0, 30));
  },
  forgetOrganizer(gameId) {
    write('dx.organizers', store.organizers().filter((x) => x.gameId !== gameId));
  },
  admin: () => read('dx.admin', null),
  saveAdmin: (t) => write('dx.admin', t),
  pending: () => {
    try {
      return JSON.parse(sessionStorage.getItem('dx.pending') ?? 'null');
    } catch {
      return null;
    }
  },
  setPending(p) {
    try {
      p ? sessionStorage.setItem('dx.pending', JSON.stringify(p)) : sessionStorage.removeItem('dx.pending');
    } catch { /* ignore */ }
  },
  flag: (k) => read(`dx.flag.${k}`, false),
  setFlag: (k, v = true) => write(`dx.flag.${k}`, v),
};

// ── API ──
export class ApiError extends Error {
  constructor(status, message, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export async function api(path, { method = 'GET', body, player, organizer, admin, raw } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (player) headers['x-dx-player'] = player;
  if (organizer) headers['x-dx-organizer'] = organizer;
  const adm = admin === true ? store.admin() : admin;
  if (adm) headers['x-dx-admin'] = adm;
  let res;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'Connexion impossible. Vérifiez votre réseau.');
  }
  if (raw && res.ok) return res;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Erreur ${res.status}`, data);
  return data;
}

// ── Temps réel : flux SSE lu via fetch (pour transmettre le jeton en en-tête) ──
export function connectStream(url, headers, { onEvent, onStatus, onReady, getSince }) {
  let stopped = false;
  let ctrl;
  let attempt = 0;
  async function loop() {
    while (!stopped) {
      ctrl = new AbortController();
      onStatus?.('connecting');
      try {
        const since = getSince?.();
        const res = await fetch(`${url}${since ? `?since=${encodeURIComponent(since)}` : ''}`, { headers, signal: ctrl.signal, cache: 'no-store' });
        if (res.status === 401 || res.status === 403) {
          onStatus?.('denied');
          return;
        }
        if (!res.ok || !res.body) throw new Error(String(res.status));
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let idx;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            let event = 'message';
            let data = '';
            for (const line of chunk.split('\n')) {
              if (line.startsWith('event:')) event = line.slice(6).trim();
              else if (line.startsWith('data:')) data += line.slice(5).trim();
            }
            if (event === 'ready') {
              attempt = 0;
              onStatus?.('live');
              onReady?.();
            } else if (event === 'game' || event === 'transient') {
              try {
                onEvent?.(JSON.parse(data), event === 'transient');
              } catch { /* événement illisible ignoré */ }
            }
          }
        }
      } catch (err) {
        if (stopped) return;
      }
      if (stopped) return;
      onStatus?.(navigator.onLine === false ? 'offline' : 'reconnecting');
      attempt++;
      await new Promise((r) => setTimeout(r, Math.min(15000, 800 * 2 ** Math.min(attempt, 4))));
    }
  }
  loop();
  const wake = () => ctrl?.abort();
  window.addEventListener('online', wake);
  return {
    stop() {
      stopped = true;
      ctrl?.abort();
      window.removeEventListener('online', wake);
    },
    reconnect: wake,
  };
}

// ── Notifications ──
export function toast(message, { tone = 'info', title, timeout = 4500 } = {}) {
  let wrap = $('#toasts');
  if (!wrap) document.body.append((wrap = h('div', { id: 'toasts', 'aria-live': 'polite', role: 'status' })));
  const el = h('div', { class: `toast toast-${tone}` }, title ? h('strong', null, title) : null, h('span', null, message));
  wrap.append(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, timeout);
}

export function errorMessage(err) {
  return err instanceof ApiError ? err.message : 'Une erreur inattendue est survenue.';
}

/** Fenêtre modale accessible. Renvoie une fonction de fermeture. */
export function modal(content, { title, wide, onClose, className } = {}) {
  const prev = document.activeElement;
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    prev?.focus?.();
    onClose?.();
  };
  const onKey = (e) => e.key === 'Escape' && close();
  const box = h(
    'div',
    { class: `modal ${wide ? 'modal-wide' : ''} ${className ?? ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title ?? 'Fenêtre' },
    h('button', { class: 'modal-close', 'aria-label': 'Fermer', onclick: close }, '×'),
    title ? h('h2', { class: 'modal-title' }, title) : null,
    content,
  );
  const overlay = h('div', { class: 'overlay', onclick: (e) => e.target === overlay && close() }, box);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  setTimeout(() => box.querySelector('button, input, textarea, select, [tabindex]')?.focus(), 30);
  return close;
}

export function confirmDialog(message, { confirm = 'Confirmer', danger } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const close = modal(
      h('div', null,
        h('p', null, message),
        h('div', { class: 'row end' },
          h('button', { class: 'btn ghost', onclick: () => ((done = true), close(), resolve(false)) }, 'Annuler'),
          h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => ((done = true), close(), resolve(true)) }, confirm),
        ),
      ),
      { title: 'Confirmation', onClose: () => !done && resolve(false) },
    );
  });
}

// ── Formatage ──
export const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '');
export const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
export const fictiveTime = (at) => at.replace(':', ' h ');

export const KIND_LABEL = { indice: 'Pièce à conviction', temoignage: 'Témoignage', document: 'Document' };
export const STATUS_LABEL = { lobby: "Salle d'attente", running: 'En cours', paused: 'En pause', ended: 'Terminée' };

// ── Navigation ──
export function navigate(path, { replace } = {}) {
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  window.dispatchEvent(new Event('dx:navigate'));
}

export function link(path, attrs, ...children) {
  return h('a', { href: path, ...attrs, onclick: (e) => {
    if (e.metaKey || e.ctrlKey || e.button !== 0) return;
    e.preventDefault();
    navigate(path);
  } }, ...children);
}

export function busy(button, fn) {
  return async (...args) => {
    if (button.disabled) return;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    try {
      return await fn(...args);
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  };
}
