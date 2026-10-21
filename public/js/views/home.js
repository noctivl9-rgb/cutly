import { api, h, link, navigate, store, STATUS_LABEL } from '../core.js';
import { logo, hotelPlan } from '../art.js';

function intro(onDone) {
  const el = h('div', { class: 'intro', role: 'button', 'aria-label': "Passer l'introduction", tabindex: 0 },
    h('div', { class: 'intro-folder' },
      h('div', { class: 'intro-sheet' }, 'DOCUMENT CONFIDENTIEL', h('b', null, 'DOSSIER X'), 'ACCÈS RÉSERVÉ AUX ENQUÊTEURS'),
      h('div', { class: 'intro-cover' }, h('span', { class: 'stamp' }, 'Confidentiel')),
    ),
  );
  const finish = () => {
    if (el.classList.contains('out')) return;
    el.classList.add('out');
    store.setFlag('intro');
    setTimeout(() => (el.remove(), onDone?.()), 400);
  };
  el.addEventListener('click', finish);
  el.addEventListener('keydown', finish);
  setTimeout(finish, 2300);
  return el;
}

export function homeView() {
  const resume = h('div', { class: 'resume-list' });
  const el = h('main', { class: 'home' },
    h('div', { class: 'home-bg', 'aria-hidden': 'true' }, hotelPlan([])),
    h('div', { class: 'home-card' },
      h('div', { style: { display: 'flex', justifyContent: 'center', color: 'var(--paper)' } }, logo(44)),
      h('h1', { class: 'home-title' }, 'DOSSIER ', h('span', { class: 'x' }, 'X')),
      h('p', { class: 'home-tag' }, 'La vérité ne se trouve jamais au premier regard.'),
      h('div', { class: 'home-actions' },
        link('/creer', { class: 'btn primary big' }, 'Créer une partie'),
        link('/rejoindre', { class: 'btn paper big' }, 'Rejoindre une partie'),
      ),
      resume,
      h('div', { class: 'home-foot' },
        link('/recuperer', null, 'Récupérer mon accès'),
        link('/admin', { 'aria-label': 'Administration' }, 'Administration'),
      ),
    ),
  );
  if (!store.flag('intro')) document.body.append(intro());
  loadResume(resume);
  return el;
}

async function loadResume(box) {
  const players = store.players();
  const organizers = store.organizers();
  if (!players.length && !organizers.length) return;
  try {
    const res = await api('/api/me/sessions', { method: 'POST', body: { players: players.map((p) => p.token), organizers: organizers.map((o) => ({ gameId: o.gameId, token: o.token })) } });
    const active = res.players.filter((p) => p.status !== 'ended');
    // Nettoyage des identités qui ne sont plus valides sur le serveur
    const valid = new Set(res.players.map((p) => p.gameId));
    for (const p of players) if (!valid.has(p.gameId)) store.forgetPlayer(p.gameId);
    const validOrg = new Set(res.organizers.map((o) => o.game_id));
    for (const o of organizers) if (!validOrg.has(o.gameId)) store.forgetOrganizer(o.gameId);
    if (active.length) {
      box.append(h('p', { class: 'section-label' }, 'Reprendre mon enquête'));
      for (const p of active) {
        box.append(h('button', { class: 'resume-item', onclick: () => navigate(`/partie/${p.code}`) },
          h('div', { class: 'spacer' }, h('strong', null, p.title), h('span', { class: 'ref' }, `${p.code} · ${p.nickname} · ${STATUS_LABEL[p.status]}`)),
          h('span', { class: 'caps red' }, 'Reprendre'),
        ));
      }
    }
    const orgs = res.organizers.filter((o) => o.status !== 'ended');
    if (orgs.length) {
      box.append(h('p', { class: 'section-label' }, 'Mes parties organisées'));
      for (const o of orgs) {
        box.append(h('button', { class: 'resume-item', onclick: () => navigate(`/organisateur/${o.code}`) },
          h('div', { class: 'spacer' }, h('strong', null, o.title), h('span', { class: 'ref' }, `${o.code} · ${STATUS_LABEL[o.status]}`)),
          h('span', { class: 'caps' }, 'Console'),
        ));
      }
    }
  } catch {
    /* hors ligne : on n'affiche rien plutôt que des données incertaines */
  }
}
