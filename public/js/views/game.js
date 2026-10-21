// Application joueur : salle d'attente, puis ENQUÊTE — EXPLORER — PREUVES — TABLEAU — PROFIL.
import { api, busy, confirmDialog, connectStream, errorMessage, fictiveTime, fmtDateTime, fmtTime, h, KIND_LABEL, link, modal, navigate, STATUS_LABEL, store, toast } from '../core.js';
import { evidenceArt, hotelPlan, icon, logo, portrait, roomThumb } from '../art.js';
import { openScanner, scanInGame } from './qr.js';
import { boardView } from './board.js';

const TABS = [
  ['enquete', 'ENQUÊTE', 'dossier'],
  ['explorer', 'EXPLORER', 'explorer'],
  ['preuves', 'PREUVES', 'preuves'],
  ['tableau', 'TABLEAU', 'tableau'],
  ['profil', 'PROFIL', 'profil'],
];

export function gameView(code) {
  const session = store.player(decodeURIComponent(code).toUpperCase());
  if (!session) {
    return h('main', { class: 'wrap narrow' },
      h('h1', null, 'Accès requis'),
      h('p', { class: 'muted' }, "Cet appareil n'a pas d'identité de joueur pour cette partie."),
      h('div', { class: 'stack' }, link(`/rejoindre/${code}`, { class: 'btn primary block' }, 'Rejoindre la partie'), link('/recuperer', { class: 'btn ghost block' }, 'Récupérer mon personnage')),
    );
  }

  const ui = {
    state: null,
    tab: sessionStorage.getItem(`dx.tab.${session.gameId}`) ?? 'enquete',
    sub: 'dossier',
    syncStatus: 'connecting',
    pendingRender: false,
    seen: new Set(JSON.parse(localStorage.getItem(`dx.seen.${session.gameId}`) ?? '[]')),
    board: null,
  };
  const root = h('div');
  const syncEl = h('span', { class: 'sync connecting', role: 'status' }, 'Connexion');
  const caseChip = h('span', { class: 'case-chip' }, session.code);
  const top = h('header', { class: 'topbar' }, h('div', { class: 'topbar-inner' }, link('/', { class: 'brand', 'aria-label': 'Accueil' }, logo(22)), caseChip, h('span', { class: 'spacer' }), syncEl));
  const main = h('main', { class: 'wrap game-main' });
  const tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Sections' });
  const veil = h('div');
  root.append(top, main, tabbar, veil);

  const call = (path, opts = {}) => api(`/api/games/${session.gameId}${path}`, { ...opts, player: session.token });

  // ── Chargement et synchronisation ──
  let refreshTimer;
  async function refresh() {
    try {
      const st = await call('/state');
      ui.state = st;
      render();
    } catch (ex) {
      if (ex.status === 401 || ex.status === 403) return lostIdentity(ex);
      if (!ui.state) main.replaceChildren(h('div', { class: 'error-box' }, errorMessage(ex), ' ', h('button', { class: 'linkish', onclick: refresh }, 'Réessayer')));
    }
  }
  const scheduleRefresh = (ms = 250) => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, ms);
  };

  function lostIdentity(ex) {
    stream?.stop();
    main.replaceChildren(h('div', { class: 'narrow' },
      h('h1', null, 'Identité expirée'),
      h('p', { class: 'muted' }, ex.status === 401 ? "Votre accès a été renouvelé sur un autre appareil ou retiré par l'organisateur." : errorMessage(ex)),
      h('div', { class: 'stack' }, link('/recuperer', { class: 'btn primary block' }, 'Récupérer mon personnage'), h('button', { class: 'btn ghost block', onclick: () => (store.forgetPlayer(session.gameId), navigate('/')) }, 'Oublier cette partie sur cet appareil')),
    ));
    tabbar.replaceChildren();
  }

  const stream = connectStream(`/api/games/${session.gameId}/stream`, { 'x-dx-player': session.token }, {
    getSince: () => ui.state?.lastEventId,
    onStatus: (st) => {
      ui.syncStatus = st;
      syncEl.className = `sync ${st}`;
      syncEl.textContent = { live: 'En direct', connecting: 'Connexion', reconnecting: 'Reconnexion', offline: 'Hors ligne', denied: 'Accès refusé' }[st] ?? st;
      if (st === 'denied') refresh();
    },
    onReady: () => scheduleRefresh(50), // rattrapage complet après chaque (re)connexion
    onEvent: (ev, transient) => {
      if (!transient && ui.state && Number(ev.id) > Number(ui.state.lastEventId)) ui.state.lastEventId = ev.id;
      if (!transient) notify(ev);
      scheduleRefresh(transient ? 600 : 200);
    },
  });

  function notify(ev) {
    const p = ev.payload ?? {};
    const mine = ev.actor === `player:${ui.state?.me.id}`;
    switch (ev.type) {
      case 'item.discovered':
        if (mine) break;
        // Une fouille peut révéler plusieurs pièces d'un coup : une seule notification groupée.
        (ui.batch ??= []).push(p);
        clearTimeout(ui.batchTimer);
        ui.batchTimer = setTimeout(() => {
          const list = ui.batch;
          ui.batch = [];
          const by = [...new Set(list.map((x) => x.by).filter(Boolean))].join(', ');
          if (list.length === 1) toast(`${list[0].title}${by ? ` — découvert par ${by}` : ''}`, { title: 'Nouvelle preuve', tone: 'discovery' });
          else toast(`${list.map((x) => x.title).join(' · ')}${by ? ` — par ${by}` : ''}`, { title: `${list.length} nouvelles preuves`, tone: 'discovery', timeout: 6000 });
        }, 350);
        break;
      case 'stage.unlocked': toast(p.description ?? '', { title: `Étape ${p.stage} — ${p.title}`, tone: 'discovery', timeout: 7000 }); break;
      case 'envelope.opened': toast(p.title, { title: 'Enveloppe ouverte', tone: 'discovery' }); break;
      case 'announcement': modal(h('div', null, h('p', { class: 'hand', style: { fontSize: '1.6rem' } }, p.text)), { title: "Message de l'organisateur" }); break;
      case 'story.event': modal(h('div', { class: 'paper' }, h('span', { class: 'stamp' }, 'Événement'), h('h2', { style: { marginTop: '10px' } }, p.title), h('p', null, p.body)), { title: 'Rebondissement' }); break;
      case 'info.shared': if (!mine) toast(`${p.character} (${p.by}) : ${p.label}`, { title: 'Information partagée' }); break;
      case 'player.joined': if (!mine) toast(`${p.nickname}${p.character ? ` incarne ${p.character}` : ''}`, { title: 'Nouvel enquêteur' }); break;
      case 'game.started': toast("L'enquête commence.", { title: 'Partie lancée', tone: 'ok' }); break;
      case 'game.paused': break;
      case 'game.resumed': toast("L'enquête reprend.", { title: 'Reprise', tone: 'ok' }); break;
      case 'accusation.submitted': toast(`Suspect désigné : ${p.suspect}`, { title: 'Accusation transmise', tone: 'discovery' }); break;
      case 'solution.revealed': ui.tab = 'enquete'; ui.sub = 'revelation'; break;
      case 'notes.changed': if (!mine) toast('Les notes communes ont été modifiées.', { title: 'Notes', timeout: 2500 }); break;
    }
  }

  // ── Rendu ──
  function render() {
    const st = ui.state;
    if (!st) return;
    caseChip.textContent = `DOSSIER ${st.scenario.caseNumber} · ${st.game.code}`;
    veil.replaceChildren(st.game.status === 'paused'
      ? h('div', { class: 'pause-veil', role: 'alert' }, h('div', null, h('span', { class: 'stamp' }, 'Pause'), h('h2', { style: { marginTop: '14px' } }, 'Enquête suspendue'), h('p', { class: 'muted' }, "L'organisateur a mis la partie en pause. Tout est sauvegardé.")))
      : '');
    if (st.game.status === 'lobby') {
      tabbar.replaceChildren();
      main.replaceChildren(lobby(st));
      return;
    }
    // Ne pas écraser une saisie en cours : le rendu attend la fin de l'édition.
    const active = document.activeElement;
    if (active && main.contains(active) && /^(TEXTAREA|INPUT|SELECT)$/.test(active.tagName) && active.dataset.live !== 'true') {
      ui.pendingRender = true;
      renderTabbar();
      return;
    }
    if (ui.board?.isBusy?.()) {
      ui.pendingRender = true;
      return;
    }
    ui.pendingRender = false;
    renderTabbar();
    const scroll = window.scrollY;
    ui.board?.destroy?.();
    ui.board = null;
    const view = { enquete: tabEnquete, explorer: tabExplorer, preuves: tabPreuves, tableau: tabTableau, profil: tabProfil }[ui.tab] ?? tabEnquete;
    main.replaceChildren(...banners(st), view(st));
    window.scrollTo(0, scroll);
    openPending();
  }
  main.addEventListener('focusout', () => setTimeout(() => ui.pendingRender && !main.contains(document.activeElement) && render(), 50));

  function renderTabbar() {
    const unseen = ui.state.items.filter((i) => !ui.seen.has(i.ref)).length;
    tabbar.replaceChildren(...TABS.map(([id, label, ic]) => h('button', {
      'aria-current': ui.tab === id ? 'page' : undefined,
      onclick: () => {
        ui.tab = id;
        sessionStorage.setItem(`dx.tab.${session.gameId}`, id);
        ui.pendingRender = false;
        document.activeElement?.blur?.();
        render();
        window.scrollTo(0, 0);
      },
    }, icon(ic), label, id === 'preuves' && unseen ? h('span', { class: 'dot', 'aria-label': `${unseen} nouvelles` }) : null)));
  }

  function banners(st) {
    const out = [];
    if (st.game.status === 'ended') out.push(h('div', { class: 'banner' }, 'Cette partie est terminée. Le dossier reste consultable.'));
    const last = st.journal.find((e) => e.type === 'announcement');
    if (last && Date.now() - new Date(last.at).getTime() < 10 * 60_000) out.push(h('div', { class: 'banner' }, h('span', { class: 'caps red' }, 'Organisateur · '), last.payload.text));
    return out;
  }

  // Ouvre la ressource scannée juste avant d'arriver ici
  function openPending() {
    let p;
    try {
      p = JSON.parse(sessionStorage.getItem('dx.open') ?? 'null');
      sessionStorage.removeItem('dx.open');
    } catch { /* ignore */ }
    if (!p) return;
    showScanResult(p);
  }

  function showScanResult(p) {
    const st = ui.state;
    if (p.type === 'lieu') {
      if (p.locked) return toast(p.reason, { title: 'Lieu verrouillé', tone: 'error' });
      ui.tab = 'explorer';
      render();
      return openLocation(p.ref);
    }
    if (p.type === 'item') {
      if (p.locked) return modal(h('div', null, h('p', null, icon('lock'), ' ', p.reason), h('p', { class: 'small muted' }, 'Le contenu reste scellé. Réessayez plus tard.')), { title: 'Élément verrouillé' });
      const it = st.items.find((i) => i.ref === p.ref);
      if (it) return openItem(it, { fresh: !p.already });
    }
    if (p.type === 'enveloppe') {
      const env = st.envelopes.find((e) => e.ref === p.ref);
      return env?.opened ? openEnvelope(env) : modal(h('p', null, p.reason), { title: env?.title ?? 'Enveloppe' });
    }
    if (p.type === 'evenement') return modal(h('p', null, p.reason), { title: 'Événement' });
  }

  async function doScan(result) {
    if (result.join) return navigate(result.join);
    try {
      const res = await scanInGame(session, result.kind, result.key);
      sessionStorage.removeItem('dx.open');
      await refresh();
      showScanResult(res);
    } catch (ex) {
      toast(errorMessage(ex), { title: 'Scan', tone: 'error' });
    }
  }
  const scanButton = (cls = 'btn primary block big') => h('button', { class: cls, onclick: () => openScanner(doScan, { publicBaseUrl: ui.config?.publicBaseUrl }) }, icon('scan'), 'Scanner une carte');

  const playerName = (id) => ui.state.players.find((p) => p.id === id)?.nickname ?? 'un enquêteur';
  const charName = (ref) => ui.state.characters.find((c) => c.ref === ref)?.name ?? ref;
  const locName = (ref) => ui.state.locations.find((l) => l.ref === ref)?.name ?? '';

  // ── Salle d'attente ──
  function lobby(st) {
    const me = st.me;
    const readyBtn = h('button', { class: `btn ${me.ready ? 'ghost' : 'primary'} block big` }, me.ready ? 'Je ne suis plus prêt' : 'Je suis prêt');
    readyBtn.addEventListener('click', busy(readyBtn, async () => {
      try {
        await call('/ready', { method: 'POST', body: { ready: !me.ready } });
        await refresh();
      } catch (ex) { toast(errorMessage(ex), { tone: 'error' }); }
    }));
    const leaveBtn = h('button', { class: 'linkish' }, 'Quitter cette partie');
    leaveBtn.addEventListener('click', async () => {
      if (!(await confirmDialog('Quitter la partie et libérer votre personnage ?', { confirm: 'Quitter', danger: true }))) return;
      try {
        await call('/leave', { method: 'POST' });
        store.forgetPlayer(session.gameId);
        navigate('/');
      } catch (ex) { toast(errorMessage(ex), { tone: 'error' }); }
    });
    const taken = new Map(st.players.filter((p) => p.characterRef).map((p) => [p.characterRef, p]));
    return h('div', { class: 'narrow', style: { margin: '0 auto' } },
      h('p', { class: 'caps red' }, "Salle d'attente"),
      h('h1', null, st.scenario.title),
      h('p', { class: 'ref' }, `DOSSIER ${st.scenario.caseNumber} · CODE ${st.game.code} · ${st.players.length}/${st.game.maxPlayers} JOUEURS · ${st.game.maxPlayers - st.players.length} PLACE(S) LIBRE(S)`),
      h('p', { class: 'muted' }, st.scenario.synopsis),
      st.myCharacter ? h('div', { class: 'paper', style: { margin: '18px 0' } },
        h('div', { class: 'id-card' }, portrait(st.myCharacter, 110), h('div', null, h('span', { class: 'ref' }, 'VOUS INCARNEZ'), h('h2', null, st.myCharacter.name), h('p', null, st.myCharacter.role), h('p', { class: 'small muted' }, 'Votre fiche confidentielle sera disponible dans PROFIL dès le lancement. Ne la montrez à personne.'))),
      ) : null,
      h('p', { class: 'section-label' }, 'Enquêteurs'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('tbody', null, ...st.players.map((p) => h('tr', null,
        h('td', null, h('span', { class: `online ${p.online ? 'on' : ''}` }), p.nickname, p.id === me.id ? ' (vous)' : ''),
        h('td', null, p.characterRef ? charName(p.characterRef) : '—'),
        h('td', null, p.ready ? h('span', { class: 'status-pill running' }, 'Prêt') : h('span', { class: 'status-pill' }, 'En attente')),
      ))))),
      h('p', { class: 'section-label' }, 'Personnages'),
      h('div', { class: 'char-grid' }, ...st.characters.map((c) => h('div', { class: 'char-card', style: { cursor: 'default' } }, portrait(c, 160), taken.has(c.ref) ? h('span', { class: 'stamp taken' }, taken.get(c.ref).nickname) : null, h('div', { class: 'meta' }, h('strong', null, c.name), h('span', { class: 'tiny muted' }, c.role))))),
      h('p'),
      readyBtn,
      h('p', { class: 'small muted', style: { textAlign: 'center', marginTop: '10px' } }, "L'organisateur lancera l'enquête quand tout le monde sera prêt."),
      h('p', { style: { textAlign: 'center' } }, leaveBtn),
    );
  }

  // ── ENQUÊTE ──
  function tabEnquete(st) {
    const subs = [['dossier', 'Dossier'], ['chronologie', 'Chronologie'], ['notes', 'Notes'], ['accusation', 'Accusation']];
    if (st.solution) subs.push(['revelation', 'Révélation']);
    if (!subs.some(([k]) => k === ui.sub)) ui.sub = 'dossier';
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Dossier commun' }, ...subs.map(([k, l]) => h('button', { 'aria-pressed': String(ui.sub === k), onclick: () => ((ui.sub = k), render()) }, l)));
    const body = { dossier: subDossier, chronologie: subChronologie, notes: subNotes, accusation: subAccusation, revelation: subRevelation }[ui.sub](st);
    return h('div', null, seg, h('div', { style: { marginTop: '16px' } }, body));
  }

  function subDossier(st) {
    const v = st.scenario.intro?.victim;
    const temoignages = st.items.filter((i) => i.kind === 'temoignage');
    return h('div', null,
      h('div', { class: 'paper' }, h('div', { class: 'tape' }),
        h('div', { class: 'row between' }, h('span', { class: 'ref' }, `DOSSIER ${st.scenario.caseNumber} · ${st.game.code}`), h('span', { class: 'stamp' }, 'Confidentiel')),
        h('h1', { style: { marginTop: '10px', color: 'var(--paper-ink)' } }, st.scenario.title),
        st.scenario.intro?.tagline ? h('p', { class: 'annotation' }, st.scenario.intro.tagline) : null,
        h('p', null, st.scenario.synopsis),
        v ? h('div', { class: 'transcript' }, h('strong', null, `Victime : ${v.name}, ${v.age} ans. `), v.description) : null,
        h('p', null, h('strong', null, 'Objectif : '), st.scenario.objective),
      ),
      h('p', { class: 'section-label' }, 'Progression'),
      h('div', { class: 'stage-list' }, ...st.scenario.stages.map((s) => h('div', { class: `stage ${s.idx === st.game.stage ? 'current' : ''} ${s.idx < st.game.stage ? 'done' : ''}` },
        h('span', { class: 'num' }, String(s.idx).padStart(2, '0')),
        h('div', null, s.title ? h('strong', null, s.title) : h('span', { class: 'muted' }, 'Étape scellée'), s.description ? h('div', { class: 'small muted' }, s.description) : null),
        s.idx < st.game.stage ? h('span', { class: 'chip' }, 'Franchie') : s.idx === st.game.stage ? h('span', { class: 'chip' }, 'En cours') : icon('lock', 18),
      ))),
      h('p', { class: 'section-label' }, 'Enveloppes'),
      h('div', { class: 'grid grid-2' }, ...st.envelopes.map((e) => h('button', { class: 'resume-item', style: { borderLeftColor: e.opened ? 'var(--red)' : 'var(--metal)' }, onclick: () => (e.opened ? openEnvelope(e) : modal(h('div', null, h('p', null, e.teaser), h('p', { class: 'small muted' }, "Scellée. Seul l'organisateur peut l'ouvrir.")), { title: e.title })) },
        icon(e.opened ? 'envelope' : 'lock'), h('div', { class: 'spacer' }, h('strong', null, e.title), h('span', { class: 'small muted' }, e.opened ? `Ouverte à ${fmtTime(e.openedAt)}` : 'Scellée')),
      ))),
      h('p', { class: 'section-label' }, 'Participants'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('tbody', null, ...st.players.map((p) => h('tr', null, h('td', null, h('span', { class: `online ${p.online ? 'on' : ''}`, title: p.online ? 'Connecté' : 'Hors ligne' }), p.nickname), h('td', null, p.characterRef ? charName(p.characterRef) : '—')))))),
      h('p', { class: 'section-label' }, 'Suspects'),
      h('div', { class: 'grid grid-2' }, ...st.characters.map((c) => h('button', { class: 'resume-item', style: { borderLeftColor: 'var(--metal)', alignItems: 'flex-start' }, onclick: () => openSuspect(c) },
        portrait(c, 56), h('div', { class: 'spacer' }, h('strong', null, c.name), h('span', { class: 'small muted' }, c.role), h('div', { class: 'small', style: { marginTop: '4px' } }, c.alibi)),
      ))),
      h('p', { class: 'section-label' }, `Témoignages (${temoignages.length + st.shares.length})`),
      temoignages.length + st.shares.length ? h('div', { class: 'stack' },
        ...temoignages.map((t) => h('button', { class: 'resume-item', onclick: () => openItem(t) }, evidenceArt('temoignage', 32), h('div', { class: 'spacer' }, h('strong', null, t.title), h('span', { class: 'ref' }, t.ref)))),
        ...st.shares.map((sh) => h('div', { class: 'info-box' }, h('span', { class: 'caps red' }, `Partagé par ${playerName(sh.playerId)} · ${fmtTime(sh.at)}`), h('p', { style: { margin: '6px 0 0', whiteSpace: 'pre-line' } }, sh.content.text))),
      ) : h('p', { class: 'empty' }, h('span', { class: 'hand' }, 'Personne n’a encore parlé.'), 'Les témoignages apparaîtront ici.'),
      h('p', { class: 'section-label' }, 'Historique'),
      journalList(st.journal.slice(0, 25)),
    );
  }

  function openSuspect(c) {
    modal(h('div', { class: 'paper' },
      h('div', { class: 'id-card' }, portrait(c, 110), h('div', null, h('span', { class: 'ref' }, `FICHE PUBLIQUE · ${c.ref}`), h('h2', null, c.name), h('p', null, `${c.role}${c.age ? `, ${c.age} ans` : ''}`))),
      h('p', { style: { marginTop: '12px' } }, c.presentation),
      c.relations?.length ? h('p', null, h('strong', null, 'Relations : '), c.relations.join(' · ')) : null,
      h('p', { class: 'annotation' }, 'Alibi déclaré'),
      h('p', null, c.alibi),
      c.declaredMovements?.length ? h('ul', { class: 'movements' }, ...c.declaredMovements.map((m) => h('li', null, h('time', null, fictiveTime(m.at)), h('span', null, `${m.text}${m.place ? ` — ${locName(m.place)}` : ''}`)))) : null,
      h('p', { class: 'small muted', style: { marginTop: '12px' } }, 'Les déclarations des suspects peuvent être mensongères.'),
    ), { className: 'paper-modal', title: '' });
  }

  function journalList(entries) {
    const label = (e) => {
      const p = e.payload ?? {};
      return {
        'item.discovered': `${p.by ?? 'Enquête'} découvre « ${p.title} »`,
        'stage.unlocked': `Étape ${p.stage} : ${p.title}`,
        'envelope.opened': `Ouverture : ${p.title}`,
        'player.joined': `${p.nickname} rejoint l’enquête${p.character ? ` (${p.character})` : ''}`,
        'player.left': `${p.nickname} quitte la partie`,
        'player.assigned': `${p.nickname} incarne désormais ${p.character ?? 'aucun personnage'}`,
        'info.shared': `${p.by} (${p.character}) partage : ${p.label}`,
        'game.started': 'Lancement de l’enquête',
        'game.paused': 'Partie mise en pause',
        'game.resumed': 'Reprise de la partie',
        'game.ended': 'Fin de la partie',
        announcement: `Annonce : ${p.text}`,
        'story.event': `Événement : ${p.title}`,
        'accusation.submitted': `Accusation transmise contre ${p.suspect}`,
        'accusation.designated': `${p.nickname} est désigné porte-parole`,
        'solution.revealed': 'La vérité est révélée',
      }[e.type];
    };
    const items = entries.map((e) => ({ e, text: label(e) })).filter((x) => x.text);
    if (!items.length) return h('p', { class: 'empty' }, 'Aucune action pour le moment.');
    return h('ol', { class: 'timeline journal' }, ...items.map(({ e, text }) => h('li', null, h('time', null, fmtTime(e.at)), h('div', null, text))));
  }

  function subChronologie(st) {
    const mode = ui.chronoMode ?? 'recit';
    const f = (ui.chronoFilter ??= { character: '', location: '', item: '', period: '' });
    const sel = (key, label, options) => h('select', { 'aria-label': label, onchange: (e) => ((f[key] = e.target.value), render()) },
      h('option', { value: '' }, label), ...options.map(([v, l]) => h('option', { value: v, selected: f[key] === v }, l)));
    const periodOk = (at) => {
      if (!f.period) return true;
      const [hh] = at.split(':').map(Number);
      const night = hh < 12 ? hh + 24 : hh; // la nuit continue après minuit
      return { soir: night < 23, crime: night >= 23 && night < 24, nuit: night >= 24 }[f.period];
    };
    const filters = h('div', { class: 'filters' },
      sel('character', 'Personnage', st.characters.map((c) => [c.ref, c.name])),
      sel('location', 'Lieu', st.locations.map((l) => [l.ref, l.name])),
      mode === 'journal' ? sel('item', 'Preuve', st.items.map((i) => [i.ref, i.title])) : sel('period', 'Période', [['soir', 'Avant 23 h'], ['crime', '23 h – minuit'], ['nuit', 'Après minuit']]),
    );
    let list;
    if (mode === 'recit') {
      const rows = st.timeline.filter((t) => (!f.character || t.characters.includes(f.character)) && (!f.location || t.location === f.location) && periodOk(t.at));
      list = rows.length ? h('ol', { class: 'timeline' }, ...rows.map((t) => h('li', { class: t.truth ? 'truth' : '' },
        h('time', null, fictiveTime(t.at)), h('strong', null, t.title), h('div', { class: 'small' }, t.body),
        h('div', { class: 'chips' }, t.location ? h('span', { class: 'chip' }, locName(t.location)) : null, ...t.characters.map((c) => h('span', { class: 'chip' }, charName(c)))),
      ))) : h('p', { class: 'empty' }, 'Aucun événement connu pour ces critères.');
    } else {
      const rows = st.journal.filter((e) => {
        const p = e.payload ?? {};
        if (f.item && p.ref !== f.item) return false;
        if (f.location && p.location !== f.location) return false;
        if (f.character) {
          const pl = st.players.find((x) => x.characterRef === f.character);
          if (!pl || (e.actor !== `player:${pl.id}` && p.playerId !== pl.id)) return false;
        }
        return true;
      });
      list = journalList(rows);
    }
    return h('div', null,
      h('div', { class: 'seg', style: { marginBottom: '12px' } },
        h('button', { 'aria-pressed': String(mode === 'recit'), onclick: () => ((ui.chronoMode = 'recit'), render()) }, 'Nuit du crime'),
        h('button', { 'aria-pressed': String(mode === 'journal'), onclick: () => ((ui.chronoMode = 'journal'), render()) }, 'Journal de la partie'),
      ),
      h('p', { class: 'small muted' }, mode === 'recit' ? 'Horaires fictifs de la nuit du 14 au 15 novembre. De nouveaux événements apparaissent à mesure des découvertes.' : 'Actions des enquêteurs, horodatées en temps réel.'),
      filters, list,
    );
  }

  function subNotes(st) {
    const n = st.notes;
    const ta = h('textarea', { 'aria-label': 'Notes communes', style: { minHeight: '50vh' }, placeholder: 'Hypothèses, questions à poser, recoupements…' }, n.body);
    ta.value = n.body;
    let base = { body: n.body, version: n.version };
    const info = h('p', { class: 'small muted' }, n.version ? `Version ${n.version} · modifiée par ${playerName(n.updated_by)} à ${fmtTime(n.updated_at)}` : 'Notes partagées entre tous les enquêteurs.');
    const save = h('button', { class: 'btn primary' }, 'Enregistrer');
    save.addEventListener('click', busy(save, async () => {
      try {
        const r = await call('/notes', { method: 'PUT', body: { body: ta.value, version: base.version } });
        base = { body: ta.value, version: r.version };
        toast('Notes enregistrées.', { tone: 'ok', timeout: 2000 });
        ta.blur();
        await refresh();
      } catch (ex) {
        if (ex.status === 409 && ex.data?.current) return resolveNoteConflict(ta.value, ex.data.current);
        toast(errorMessage(ex), { tone: 'error' });
      }
    }));
    return h('div', null, info, ta, h('div', { class: 'row end', style: { marginTop: '10px' } }, save));
  }

  function resolveNoteConflict(mine, theirs) {
    const close = modal(h('div', null,
      h('p', null, `Pendant que vous écriviez, ${playerName(theirs.updated_by)} a enregistré une autre version.`),
      h('label', null, 'Leur version'), h('textarea', { readonly: true, style: { minHeight: '120px' } }, theirs.body),
      h('label', null, 'Votre version'), h('textarea', { readonly: true, style: { minHeight: '120px' } }, mine),
      h('div', { class: 'row end', style: { marginTop: '12px' } },
        h('button', { class: 'btn ghost', onclick: async () => (close(), await refresh()) }, 'Garder la leur'),
        h('button', { class: 'btn', onclick: async () => (await saveResolved(`${theirs.body}\n\n— ajout —\n${mine}`, theirs.version), close()) }, 'Fusionner'),
        h('button', { class: 'btn primary', onclick: async () => (await saveResolved(mine, theirs.version), close()) }, 'Garder la mienne'),
      ),
    ), { title: 'Conflit de modification', wide: true });
  }
  async function saveResolved(body, version) {
    try {
      await call('/notes', { method: 'PUT', body: { body, version } });
      await refresh();
    } catch (ex) { toast(errorMessage(ex), { tone: 'error' }); }
  }

  function subAccusation(st) {
    const a = st.accusation;
    const mode = st.game.settings.accusationMode;
    if (st.game.stage < st.game.settings.accusationStage) {
      return h('div', { class: 'empty' }, icon('lock', 32), h('p', null, `L'accusation s'ouvrira à l'étape ${st.game.settings.accusationStage}.`), h('p', { class: 'small' }, 'Continuez à rassembler les preuves.'));
    }
    if (a.status === 'submitted') {
      return h('div', { class: 'paper' }, h('span', { class: 'stamp' }, 'Transmise'), h('h2', { style: { marginTop: '10px' } }, `Suspect : ${charName(a.suspect_ref)}`),
        h('p', null, `Accusation soumise à ${fmtTime(a.submitted_at)}.`),
        st.solution ? h('button', { class: 'btn primary', onclick: () => ((ui.sub = 'revelation'), render()) }, 'Voir la révélation') : h('p', { class: 'annotation' }, "L'organisateur révélera bientôt la vérité…"));
    }
    const motives = st.scenario.intro.motives ?? [];
    const suspect = h('select', { id: 'acc-s' }, h('option', { value: '' }, '— Choisir —'), ...st.characters.map((c) => h('option', { value: c.ref, selected: a.suspect_ref === c.ref }, c.name)));
    const motive = h('select', { id: 'acc-m' }, h('option', { value: '' }, '— Choisir —'), ...motives.map((m) => h('option', { value: m.key, selected: a.motive === m.key }, m.label)));
    const chrono = h('textarea', { id: 'acc-c', placeholder: '22 h 52 : … / 23 h 20 : …' }, a.chronology);
    const contra = h('textarea', { id: 'acc-x', placeholder: 'Quelle déclaration est contredite par quelle preuve ?' }, a.contradictions);
    const expl = h('textarea', { id: 'acc-e', placeholder: 'Votre explication finale' }, a.explanation);
    [chrono, contra, expl].forEach((t, i) => (t.value = [a.chronology, a.contradictions, a.explanation][i]));
    const chosen = new Set(a.item_refs ?? []);
    const items = h('div', { class: 'choices' }, ...st.items.map((i) => h('label', { class: 'choice' }, h('input', { type: 'checkbox', value: i.ref, checked: chosen.has(i.ref) }), h('span', null, i.title, h('small', null, i.ref)))));
    const save = h('button', { class: 'btn primary' }, 'Enregistrer le brouillon');
    save.addEventListener('click', busy(save, async () => {
      try {
        await call('/accusation', { method: 'PUT', body: {
          version: a.version, suspectRef: suspect.value || null, motive: motive.value, chronology: chrono.value, contradictions: contra.value, explanation: expl.value,
          itemRefs: [...items.querySelectorAll('input:checked')].map((x) => x.value),
        } });
        toast('Accusation enregistrée. Les autres enquêteurs doivent la relire.', { tone: 'ok' });
        document.activeElement?.blur?.();
        await refresh();
      } catch (ex) {
        toast(ex.status === 409 ? `${errorMessage(ex)} Le formulaire a été actualisé.` : errorMessage(ex), { tone: 'error' });
        if (ex.status === 409) { document.activeElement?.blur?.(); await refresh(); }
      }
    }));
    const myVote = a.votes.find((v) => v.player_id === st.me.id);
    const submit = h('button', { class: 'btn danger block big' }, 'Soumettre l’accusation');
    submit.addEventListener('click', busy(submit, async () => {
      if (!(await confirmDialog("L'accusation sera définitive. La soumettre maintenant ?", { confirm: 'Soumettre', danger: true }))) return;
      try {
        await call('/accusation/submit', { method: 'POST' });
        await refresh();
      } catch (ex) { toast(errorMessage(ex), { tone: 'error' }); }
    }));
    let modePanel;
    if (mode === 'collectif') {
      const approved = st.players.filter((p) => a.votes.find((v) => v.player_id === p.id)?.approved_version === a.version);
      const approve = h('button', { class: 'btn' }, myVote?.approved_version === a.version ? 'Retirer mon approbation' : `J'approuve la version ${a.version}`);
      approve.addEventListener('click', busy(approve, async () => {
        try {
          await call('/accusation/vote', { method: 'POST', body: { approve: myVote?.approved_version !== a.version } });
          await refresh();
        } catch (ex) { toast(errorMessage(ex), { tone: 'error' }); }
      }));
      modePanel = h('div', { class: 'panel' }, h('h3', null, 'Décision collective'),
        h('p', { class: 'small muted' }, 'Chaque modification remet les approbations à zéro. Tous doivent approuver la même version.'),
        h('p', null, `${approved.length} / ${st.players.length} approbations : `, approved.map((p) => p.nickname).join(', ') || 'aucune'),
        h('div', { class: 'row' }, approve), h('p'), a.version > 0 && approved.length === st.players.length ? submit : null);
    } else if (mode === 'vote') {
      const vote = h('select', { 'aria-label': 'Mon vote', 'data-live': 'true' }, h('option', { value: '' }, '— Mon vote —'), ...st.characters.map((c) => h('option', { value: c.ref, selected: myVote?.suspect_ref === c.ref }, c.name)));
      vote.addEventListener('change', async () => {
        try {
          await call('/accusation/vote', { method: 'POST', body: { suspectRef: vote.value || null } });
          vote.blur();
          await refresh();
        } catch (ex) { toast(errorMessage(ex), { tone: 'error' }); }
      });
      const voted = a.votes.filter((v) => v.suspect_ref).length;
      modePanel = h('div', { class: 'panel' }, h('h3', null, 'Vote'), h('p', { class: 'small muted' }, 'Le suspect retenu sera celui qui obtient la majorité. Les votes restent secrets jusqu’à la soumission.'),
        vote, h('p', null, `${voted} / ${st.players.length} enquêteurs ont voté.`), voted === st.players.length ? submit : null);
    } else {
      const designated = st.game.settings.designatedPlayerId;
      modePanel = h('div', { class: 'panel' }, h('h3', null, 'Porte-parole'), h('p', null, `Seul ${playerName(designated)} peut soumettre l'accusation.`), designated === st.me.id ? submit : null);
    }
    return h('div', null,
      h('p', { class: 'small muted' }, `Brouillon commun · version ${a.version}${a.updated_by ? ` · par ${playerName(a.updated_by)}` : ''}`),
      h('div', { class: 'field' }, h('label', { for: 'acc-s' }, 'Suspect'), suspect),
      h('div', { class: 'field' }, h('label', { for: 'acc-m' }, 'Mobile'), motive),
      h('div', { class: 'field' }, h('label', { for: 'acc-c' }, 'Chronologie supposée'), chrono),
      h('div', { class: 'field' }, h('label', null, 'Preuves retenues'), st.items.length ? items : h('p', { class: 'muted' }, 'Aucune preuve découverte.')),
      h('div', { class: 'field' }, h('label', { for: 'acc-x' }, 'Contradictions identifiées'), contra),
      h('div', { class: 'field' }, h('label', { for: 'acc-e' }, 'Explication finale'), expl),
      h('div', { class: 'row end' }, save),
      h('p'), modePanel,
    );
  }

  function subRevelation(st) {
    const sol = st.solution;
    const r = sol.result;
    return h('div', { class: 'reveal' },
      h('div', { class: 'verdict' }, h('span', { class: 'stamp' }, 'Affaire résolue'), h('p', { class: 'caps muted', style: { marginTop: '20px' } }, 'Le meurtrier d’Edmond Valmont'), h('div', { class: 'culprit-name' }, sol.culpritName), h('p', { class: 'muted' }, sol.motiveText)),
      r ? h('div', { class: `panel ${r.suspectCorrect ? '' : 'truth'}`, style: { textAlign: 'center' } },
        h('p', { class: 'caps' }, 'Votre accusation'),
        h('h2', null, r.suspectCorrect ? 'Coupable démasqué' : 'Erreur judiciaire'),
        h('p', null, `Suspect ${r.suspectCorrect ? 'exact' : 'inexact'} · mobile ${r.motiveCorrect ? 'exact' : 'inexact'} · ${r.keyItemsCited.length}/${r.keyItemsTotal} preuves clés citées`),
        h('p', { class: 'big-code' }, `${r.score} / 100`),
      ) : h('p', { class: 'info-box' }, "Aucune accusation n'a été soumise."),
      h('p', { class: 'section-label' }, 'Ce qui s’est réellement passé'),
      ...sol.conclusion.map((p) => h('p', { class: 'chapter' }, p)),
      h('p', { class: 'section-label' }, 'Les contradictions'),
      h('ul', null, ...sol.contradictions.map((c) => h('li', { style: { marginBottom: '8px' } }, c))),
      h('p', { class: 'section-label' }, 'Le rôle de chaque preuve'),
      h('div', { class: 'stack' }, ...Object.entries(sol.itemRoles).map(([ref, role]) => h('div', { class: 'info-box' }, h('span', { class: `ref ${sol.keyItems.includes(ref) ? 'red' : ''}` }, `${ref}${sol.keyItems.includes(ref) ? ' · PREUVE CLÉ' : ''}`), h('div', null, role)))),
      h('p', { class: 'section-label' }, 'Les mensonges de la nuit'),
      h('div', { class: 'stack' }, ...sol.lies.filter((l) => l.lies.length).map((l) => h('div', null, h('strong', null, l.name), h('ul', null, ...l.lies.map((x) => h('li', { class: 'small' }, x)))))),
      h('p', { class: 'section-label' }, 'Chronologie complète'),
      h('ol', { class: 'timeline' }, ...sol.truthTimeline.map((t) => h('li', { class: t.truth ? 'truth' : '' }, h('time', null, fictiveTime(t.at)), h('strong', null, t.title), h('div', { class: 'small' }, t.body)))),
    );
  }

  // ── EXPLORER ──
  function tabExplorer(st) {
    return h('div', null,
      h('div', { class: 'row between' }, h('div', null, h('p', { class: 'caps red', style: { margin: 0 } }, 'Grand Hôtel des Embruns'), h('h2', null, 'Plan de l’hôtel')), h('span', { class: 'ref' }, `ÉTAPE ${st.game.stage}`)),
      h('p', { class: 'small muted' }, 'Touchez une pièce pour ouvrir sa fiche. Les zones hachurées seront accessibles plus tard.'),
      hotelPlan(st.locations, { onSelect: openLocation }),
      h('p', { class: 'section-label' }, 'Lieux'),
      h('div', { class: 'grid grid-3' }, ...st.locations.map((l) => h('button', { class: 'resume-item', style: { borderLeftColor: l.locked ? 'var(--line)' : l.visited ? 'var(--red)' : 'var(--metal)' }, onclick: () => openLocation(l.ref) },
        h('div', { class: 'spacer' }, h('strong', null, l.name), h('span', { class: 'small muted' }, l.locked ? `Étape ${l.stage}` : `${l.items.length} preuve(s) · ${l.pending.filter((p) => p.searchable).length ? 'à fouiller' : 'fouillé'}`)),
        l.locked ? icon('lock', 18) : null,
      ))),
      h('p'), scanButton('btn block'),
    );
  }

  function openLocation(ref) {
    const st = ui.state;
    const l = st.locations.find((x) => x.ref === ref);
    if (!l) return;
    if (l.locked) return modal(h('div', null, h('p', null, icon('lock'), ` ${l.name} sera accessible à l'étape ${l.stage}.`)), { title: l.name });
    const items = st.items.filter((i) => i.locationRef === ref);
    const timeline = st.timeline.filter((t) => t.location === ref);
    const searchable = l.pending.filter((p) => p.searchable).length;
    const searchBtn = h('button', { class: 'btn primary', disabled: !searchable || st.game.status !== 'running' }, icon('search'), searchable ? 'Fouiller la pièce' : 'Rien de plus à fouiller');
    let close;
    searchBtn.addEventListener('click', busy(searchBtn, async () => {
      try {
        const r = await call(`/locations/${encodeURIComponent(ref)}/search`, { method: 'POST' });
        await refresh();
        close();
        if (r.found.length) {
          toast(`${r.found.length} élément(s) découvert(s).`, { title: l.name, tone: 'discovery' });
          const first = ui.state.items.find((i) => i.ref === r.found[0]);
          if (first) openItem(first, { fresh: true });
        } else toast('Rien de nouveau.', { title: l.name });
      } catch (ex) { toast(errorMessage(ex), { tone: 'error' }); }
    }));
    close = modal(h('div', { class: 'paper' },
      h('div', { class: 'loc-head' }, h('div', { class: 'room-thumb-wrap' }, roomThumb(ref)), h('div', null, h('span', { class: 'ref' }, `LIEU · ${ref}`), h('h2', null, l.name), l.hours ? h('p', { class: 'small' }, icon('clock', 16), ' ', l.hours) : null)),
      h('p', { style: { marginTop: '12px' } }, l.description),
      l.characters.length ? h('p', null, h('strong', null, 'Personnes liées : '), l.characters.map(charName).join(', ')) : null,
      timeline.length ? h('div', null, h('p', { class: 'annotation' }, 'Ce que l’on sait'), h('ul', { class: 'movements' }, ...timeline.map((t) => h('li', null, h('time', null, fictiveTime(t.at)), h('span', null, t.title))))) : null,
      h('p', { class: 'annotation' }, `Preuves trouvées ici (${items.length})`),
      items.length ? h('div', { class: 'stack' }, ...items.map((i) => h('button', { class: 'btn block', style: { justifyContent: 'flex-start', background: 'transparent', color: 'var(--paper-ink)', borderColor: '#b9b1a3' }, onclick: () => openItem(i) }, i.title))) : h('p', { class: 'small muted' }, 'Aucune pour l’instant.'),
      l.pending.length ? h('div', null, h('p', { class: 'annotation' }, 'Éléments non découverts'), ...l.pending.map((p) => h('div', { class: 'pending' }, icon(p.searchable ? 'search' : 'lock', 18), h('div', null, h('div', null, p.teaser || 'Élément scellé'), h('div', { class: 'tiny muted' }, p.reason))))) : null,
      h('div', { class: 'row', style: { marginTop: '14px' } }, searchBtn, h('button', { class: 'btn', style: { background: 'transparent', color: 'var(--paper-ink)', borderColor: '#b9b1a3' }, onclick: () => (close(), openScanner(doScan)) }, icon('scan'), 'Scanner une carte')),
    ), { className: 'paper-modal', wide: true });
  }

  // ── PREUVES ──
  function tabPreuves(st) {
    const f = (ui.evFilter ??= { kind: '', location: '', by: '' });
    const sel = (key, label, options) => h('select', { 'aria-label': label, onchange: (e) => ((f[key] = e.target.value), render()) }, h('option', { value: '' }, label), ...options.map(([v, l]) => h('option', { value: v, selected: f[key] === v }, l)));
    const rows = st.items.filter((i) => (!f.kind || i.kind === f.kind) && (!f.location || i.locationRef === f.location) && (!f.by || i.discoveredBy === f.by)).reverse();
    return h('div', null,
      scanButton(),
      h('div', { class: 'row between', style: { marginTop: '18px' } }, h('h2', { style: { margin: 0 } }, 'Pièces du dossier'), h('span', { class: 'ref' }, `${st.items.length} DÉCOUVERTE(S)`)),
      h('div', { class: 'filters', style: { marginTop: '10px' } },
        sel('kind', 'Type', Object.entries(KIND_LABEL)),
        sel('location', 'Lieu', st.locations.map((l) => [l.ref, l.name])),
        sel('by', 'Découvreur', st.players.map((p) => [p.id, p.nickname])),
      ),
      rows.length ? h('div', { class: 'evidence-list' }, ...rows.map((i) => h('button', { class: 'evidence', onclick: () => openItem(i) },
        evidenceArt(i.type), h('div', null, h('span', { class: 'ref' }, `${i.ref} · ${KIND_LABEL[i.kind]}`), h('strong', null, i.title), h('span', { class: 'tiny muted' }, `${locName(i.locationRef) || 'Enveloppe'} · ${fmtTime(i.discoveredAt)}`)),
        !ui.seen.has(i.ref) ? h('span', { class: 'stamp new' }, 'Nouveau') : null,
      ))) : h('div', { class: 'empty' }, h('span', { class: 'hand' }, 'Le dossier est encore vide.'), 'Fouillez les pièces depuis EXPLORER ou scannez les cartes.'),
    );
  }

  function markSeen(ref) {
    if (ui.seen.has(ref)) return;
    ui.seen.add(ref);
    try { localStorage.setItem(`dx.seen.${session.gameId}`, JSON.stringify([...ui.seen])); } catch { /* ignore */ }
    renderTabbar();
  }

  function itemBody(i) {
    return [
      i.content.body ? h('p', null, i.content.body) : null,
      i.content.details?.length ? h('ul', null, ...i.content.details.map((d) => h('li', null, d))) : null,
      i.content.transcript ? h('div', { class: 'transcript' }, i.content.transcript) : null,
      i.content.note ? h('p', { class: 'annotation' }, i.content.note) : null,
    ];
  }

  function openItem(i, { fresh } = {}) {
    markSeen(i.ref);
    const st = ui.state;
    const onBoard = st.board.items.some((b) => b.kind === 'indice' && b.ref === i.ref);
    const pin = h('button', { class: 'btn small', disabled: onBoard || st.game.status !== 'running', style: { background: 'transparent', color: 'var(--paper-ink)', borderColor: '#b9b1a3' } }, icon('tableau', 16), onBoard ? 'Déjà au tableau' : 'Placer au tableau');
    pin.addEventListener('click', busy(pin, async () => {
      try {
        await call('/board/items', { method: 'POST', body: { kind: 'indice', ref: i.ref, x: 60 + Math.random() * 400, y: 60 + Math.random() * 300 } });
        pin.textContent = 'Placé au tableau';
        refresh();
      } catch (ex) { toast(errorMessage(ex), { tone: 'error' }); }
    }));
    modal(h('div', { class: 'paper' },
      fresh ? h('span', { class: 'stamp', style: { float: 'right' } }, 'Nouvelle pièce') : null,
      h('span', { class: 'ref' }, `${KIND_LABEL[i.kind] ?? 'Pièce'} · ${i.ref}`),
      h('div', { style: { display: 'flex', gap: '14px', alignItems: 'center', margin: '8px 0' } }, h('span', { style: { color: '#514b43' } }, evidenceArt(i.type, 56)), h('h2', { style: { margin: 0 } }, i.title)),
      ...itemBody(i),
      h('p', { class: 'tiny muted', style: { marginTop: '14px' } },
        `${locName(i.locationRef) ? `${locName(i.locationRef)} · ` : ''}découvert ${i.discoveredBy ? `par ${playerName(i.discoveredBy)} ` : ''}le ${fmtDateTime(i.discoveredAt)}`),
      h('div', { class: 'row' }, pin),
    ), { className: 'paper-modal', wide: true });
  }

  function openEnvelope(e) {
    const st = ui.state;
    const unlocked = st.items.filter((i) => e.unlocks.includes(i.ref));
    modal(h('div', { class: 'paper' },
      h('span', { class: 'stamp' }, 'Enveloppe ouverte'), h('h2', { style: { marginTop: '10px' } }, e.title), h('p', null, e.content?.body),
      unlocked.length ? h('div', { class: 'stack' }, ...unlocked.map((i) => h('button', { class: 'btn block', style: { background: 'transparent', color: 'var(--paper-ink)', borderColor: '#b9b1a3' }, onclick: () => openItem(i) }, i.title))) : null,
    ), { className: 'paper-modal' });
  }

  // ── TABLEAU ──
  function tabTableau(st) {
    ui.board = boardView(st, { call, refresh, playerName, charName, locName, openItem });
    return ui.board.el;
  }

  // ── PROFIL ──
  function tabProfil(st) {
    const c = st.myCharacter;
    const recovery = store.player(session.gameId)?.recovery;
    const footer = h('div', null,
      h('p', { class: 'section-label' }, 'Cet appareil'),
      h('div', { class: 'info-box' },
        h('p', null, `Enquêteur : ${st.me.nickname} · partie ${st.game.code}`),
        recovery ? h('p', null, 'Code personnel de récupération : ', h('strong', { class: 'mono' }, recovery)) : h('p', { class: 'small muted' }, "Code personnel non conservé sur cet appareil. L'organisateur peut en générer un nouveau."),
        h('button', { class: 'linkish', onclick: async () => {
          if (await confirmDialog("Oublier cette partie sur cet appareil ? Vous pourrez revenir avec votre code personnel.", { confirm: 'Oublier' })) {
            store.forgetPlayer(session.gameId);
            navigate('/');
          }
        } }, 'Se déconnecter de cet appareil'),
      ),
    );
    if (!c) return h('div', null, h('div', { class: 'empty' }, "Aucun personnage ne vous est attribué. Demandez à l'organisateur."), footer);
    const p = c.private;
    const shareBtn = (key, label) => {
      const already = c.shared.includes(key);
      const b = h('button', { class: 'btn small', disabled: already || !st.game.settings.allowSharing || st.game.status !== 'running', style: { background: 'transparent', color: 'var(--paper-ink)', borderColor: '#b9b1a3' } }, icon('share', 16), already ? 'Partagé' : `Révéler au groupe`);
      b.addEventListener('click', busy(b, async () => {
        if (!(await confirmDialog(`Révéler « ${label} » à tous les enquêteurs ? Ce partage est définitif et journalisé.`, { confirm: 'Révéler' }))) return;
        try {
          await call('/share', { method: 'POST', body: { key } });
          toast('Information partagée avec le groupe.', { tone: 'ok' });
          refresh();
        } catch (ex) { toast(errorMessage(ex), { tone: 'error' }); }
      }));
      return b;
    };
    return h('div', null,
      h('p', { class: 'caps red' }, 'Mon personnage — strictement personnel'),
      h('div', { class: 'paper' }, h('div', { class: 'tape' }),
        h('div', { class: 'row between' }, h('span', { class: 'ref' }, `CARTE D'IDENTITÉ · ${c.ref}`), h('span', { class: 'stamp' }, 'Secret')),
        h('div', { class: 'id-card', style: { marginTop: '12px' } }, portrait(c, 110), h('div', null, h('h2', null, c.name), h('p', null, `${c.role}${c.age ? `, ${c.age} ans` : ''}`), h('p', { class: 'small' }, c.relations.join(' · ')))),
        h('p', { class: 'annotation', style: { marginTop: '14px' } }, 'Biographie'), h('p', null, p.biography),
        h('p', { class: 'annotation' }, 'Alibi que tu as déclaré'), h('p', null, c.alibi),
        h('p', { class: 'annotation' }, 'Ce que tu as réellement fait'),
        h('ul', { class: 'movements' }, ...(p.realMovements ?? []).map((m) => h('li', null, h('time', null, fictiveTime(m.at)), h('span', null, m.text)))),
        h('p', { class: 'annotation' }, 'Tes secrets'), ...(p.secrets ?? []).map((x) => h('div', { class: 'secret' }, x)),
        h('p', { class: 'annotation' }, 'Motivations'), h('p', null, p.motivations),
        h('p', { class: 'annotation' }, 'Objectifs'), h('ol', null, ...(p.objectives ?? []).map((o) => h('li', null, o))),
        c.documents.length ? h('div', null, h('p', { class: 'annotation' }, 'Documents personnels'), ...c.documents.map((d) => h('div', { class: 'secret' }, h('strong', null, d.title), ...itemBody(d), h('div', { class: 'row' }, shareBtn(d.ref, d.title))))) : null,
        p.shareable?.length ? h('div', null, h('p', { class: 'annotation' }, 'Informations que tu peux révéler'), h('p', { class: 'small muted' }, 'Mentir fait partie du jeu. Révéler une information la rend visible de tous, définitivement.'),
          ...p.shareable.map((x) => h('div', { class: 'secret' }, h('strong', null, x.label), h('p', { class: 'small', style: { margin: '4px 0 8px' } }, x.text), shareBtn(x.key, x.label)))) : null,
      ),
      footer,
    );
  }

  api('/api/config').then((c) => (ui.config = c)).catch(() => {});
  main.append(h('div', { class: 'loading-screen' }, h('div', null, logo(40), h('p', null, 'OUVERTURE DU DOSSIER'))));
  refresh();
  // Retour au premier plan (Safari suspend les onglets) : reconnexion et rattrapage.
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    if (ui.syncStatus !== 'live') stream.reconnect();
    scheduleRefresh(100);
  };
  document.addEventListener('visibilitychange', onVisible);
  return {
    el: root,
    destroy() {
      stream.stop();
      ui.board?.destroy?.();
      document.removeEventListener('visibilitychange', onVisible);
      clearTimeout(refreshTimer);
    },
  };
}
