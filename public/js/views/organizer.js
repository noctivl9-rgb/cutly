// Centre de contrôle de l'organisateur d'une partie.
import { api, busy, confirmDialog, connectStream, errorMessage, fictiveTime, fmtTime, h, link, modal, navigate, STATUS_LABEL, store, toast } from '../core.js';
import { logo, icon, portrait } from '../art.js';

export function organizerView(codeParam) {
  const code = decodeURIComponent(codeParam).toUpperCase();
  const frag = new URLSearchParams(location.hash.slice(1));
  const root = h('div');
  const syncEl = h('span', { class: 'sync connecting' }, 'Connexion');
  const main = h('main', { class: 'wrap' }, h('div', { class: 'loading-screen' }, 'CONSOLE ORGANISATEUR'));
  root.append(h('header', { class: 'topbar' }, h('div', { class: 'topbar-inner' }, link('/', { class: 'brand' }, logo(22), 'DOSSIER X'), h('span', { class: 'case-chip' }, `CONSOLE · ${code}`), h('span', { class: 'spacer' }), syncEl)), main);
  let stream;
  let state;
  let gameId;
  let headers = {};
  let refreshTimer;

  (async () => {
    let g;
    try {
      g = await api(`/api/games/lookup/${encodeURIComponent(code)}`);
    } catch (ex) {
      main.replaceChildren(h('div', { class: 'error-box' }, errorMessage(ex)));
      return;
    }
    gameId = g.id;
    if (frag.get('t')) {
      store.saveOrganizer({ gameId, code: g.code, token: frag.get('t') });
      history.replaceState(null, '', location.pathname);
    }
    const org = store.organizer(gameId);
    if (org) headers['x-dx-organizer'] = org.token;
    if (store.admin()) headers['x-dx-admin'] = store.admin();
    await refresh();
    if (!state) return;
    stream = connectStream(`/api/games/${gameId}/organizer/stream`, headers, {
      getSince: () => state?.lastEventId,
      onStatus: (st) => {
        syncEl.className = `sync ${st}`;
        syncEl.textContent = { live: 'En direct', connecting: 'Connexion', reconnecting: 'Reconnexion', offline: 'Hors ligne', denied: 'Accès refusé' }[st] ?? st;
      },
      onReady: () => schedule(50),
      onEvent: (ev, transient) => {
        if (!transient && ev.type === 'item.discovered') toast(`${ev.payload.title}${ev.payload.by ? ` — ${ev.payload.by}` : ''}`, { title: 'Découverte', tone: 'discovery', timeout: 3000 });
        schedule(transient ? 500 : 200);
      },
    });
  })();

  const schedule = (ms) => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, ms);
  };
  const call = (path, opts = {}) => api(`/api/games/${gameId}${path}`, { ...opts, organizer: headers['x-dx-organizer'], admin: headers['x-dx-admin'] });

  async function refresh() {
    try {
      state = await call('/organizer');
      const active = document.activeElement;
      if (active && main.contains(active) && /^(TEXTAREA|INPUT)$/.test(active.tagName)) return;
      const y = window.scrollY;
      main.replaceChildren(render(state));
      window.scrollTo(0, y);
    } catch (ex) {
      if (ex.status === 403 || ex.status === 401) {
        main.replaceChildren(h('div', { class: 'narrow', style: { margin: '0 auto' } },
          h('h1', null, 'Accès organisateur requis'),
          h('p', { class: 'muted' }, "Cet appareil ne détient pas le jeton d'organisateur de cette partie. Ouvrez le lien organisateur secret reçu à la création, ou connectez-vous à l'administration."),
          link('/admin', { class: 'btn' }, 'Administration'),
        ));
      } else if (!state) main.replaceChildren(h('div', { class: 'error-box' }, errorMessage(ex)));
    }
  }

  const act = (action, body, { confirm, danger } = {}) => async () => {
    if (confirm && !(await confirmDialog(confirm, { danger }))) return;
    try {
      const r = await call(`/organizer/${action}`, { method: 'POST', body: body ?? {} });
      await refresh();
      return r;
    } catch (ex) {
      if (ex.status === 409 && action === 'start' && ex.data?.problems) {
        if (await confirmDialog(`${ex.message} Lancer quand même ?`, { confirm: 'Forcer le lancement' })) return act('start', { force: true })();
        return;
      }
      if (ex.status === 409 && action === 'reveal') {
        if (await confirmDialog(`${ex.message}`, { confirm: 'Révéler sans accusation', danger: true })) return act('reveal', { force: true })();
        return;
      }
      toast(errorMessage(ex), { tone: 'error' });
    }
  };
  const btn = (label, fn, cls = 'btn') => {
    const b = h('button', { class: cls }, label);
    b.addEventListener('click', busy(b, fn));
    return b;
  };

  function render(st) {
    const g = st.game;
    const charName = (ref) => st.characters.find((c) => c.ref === ref)?.name ?? '—';
    const playerName = (id) => st.players.find((p) => p.id === id)?.nickname ?? '—';
    const inviteUrl = `${location.origin}/rejoindre/${g.code}?i=${g.invite_token}`;
    const qrBox = h('div', { class: 'qr' });
    fetch(`/api/games/${gameId}/invite.svg`, { headers }).then((r) => r.ok ? r.blob() : null).then((b) => b && qrBox.append(h('img', { src: URL.createObjectURL(b), alt: `QR code d'invitation pour la partie ${g.code}` })));
    const orgLink = store.organizer(gameId) ? `${location.origin}/organisateur/${g.code}#t=${store.organizer(gameId).token}` : null;

    const controls = h('div', { class: 'row' },
      g.status === 'lobby' ? btn('Lancer la partie', act('start'), 'btn primary') : null,
      g.status === 'running' ? btn('Pause', act('pause')) : null,
      g.status === 'paused' ? btn('Reprendre', act('resume'), 'btn primary') : null,
      g.status !== 'ended' ? btn('Terminer', act('end', {}, { confirm: 'Terminer définitivement la partie ? Les joueurs ne pourront plus agir.', danger: true }), 'btn danger') : null,
      h('a', { class: 'btn ghost', href: '#', onclick: async (e) => {
        e.preventDefault();
        const res = await fetch(`/api/games/${gameId}/export`, { headers });
        if (!res.ok) return toast('Export impossible.', { tone: 'error' });
        const a = h('a', { href: URL.createObjectURL(await res.blob()), download: `dossier-x-${g.code}.json` });
        a.click();
      } }, 'Exporter'),
    );

    const lobbyPanel = h('section', { class: 'panel' },
      h('div', { class: 'panel-title' }, h('h2', null, "Salle d'attente"), h('span', { class: `status-pill ${g.status}` }, STATUS_LABEL[g.status])),
      h('div', { class: 'invite' }, qrBox, h('div', null,
        h('div', { class: 'ref' }, 'CODE DE PARTIE'), h('div', { class: 'big-code' }, g.code),
        h('p', { class: 'small muted' }, `${st.scenario.title} · version ${st.scenario.version}`),
        h('p', null, `${st.players.length} / ${g.max_players} joueurs · ${g.max_players - st.players.length} place(s) libre(s) · ${st.players.filter((p) => p.ready).length} prêt(s)`),
        h('div', { class: 'row' }, btn('Copier le lien', async () => { await navigator.clipboard?.writeText(inviteUrl); toast('Lien d’invitation copié.', { tone: 'ok' }); }, 'btn small'),
          link(`/rejoindre/${g.code}?i=${g.invite_token}`, { class: 'btn small ghost' }, 'Jouer aussi')),
      )),
      st.launch && !st.launch.ok ? h('div', { class: 'draft-ribbon', style: { marginTop: '12px' } }, st.launch.problems.join(' ')) : null,
      st.launch?.ok ? h('div', { class: 'ok-ribbon', style: { marginTop: '12px' } }, 'Les conditions de lancement sont remplies.') : null,
      orgLink ? h('details', { style: { marginTop: '12px' } }, h('summary', { class: 'small muted' }, 'Lien organisateur secret (pour un autre appareil)'),
        h('p', { class: 'small' }, "Ce lien donne le contrôle de cette partie uniquement. Ne le partagez pas avec les joueurs."),
        h('input', { type: 'text', readonly: true, value: orgLink, onfocus: (e) => e.target.select() })) : null,
    );

    const players = h('section', { class: 'panel' },
      h('div', { class: 'panel-title' }, h('h2', null, 'Joueurs')),
      st.players.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, h('th', null, 'Joueur'), h('th', null, 'Personnage'), h('th', null, 'Preuves'), h('th', null, 'Vu'), h('th', null, ''))),
        h('tbody', null, ...st.players.map((p) => {
          const sel = h('select', { 'aria-label': `Personnage de ${p.nickname}` }, h('option', { value: '' }, '— aucun —'), ...st.characters.map((c) => h('option', { value: c.ref, selected: p.character_ref === c.ref }, c.name)));
          sel.addEventListener('change', async () => {
            await act('assign', { playerId: p.id, characterRef: sel.value || null })();
          });
          const more = h('button', { class: 'btn small ghost' }, '…');
          more.addEventListener('click', () => {
            const close = modal(h('div', { class: 'stack' },
              btn('Générer un nouveau code personnel', async () => {
                const r = await act('reset-recovery', { playerId: p.id })();
                if (r?.recoveryCode) { close(); modal(h('div', null, h('p', null, `Nouveau code personnel de ${p.nickname} :`), h('p', { class: 'big-code', style: { textAlign: 'center' } }, r.recoveryCode), h('p', { class: 'small muted' }, 'Communiquez-le uniquement à ce joueur. Il pourra se reconnecter via « Récupérer mon accès ».')), { title: 'Code personnel' }); }
              }, 'btn block'),
              st.game.settings.accusationMode === 'designe' ? btn('Désigner comme porte-parole', async () => (close(), act('designate', { playerId: p.id })()), 'btn block') : null,
              btn('Retirer de la partie', async () => (close(), act('remove-player', { playerId: p.id }, { confirm: `Retirer ${p.nickname} ? Son personnage sera libéré.`, danger: true })()), 'btn danger block'),
            ), { title: p.nickname });
          });
          return h('tr', null,
            h('td', null, h('span', { class: `online ${p.online ? 'on' : ''}` }), p.nickname, p.ready && g.status === 'lobby' ? h('span', { class: 'chip', style: { marginLeft: '6px' } }, 'prêt') : null, g.settings.designatedPlayerId === p.id ? h('span', { class: 'chip', style: { marginLeft: '6px' } }, 'porte-parole') : null),
            h('td', null, sel), h('td', null, String(p.discoveries)), h('td', { class: 'small muted' }, fmtTime(p.last_seen_at)), h('td', null, more));
        })),
      )) : h('p', { class: 'muted' }, 'Aucun joueur pour le moment. Faites scanner le QR code d’invitation.'),
    );

    const stages = h('section', { class: 'panel' },
      h('div', { class: 'panel-title' }, h('h2', null, 'Progression'), h('span', { class: 'ref' }, g.settings.progression === 'auto' ? 'AUTOMATIQUE' : 'MANUELLE')),
      h('div', { class: 'stage-list' }, ...st.scenario.stages.map((s) => h('div', { class: `stage ${s.idx === g.current_stage ? 'current' : ''} ${s.idx < g.current_stage ? 'done' : ''}` },
        h('span', { class: 'num' }, String(s.idx).padStart(2, '0')), h('div', null, h('strong', null, s.title), h('div', { class: 'small muted' }, s.description)),
        s.idx !== g.current_stage ? btn(s.idx > g.current_stage ? 'Débloquer' : 'Revenir', act('stage', { stage: s.idx }, { confirm: `Passer la partie à l'étape ${s.idx} ?` }), 'btn small') : h('span', { class: 'chip' }, 'Actuelle'),
      ))),
    );

    const envelopes = h('section', { class: 'panel' },
      h('div', { class: 'panel-title' }, h('h2', null, 'Enveloppes')),
      h('div', { class: 'stack' }, ...st.envelopes.map((e) => h('div', { class: 'row between' },
        h('div', null, h('strong', null, e.title), h('div', { class: 'small muted' }, `Étape ${e.stage} · ${e.teaser}`)),
        e.opened ? h('span', { class: 'chip' }, 'Ouverte') : btn('Ouvrir', act('envelope', { ref: e.ref }, { confirm: `Ouvrir « ${e.title} » pour tous les joueurs ?` }), 'btn small primary'),
      ))),
    );

    const annText = h('textarea', { placeholder: 'Message affiché sur tous les téléphones', maxlength: 500, style: { minHeight: '70px' } });
    const live = h('section', { class: 'panel' },
      h('div', { class: 'panel-title' }, h('h2', null, 'En direct')),
      h('label', null, 'Annonce'), annText,
      h('div', { class: 'row end', style: { margin: '8px 0 16px' } }, btn('Envoyer', async () => { if (!annText.value.trim()) return; await act('announce', { text: annText.value })(); annText.value = ''; }, 'btn primary small')),
      h('label', null, 'Événements'),
      h('div', { class: 'stack' }, ...st.events.map((e) => h('div', { class: 'row between' }, h('div', null, h('strong', null, e.title), h('div', { class: 'small muted' }, e.body)), btn('Déclencher', act('event', { ref: e.ref }, { confirm: `Déclencher « ${e.title} » ?` }), 'btn small')))),
    );

    const acc = st.accusation;
    const accPanel = h('section', { class: 'panel' },
      h('div', { class: 'panel-title' }, h('h2', null, 'Accusation'), h('span', { class: 'ref' }, { vote: 'VOTE', collectif: 'COLLECTIVE', designe: 'PORTE-PAROLE' }[g.settings.accusationMode])),
      acc.status === 'submitted'
        ? h('div', null, h('p', null, `Soumise à ${fmtTime(acc.submitted_at)} — suspect : `, h('strong', null, charName(acc.suspect_ref))), acc.result ? h('p', { class: 'small' }, `Score ${acc.result.score}/100 · suspect ${acc.result.suspectCorrect ? 'exact' : 'inexact'} · mobile ${acc.result.motiveCorrect ? 'exact' : 'inexact'} · ${acc.result.keyItemsCited.length}/${acc.result.keyItemsTotal} preuves clés`) : null)
        : h('div', null,
          h('p', { class: 'small' }, `Brouillon version ${acc.version}. Suspect proposé : ${charName(acc.suspect_ref)}.`),
          h('p', { class: 'small muted' }, `Votes / approbations : ${acc.votes.map((v) => `${playerName(v.player_id)} ${v.suspect_ref ? `→ ${charName(v.suspect_ref)}` : ''}${v.approved_version === acc.version ? ' ✓' : ''}`).join(' · ') || 'aucun'}`),
          btn("Clore et soumettre l'accusation", async () => {
            if (!(await confirmDialog("Soumettre l'accusation en l'état, au nom du groupe ?"))) return;
            try { await call('/organizer/accusation/submit', { method: 'POST' }); await refresh(); } catch (ex) { toast(errorMessage(ex), { tone: 'error' }); }
          }, 'btn small')),
      h('hr'),
      g.revealed ? h('p', { class: 'ok-ribbon' }, 'La solution a été révélée aux joueurs.') : btn('Révéler la solution', act('reveal', {}, { confirm: 'Révéler la solution complète à tous les joueurs ?', danger: true }), 'btn danger block'),
    );

    const items = h('section', { class: 'panel' },
      h('div', { class: 'panel-title' }, h('h2', null, 'Preuves'), h('span', { class: 'ref' }, `${st.items.filter((i) => i.discovered).length} / ${st.items.filter((i) => i.confidentiality !== 'personnel').length}`)),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('tbody', null, ...st.items.filter((i) => i.confidentiality !== 'personnel').map((i) => h('tr', null,
        h('td', { class: 'mono small' }, i.ref), h('td', null, i.title, h('div', { class: 'tiny muted' }, i.discovery.modes.join(' · '))),
        h('td', { class: 'small' }, i.discovered ? `✓ ${fmtTime(i.discoveredAt)} · ${playerName(i.discoveredBy)}` : h('span', { class: 'muted' }, i.access?.ok ? 'accessible' : i.access?.reason ?? '')),
      ))))),
    );

    const truth = h('details', { class: 'panel truth' },
      h('summary', null, h('strong', null, 'Vérité interne — réservé à l’organisateur')),
      h('p', { class: 'small muted' }, 'Ne montrez pas cet écran aux joueurs.'),
      h('h3', null, `Coupable : ${st.solution.culpritName}`), h('p', null, st.solution.motiveText),
      h('h3', null, 'Contradictions'), h('ul', null, ...st.solution.contradictions.map((c) => h('li', { class: 'small' }, c))),
      h('h3', null, 'Chronologie réelle'), h('ol', { class: 'timeline' }, ...st.solution.truthTimeline.map((t) => h('li', { class: t.truth ? 'truth' : '' }, h('time', null, fictiveTime(t.at)), h('strong', null, t.title), h('div', { class: 'small' }, t.body)))),
      h('h3', null, 'Fiches confidentielles'),
      ...st.characters.map((c) => h('details', { style: { margin: '8px 0' } }, h('summary', null, c.name),
        h('p', { class: 'small' }, c.private.biography), h('ul', null, ...(c.private.secrets ?? []).map((x) => h('li', { class: 'small' }, x))), h('p', { class: 'small red' }, (c.truth.lies ?? []).join(' ')))),
    );

    const journal = h('section', { class: 'panel' },
      h('div', { class: 'panel-title' }, h('h2', null, 'Journal')),
      h('ol', { class: 'timeline journal' }, ...st.journal.slice(0, 60).map((e) => h('li', null, h('time', null, fmtTime(e.at)), h('div', { class: 'small' }, `${e.type}${e.payload?.title ? ` — ${e.payload.title}` : e.payload?.nickname ? ` — ${e.payload.nickname}` : e.payload?.text ? ` — ${e.payload.text}` : ''}`)))),
      st.scans.length ? h('details', null, h('summary', { class: 'small muted' }, `Derniers scans (${st.scans.length})`), h('ul', null, ...st.scans.slice(0, 30).map((sc) => h('li', { class: 'small mono' }, `${fmtTime(sc.created_at)} ${sc.kind}/${sc.key} → ${sc.outcome} (${playerName(sc.player_id)})`)))) : null,
    );

    return h('div', null,
      h('div', { class: 'row between', style: { marginBottom: '16px' } }, h('div', null, h('p', { class: 'ref', style: { margin: 0 } }, `DOSSIER ${st.scenario.caseNumber} · ÉTAPE ${g.current_stage}`), h('h1', { style: { margin: 0 } }, st.scenario.title)), controls),
      h('div', { class: 'console-grid' },
        h('div', { class: 'stack' }, lobbyPanel, players, items, journal),
        h('div', { class: 'stack' }, stages, envelopes, live, accPanel, truth),
      ),
    );
  }

  return {
    el: root,
    destroy() {
      stream?.stop();
      clearTimeout(refreshTimer);
    },
  };
}
