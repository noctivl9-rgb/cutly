// Administration : enquêtes et versions, parties, QR codes et impression, audit.
import { api, busy, confirmDialog, errorMessage, fmtDateTime, h, link, modal, navigate, STATUS_LABEL, store, toast } from '../core.js';
import { logo } from '../art.js';

const ENTITY_LABEL = { characters: 'Personnages', locations: 'Lieux', items: 'Indices, témoignages, documents', envelopes: 'Enveloppes', timeline: 'Chronologie', stages: 'Étapes', events: 'Événements' };
const TEMPLATES = {
  characters: { ref: 'PER-NOUVEAU', sort: 99, name: '', role: '', public: { age: 40, portrait: { accessory: 'col', tone: '#9a8070' }, presentation: '', relations: [], alibi: '', declaredMovements: [] }, private: { biography: '', realMovements: [], secrets: [], motivations: '', objectives: [], shareable: [] }, truth: { culprit: false, lies: [] } },
  locations: { ref: 'LIEU-NOUVEAU', sort: 99, name: '', stage: 1, public: { qrKey: 'nouveau', description: '', hours: '', characters: [] } },
  items: { ref: 'IDX-NOUVEAU', kind: 'indice', type: 'objet', title: '', location_ref: null, confidentiality: 'commun', owner_character: null, stage: 1, discovery: { modes: ['search', 'qr'] }, teaser: '', content: { body: '' }, relations: [] },
  envelopes: { ref: 'ENV-NOUVEAU', sort: 99, title: '', stage: 1, teaser: '', content: { body: '' }, unlocks: [] },
  timeline: { ref: 'T-NOUVEAU', sort: 99, at_label: '23:00', title: '', body: '', visibility: { type: 'public' }, characters: [], location_ref: null },
  stages: { idx: 9, title: '', description: '', unlock: { type: 'organizer' } },
  events: { ref: 'EVT-NOUVEAU', title: '', body: '', unlocks: [] },
};
// Conversion d'une entité chargée vers les colonnes de la base
function toRow(entity, e) {
  switch (entity) {
    case 'items': return { ref: e.ref, kind: e.kind, type: e.type, title: e.title, location_ref: e.locationRef, confidentiality: e.confidentiality, owner_character: e.ownerCharacter, stage: e.stage, discovery: e.discovery, teaser: e.teaser, content: e.content, relations: e.relations };
    case 'timeline': return { ref: e.ref, sort: e.sort, at_label: e.at, title: e.title, body: e.body, visibility: e.visibility, characters: e.characters, location_ref: e.location };
    default: return e;
  }
}

export function adminView() {
  const root = h('div');
  const main = h('main', { class: 'wrap' });
  const who = h('span', { class: 'small muted' });
  root.append(h('header', { class: 'topbar' }, h('div', { class: 'topbar-inner' }, link('/', { class: 'brand' }, logo(22), 'DOSSIER X'), h('span', { class: 'case-chip' }, 'ADMINISTRATION'), h('span', { class: 'spacer' }), who)), main);
  let me = null;
  let tab = 'enquetes';
  const A = (path, opts = {}) => api(path, { ...opts, admin: true });

  async function start() {
    if (!store.admin()) return loginForm();
    try {
      me = await A('/api/admin/me');
      who.replaceChildren(`${me.email} · ${me.role}`, ' ', h('button', { class: 'linkish', onclick: logout }, 'Déconnexion'));
      render();
    } catch {
      store.saveAdmin(null);
      loginForm();
    }
  }
  async function logout() {
    await A('/api/admin/logout', { method: 'POST' }).catch(() => {});
    store.saveAdmin(null);
    who.replaceChildren();
    loginForm();
  }

  function loginForm() {
    const email = h('input', { type: 'email', id: 'ae', autocomplete: 'username', required: true });
    const pw = h('input', { type: 'password', id: 'ap', autocomplete: 'current-password', required: true });
    const err = h('div');
    const b = h('button', { class: 'btn primary block', type: 'submit' }, 'Connexion');
    const f = h('form', { class: 'panel narrow', style: { margin: '40px auto' } },
      h('h1', null, 'Administration'),
      h('p', { class: 'small muted' }, 'Accès réservé aux administrateurs et auteurs d’enquêtes. Les organisateurs de partie utilisent leur lien de console.'),
      h('div', { class: 'field' }, h('label', { for: 'ae' }, 'E-mail'), email),
      h('div', { class: 'field' }, h('label', { for: 'ap' }, 'Mot de passe'), pw),
      err, b,
    );
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      busy(b, async () => {
        try {
          const r = await api('/api/admin/login', { method: 'POST', body: { email: email.value, password: pw.value } });
          store.saveAdmin(r.token);
          start();
        } catch (ex) { err.replaceChildren(h('div', { class: 'error-box' }, errorMessage(ex))); }
      })();
    });
    main.replaceChildren(f);
  }

  function render() {
    const tabs = [['enquetes', 'Enquêtes'], ['parties', 'Parties'], ['impression', 'QR & impression'], ['audit', 'Journal & comptes']];
    const body = h('div', { style: { marginTop: '18px' } }, h('div', { class: 'skeleton', style: { height: '200px' } }));
    main.replaceChildren(h('div', { class: 'seg' }, ...tabs.map(([k, l]) => h('button', { 'aria-pressed': String(tab === k), onclick: () => ((tab = k), render()) }, l))), body);
    ({ enquetes: viewScenarios, parties: viewGames, impression: viewPrint, audit: viewAudit })[tab](body).catch((ex) => body.replaceChildren(h('div', { class: 'error-box' }, errorMessage(ex))));
  }

  // ── Enquêtes ──
  async function viewScenarios(body) {
    const list = await A('/api/admin/scenarios');
    const slug = h('input', { type: 'text', placeholder: 'identifiant (ex. manoir)' });
    const num = h('input', { type: 'text', placeholder: '002', maxlength: 3, inputmode: 'numeric' });
    const title = h('input', { type: 'text', placeholder: 'Titre' });
    const create = h('button', { class: 'btn small primary' }, 'Créer');
    create.addEventListener('click', busy(create, async () => {
      try {
        const r = await A('/api/admin/scenarios', { method: 'POST', body: { slug: slug.value, caseNumber: num.value, title: title.value } });
        editVersion(body, r.versionId);
      } catch (ex) { toast(errorMessage(ex), { tone: 'error' }); }
    }));
    body.replaceChildren(
      ...list.map((sc) => h('section', { class: 'panel', style: { marginBottom: '12px' } },
        h('div', { class: 'panel-title' }, h('span', { class: 'ref' }, `DOSSIER ${sc.caseNumber}`), h('h2', null, sc.versions[0].title), h('span', { class: 'spacer' }),
          !sc.versions.some((v) => v.status === 'draft') ? (() => { const b = h('button', { class: 'btn small' }, 'Nouveau brouillon'); b.addEventListener('click', busy(b, async () => { const r = await A(`/api/admin/scenarios/${sc.id}/draft`, { method: 'POST' }); editVersion(body, r.versionId); })); return b; })() : null),
        h('table', { class: 'table' }, h('tbody', null, ...sc.versions.map((v) => h('tr', null,
          h('td', { class: 'mono' }, `v${v.version}`), h('td', null, h('span', { class: `status-pill ${v.status === 'published' ? 'running' : v.status === 'draft' ? 'paused' : ''}` }, { draft: 'Brouillon', published: 'Publiée', archived: 'Archivée' }[v.status])),
          h('td', { class: 'small muted' }, v.publishedAt ? fmtDateTime(v.publishedAt) : '—'), h('td', { class: 'small' }, `${v.games} partie(s)`),
          h('td', null, h('button', { class: 'btn small ghost', onclick: () => editVersion(body, v.id) }, v.status === 'draft' ? 'Modifier' : 'Consulter')),
        )))),
      )),
      h('section', { class: 'panel' }, h('h3', null, 'Nouvelle enquête'), h('div', { class: 'grid grid-3' }, slug, num, title), h('div', { class: 'row end', style: { marginTop: '10px' } }, create)),
    );
  }

  async function editVersion(body, vid) {
    const v = await A(`/api/admin/versions/${vid}`);
    const draft = v.status === 'draft';
    const jsonArea = (value) => {
      const t = h('textarea', { class: 'json-editor', readonly: !draft, spellcheck: 'false' });
      t.value = JSON.stringify(value, null, 2);
      return t;
    };
    const metaArea = jsonArea({ title: v.meta.title, synopsis: v.meta.synopsis, objective: v.meta.objective, difficulty: v.meta.difficulty, durationMinutes: v.meta.durationMinutes, minPlayers: v.meta.minPlayers, maxPlayers: v.meta.maxPlayers, intro: v.meta.intro, solution: v.solution });
    const saveMeta = h('button', { class: 'btn small primary', disabled: !draft }, 'Enregistrer');
    saveMeta.addEventListener('click', busy(saveMeta, async () => {
      try {
        await A(`/api/admin/versions/${vid}/meta`, { method: 'PUT', body: JSON.parse(metaArea.value) });
        toast('Informations enregistrées.', { tone: 'ok' });
        editVersion(body, vid);
      } catch (ex) { toast(ex instanceof SyntaxError ? 'JSON invalide.' : errorMessage(ex), { tone: 'error' }); }
    }));
    const publish = h('button', { class: 'btn primary', disabled: !draft }, 'Publier cette version');
    publish.addEventListener('click', busy(publish, async () => {
      if (!(await confirmDialog('Publier ? La version deviendra immuable. Les parties déjà commencées garderont leur version.'))) return;
      try {
        await A(`/api/admin/versions/${vid}/publish`, { method: 'POST' });
        toast('Version publiée.', { tone: 'ok' });
        editVersion(body, vid);
      } catch (ex) { toast(ex.data?.errors ? ex.data.errors.join(' ') : errorMessage(ex), { tone: 'error', timeout: 9000 }); }
    }));
    const entityEditor = (entity, row, isNew) => {
      const area = jsonArea(row);
      const save = h('button', { class: 'btn primary', disabled: !draft }, 'Enregistrer');
      const del = h('button', { class: 'btn danger', disabled: !draft || isNew }, 'Supprimer');
      const key = entity === 'stages' ? 'idx' : 'ref';
      const close = modal(h('div', null, area, h('div', { class: 'row between', style: { marginTop: '10px' } }, del, save)), { title: `${ENTITY_LABEL[entity]} · ${row[key]}`, wide: true });
      save.addEventListener('click', busy(save, async () => {
        try {
          await A(`/api/admin/versions/${vid}/entities/${entity}`, { method: 'PUT', body: JSON.parse(area.value) });
          close();
          editVersion(body, vid);
        } catch (ex) { toast(ex instanceof SyntaxError ? 'JSON invalide.' : errorMessage(ex), { tone: 'error' }); }
      }));
      del.addEventListener('click', busy(del, async () => {
        if (!(await confirmDialog(`Supprimer ${row[key]} de ce brouillon ?`, { danger: true }))) return;
        await A(`/api/admin/versions/${vid}/entities/${entity}/${encodeURIComponent(row[key])}`, { method: 'DELETE' });
        close();
        editVersion(body, vid);
      }));
    };
    body.replaceChildren(
      h('button', { class: 'linkish', onclick: () => viewScenarios(body) }, '← Toutes les enquêtes'),
      h('div', { class: 'row between', style: { margin: '10px 0' } }, h('div', null, h('span', { class: 'ref' }, `DOSSIER ${v.caseNumber} · VERSION ${v.version}`), h('h1', { style: { margin: 0 } }, v.meta.title)), publish),
      draft ? null : h('div', { class: 'info-box' }, 'Version publiée : lecture seule. Créez un brouillon pour la modifier ; les parties en cours ne seront pas affectées.'),
      v.errors.length ? h('div', { class: 'draft-ribbon', style: { marginTop: '10px' } }, h('strong', null, 'Incohérences à corriger avant publication :'), h('ul', null, ...v.errors.map((e) => h('li', null, e)))) : h('div', { class: 'ok-ribbon', style: { marginTop: '10px' } }, 'Aucune incohérence détectée.'),
      h('p', { class: 'section-label' }, 'Informations, introduction et solution'),
      h('details', null, h('summary', { class: 'small muted' }, 'Afficher (contient la solution)'), metaArea, h('div', { class: 'row end', style: { marginTop: '8px' } }, saveMeta)),
      ...Object.entries(ENTITY_LABEL).map(([entity, label]) => {
        const rows = v[entity] ?? [];
        return h('div', null,
          h('p', { class: 'section-label' }, `${label} (${rows.length})`),
          h('div', { class: 'grid grid-3' }, ...rows.map((r) => h('button', { class: 'resume-item', style: { borderLeftColor: 'var(--metal)' }, onclick: () => entityEditor(entity, toRow(entity, r), false) },
            h('div', { class: 'spacer' }, h('strong', { style: { fontSize: '.95rem' } }, r.name ?? r.title ?? `Étape ${r.idx}`), h('span', { class: 'ref' }, r.ref ?? `#${r.idx}`)))),
            draft ? h('button', { class: 'resume-item', onclick: () => entityEditor(entity, structuredClone(TEMPLATES[entity]), true) }, h('strong', null, '+ Ajouter')) : null,
          ),
        );
      }),
    );
  }

  // ── Parties ──
  async function viewGames(body) {
    if (me.role !== 'superadmin') return body.replaceChildren(h('p', { class: 'muted' }, 'Réservé aux administrateurs globaux.'));
    const games = await A('/api/admin/games');
    body.replaceChildren(
      h('div', { class: 'row between' }, h('h2', null, `Parties (${games.length})`), link('/creer', { class: 'btn small primary' }, 'Créer une partie')),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, ...['Code', 'Enquête', 'Statut', 'Étape', 'Joueurs', 'Preuves', 'Créée', ''].map((x) => h('th', null, x)))),
        h('tbody', null, ...games.map((g) => h('tr', null,
          h('td', { class: 'mono' }, g.code), h('td', null, `${g.title} (v${g.version})`), h('td', null, h('span', { class: `status-pill ${g.status}` }, STATUS_LABEL[g.status])),
          h('td', null, String(g.current_stage)), h('td', null, String(g.players)), h('td', null, String(g.discoveries)), h('td', { class: 'small muted' }, fmtDateTime(g.created_at)),
          h('td', null, h('button', { class: 'btn small ghost', onclick: () => navigate(`/organisateur/${g.code}`) }, 'Console')),
        ))),
      )),
    );
  }

  // ── QR codes et impression ──
  async function viewPrint(body) {
    const { domain, resources } = await A('/api/admin/resources');
    const selected = new Set(resources.map((r) => r.id));
    let kindFilter = '';
    const grid = h('div', { class: 'print-grid' });
    const counter = h('span', { class: 'ref' });
    const checks = h('div');
    const perPage = h('select', { 'aria-label': 'Cartes par page' }, ...[[4, '4 par page'], [6, '6 par page'], [8, '8 par page'], [9, '9 par page'], [1, '1 par page']].map(([v, l]) => h('option', { value: v, selected: v === 6 }, l)));
    const cut = h('input', { type: 'checkbox', checked: true, id: 'cut' });
    const urls = new Map();
    const fetchBlob = async (url) => {
      const res = await fetch(url, { headers: { 'x-dx-admin': store.admin() } });
      if (!res.ok) throw new Error(String(res.status));
      return res.blob();
    };
    const download = async (url, name) => {
      try {
        const b = await fetchBlob(url);
        h('a', { href: URL.createObjectURL(b), download: name }).click();
      } catch { toast('Téléchargement impossible.', { tone: 'error' }); }
    };
    const draw = () => {
      const rows = resources.filter((r) => !kindFilter || r.kind === kindFilter);
      counter.textContent = `${[...selected].length} SÉLECTIONNÉE(S) / ${resources.length}`;
      grid.replaceChildren(...rows.map((r) => {
        const img = h('img', { alt: `QR ${r.key}`, loading: 'lazy' });
        if (urls.has(r.id)) img.src = urls.get(r.id);
        else fetchBlob(`/api/admin/resources/${r.id}/qr?format=svg`).then((b) => { const u = URL.createObjectURL(b); urls.set(r.id, u); img.src = u; }).catch(() => {});
        const cb = h('input', { type: 'checkbox', checked: selected.has(r.id), 'aria-label': `Sélectionner ${r.key}`, onchange: (e) => { e.target.checked ? selected.add(r.id) : selected.delete(r.id); counter.textContent = `${selected.size} SÉLECTIONNÉE(S) / ${resources.length}`; } });
        return h('div', { class: 'print-card' }, cb,
          h('div', { class: 'pc-brand' }, 'DOSSIER X'), h('div', { class: 'pc-class' }, r.classification), img,
          h('div', { class: 'pc-key' }, r.key.toUpperCase()), h('div', null, r.title),
          h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '6px', gap: '6px' } },
            h('button', { class: 'linkish', style: { color: '#555' }, onclick: () => download(`/api/admin/resources/${r.id}/qr?format=png`, `dossier-x-${r.kind}-${r.key}.png`) }, 'PNG'),
            h('button', { class: 'linkish', style: { color: '#555' }, onclick: () => download(`/api/admin/resources/${r.id}/qr?format=svg`, `dossier-x-${r.kind}-${r.key}.svg`) }, 'SVG')),
        );
      }));
    };
    const ids = () => [...selected];
    const check = h('button', { class: 'btn small' }, 'Contrôler les destinations');
    check.addEventListener('click', busy(check, async () => {
      const r = await A('/api/admin/print/check', { method: 'POST', body: { ids: ids() } });
      const bad = r.results.filter((x) => !x.ok);
      checks.replaceChildren(h('div', { class: r.ready ? 'ok-ribbon' : 'draft-ribbon' },
        r.ready ? `${r.results.length} destinations valides. Prêt pour l'impression définitive.` : `${bad.length} ressource(s) en anomalie. ${r.domain.problems.join(' ')}`,
        bad.length ? h('ul', null, ...bad.map((b) => h('li', { class: 'small' }, `${b.url} : ${b.issues.join(' ')}`))) : null));
    }));
    const online = h('button', { class: 'btn small' }, 'Tester en ligne');
    online.addEventListener('click', busy(online, async () => {
      try {
        const r = await A('/api/admin/print/check-online', { method: 'POST', body: { ids: ids() } });
        const bad = r.filter((x) => !x.ok);
        checks.replaceChildren(h('div', { class: bad.length ? 'draft-ribbon' : 'ok-ribbon' }, bad.length ? `${bad.length} / ${r.length} adresses ne répondent pas correctement depuis le domaine public.` : `Les ${r.length} adresses répondent correctement depuis le domaine public.`));
      } catch (ex) { toast(errorMessage(ex), { tone: 'error' }); }
    }));
    const pdf = h('button', { class: 'btn primary' }, 'Générer le PDF A4');
    pdf.addEventListener('click', busy(pdf, async () => {
      if (!selected.size) return toast('Sélectionnez au moins une ressource.', { tone: 'error' });
      try {
        const res = await fetch('/api/admin/print/pdf', { method: 'POST', headers: { 'content-type': 'application/json', 'x-dx-admin': store.admin() }, body: JSON.stringify({ ids: ids(), perPage: Number(perPage.value), cutMarks: cut.checked }) });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Erreur');
        const url = URL.createObjectURL(await res.blob());
        window.open(url, '_blank') ?? h('a', { href: url, download: 'dossier-x-planches.pdf' }).click();
      } catch (ex) { toast(ex.message, { tone: 'error' }); }
    }));
    const kinds = [...new Set(resources.map((r) => r.kind))];
    body.replaceChildren(
      domain.final
        ? h('div', { class: 'ok-ribbon' }, `Domaine définitif confirmé : ${domain.base}. Les planches générées sont prêtes à imprimer.`)
        : h('div', { class: 'draft-ribbon' }, h('strong', null, 'Mode préparation — ne pas imprimer pour le jeu. '), domain.problems.join(' '), ' Les planches portent la mention BROUILLON.'),
      h('div', { class: 'board-tools', style: { marginTop: '14px' } },
        h('select', { 'aria-label': 'Filtrer', onchange: (e) => ((kindFilter = e.target.value), draw()) }, h('option', { value: '' }, 'Toutes les ressources'), ...kinds.map((k) => h('option', { value: k }, k))),
        h('button', { class: 'btn small ghost', onclick: () => { resources.filter((r) => !kindFilter || r.kind === kindFilter).forEach((r) => selected.add(r.id)); draw(); } }, 'Tout sélectionner'),
        h('button', { class: 'btn small ghost', onclick: () => { selected.clear(); draw(); } }, 'Tout désélectionner'),
        counter, h('span', { class: 'spacer' }),
        perPage, h('label', { class: 'choice', style: { padding: '6px 10px' } }, cut, h('span', null, 'Repères de découpe')),
      ),
      h('div', { class: 'row', style: { margin: '10px 0' } }, check, online, h('span', { class: 'spacer' }), pdf),
      checks,
      h('p', { class: 'small muted' }, 'Aperçu des cartes. Chaque QR code mène à une adresse permanente /q/<type>/<référence>, indépendante des titres affichés et valable pour toutes les parties et versions de l’enquête.'),
      grid,
    );
    draw();
  }

  // ── Journal et comptes ──
  async function viewAudit(body) {
    if (me.role !== 'superadmin') return body.replaceChildren(h('p', { class: 'muted' }, 'Réservé aux administrateurs globaux.'));
    const rows = await A('/api/admin/audit');
    const email = h('input', { type: 'email', placeholder: 'e-mail' });
    const pw = h('input', { type: 'password', placeholder: 'mot de passe (12 caractères min.)', autocomplete: 'new-password' });
    const role = h('select', null, h('option', { value: 'author' }, 'Auteur (enquêtes)'), h('option', { value: 'superadmin' }, 'Administrateur global'));
    const add = h('button', { class: 'btn small primary' }, 'Créer le compte');
    add.addEventListener('click', busy(add, async () => {
      try {
        await A('/api/admin/admins', { method: 'POST', body: { email: email.value, password: pw.value, role: role.value } });
        toast('Compte créé.', { tone: 'ok' });
        email.value = pw.value = '';
      } catch (ex) { toast(errorMessage(ex), { tone: 'error' }); }
    }));
    body.replaceChildren(
      h('section', { class: 'panel' }, h('h3', null, 'Nouveau compte'), h('div', { class: 'grid grid-3' }, email, pw, role), h('div', { class: 'row end', style: { marginTop: '10px' } }, add)),
      h('p', { class: 'section-label' }, 'Opérations sensibles'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('tbody', null, ...rows.map((r) => h('tr', null, h('td', { class: 'small muted' }, fmtDateTime(r.created_at)), h('td', { class: 'mono small' }, r.action), h('td', { class: 'small' }, r.actor), h('td', { class: 'tiny muted' }, r.target ?? '')))))),
    );
  }

  start();
  return root;
}
