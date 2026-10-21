// Tableau d'enquête collaboratif : cartes déplaçables, fils rouges, couloirs de classement.
// Chaque carte et chaque lien sont des objets enregistrés en base ; les modifications
// concurrentes sont détectées par numéro de version.
import { busy, confirmDialog, errorMessage, h, modal, s, toast } from '../core.js';
import { icon, portrait } from '../art.js';

const LANES = [['piste', 'Pistes'], ['confirme', 'Confirmé'], ['ecarte', 'Écarté']];
const KIND_TXT = { indice: 'Preuve', personnage: 'Suspect', lieu: 'Lieu', note: 'Note', hypothese: 'Hypothèse' };

export function boardView(st, { call, refresh, playerName, charName, locName, openItem }) {
  const narrow = window.innerWidth < 760;
  const mode = sessionStorage.getItem('dx.boardMode') ?? (narrow ? 'liste' : 'libre');
  let dragging = false;
  let suppressClick = false;
  let linkFrom = null;
  const items = st.board.items;
  const links = st.board.links;
  const running = st.game.status === 'running';

  const title = (b) => {
    if (b.kind === 'indice') return st.items.find((i) => i.ref === b.ref)?.title ?? b.ref;
    if (b.kind === 'personnage') return charName(b.ref);
    if (b.kind === 'lieu') return locName(b.ref);
    return b.text;
  };
  const meta = (b) => `${KIND_TXT[b.kind]} · ${playerName(b.updated_by ?? b.created_by)}`;

  async function add(kind, ref, text) {
    try {
      await call('/board/items', { method: 'POST', body: { kind, ref, text, x: 40 + Math.random() * 500, y: 40 + Math.random() * 360 } });
      await refresh();
    } catch (ex) { toast(errorMessage(ex), { tone: 'error' }); }
  }

  function addDialog() {
    const onBoard = new Set(items.map((b) => `${b.kind}:${b.ref}`));
    const kind = h('select', { 'aria-label': 'Type' }, ...Object.entries(KIND_TXT).map(([k, l]) => h('option', { value: k }, l)));
    const refSel = h('select', { 'aria-label': 'Élément' });
    const text = h('textarea', { placeholder: 'Texte de la carte', maxlength: 600 });
    const sync = () => {
      const k = kind.value;
      const opts = k === 'indice' ? st.items.map((i) => [i.ref, i.title]) : k === 'personnage' ? st.characters.map((c) => [c.ref, c.name]) : k === 'lieu' ? st.locations.map((l) => [l.ref, l.name]) : [];
      refSel.replaceChildren(...opts.filter(([r]) => !onBoard.has(`${k}:${r}`)).map(([r, l]) => h('option', { value: r }, l)));
      refSel.parentElement.hidden = !opts.length;
      text.parentElement.hidden = !!opts.length;
      if (k === 'indice' && !st.items.length) refSel.replaceChildren(h('option', { value: '' }, 'Aucune preuve découverte'));
    };
    kind.addEventListener('change', sync);
    const ok = h('button', { class: 'btn primary' }, 'Ajouter');
    const close = modal(h('div', null,
      h('div', { class: 'field' }, h('label', null, 'Type de carte'), kind),
      h('div', { class: 'field' }, h('label', null, 'Élément'), refSel),
      h('div', { class: 'field' }, h('label', null, 'Texte'), text),
      h('div', { class: 'row end' }, ok),
    ), { title: 'Nouvelle carte' });
    ok.addEventListener('click', busy(ok, async () => {
      const k = kind.value;
      const needsRef = ['indice', 'personnage', 'lieu'].includes(k);
      if (needsRef && !refSel.value) return;
      if (!needsRef && !text.value.trim()) return;
      close();
      await add(k, needsRef ? refSel.value : null, needsRef ? '' : text.value);
    }));
    sync();
  }

  async function patch(b, changes) {
    try {
      await call(`/board/items/${b.id}`, { method: 'PATCH', body: { version: b.version, ...changes } });
    } catch (ex) {
      toast(ex.status === 409 ? 'Un autre enquêteur a modifié cette carte. Le tableau a été actualisé.' : errorMessage(ex), { tone: 'error' });
    }
    await refresh();
  }

  async function link(a, b) {
    const label = window.prompt('Libellé du lien (facultatif)', '') ?? '';
    try {
      await call('/board/links', { method: 'POST', body: { fromId: a.id, toId: b.id, label } });
      await refresh();
    } catch (ex) { toast(errorMessage(ex), { tone: 'error' }); }
  }

  function editDialog(b) {
    const editable = b.kind === 'note' || b.kind === 'hypothese';
    const text = h('textarea', { maxlength: 600 }, b.text);
    text.value = b.text;
    const lane = h('select', null, ...LANES.map(([k, l]) => h('option', { value: k, selected: b.lane === k }, l)));
    const save = h('button', { class: 'btn primary' }, 'Enregistrer');
    const del = h('button', { class: 'btn danger' }, 'Retirer du tableau');
    const myLinks = links.filter((l) => l.from_id === b.id || l.to_id === b.id);
    const close = modal(h('div', null,
      h('p', { class: 'ref' }, `${meta(b)} · version ${b.version}`),
      !editable ? h('h3', null, title(b)) : null,
      b.kind === 'indice' ? h('button', { class: 'linkish', onclick: () => { const it = st.items.find((i) => i.ref === b.ref); if (it) openItem(it); } }, 'Ouvrir la pièce') : null,
      editable ? h('div', { class: 'field' }, h('label', null, 'Texte'), text) : null,
      h('div', { class: 'field' }, h('label', null, 'Classement'), lane),
      myLinks.length ? h('div', { class: 'field' }, h('label', null, 'Liens'), ...myLinks.map((l) => {
        const other = items.find((x) => x.id === (l.from_id === b.id ? l.to_id : l.from_id));
        const rm = h('button', { class: 'btn small danger' }, 'Couper');
        rm.addEventListener('click', busy(rm, async () => {
          try { await call(`/board/links/${l.id}`, { method: 'DELETE' }); close(); await refresh(); } catch (ex) { toast(errorMessage(ex), { tone: 'error' }); }
        }));
        return h('div', { class: 'row between', style: { padding: '4px 0' } }, h('span', null, `↔ ${other ? title(other) : '?'}${l.label ? ` — ${l.label}` : ''}`), rm);
      })) : null,
      h('div', { class: 'row between' }, del, save),
    ), { title: KIND_TXT[b.kind] });
    save.addEventListener('click', busy(save, async () => {
      close();
      await patch(b, { text: editable ? text.value : undefined, lane: lane.value });
    }));
    del.addEventListener('click', busy(del, async () => {
      if (!(await confirmDialog('Retirer cette carte et ses liens du tableau ?', { danger: true, confirm: 'Retirer' }))) return;
      close();
      try { await call(`/board/items/${b.id}`, { method: 'DELETE' }); } catch (ex) { toast(errorMessage(ex), { tone: 'error' }); }
      await refresh();
    }));
  }

  const linkBtn = h('button', { class: `btn small ${linkFrom ? 'primary' : ''}`, disabled: !running }, icon('link', 16), 'Relier deux cartes');
  const hint = h('span', { class: 'small muted' });
  linkBtn.addEventListener('click', () => {
    linkFrom = linkFrom ? null : 'armed';
    linkBtn.classList.toggle('primary', !!linkFrom);
    hint.textContent = linkFrom ? 'Touchez la première carte, puis la seconde.' : '';
    el.querySelectorAll('.linking').forEach((x) => x.classList.remove('linking'));
  });
  function tapForLink(b, node) {
    if (!linkFrom) return false;
    if (linkFrom === 'armed') {
      linkFrom = b;
      node?.classList.add('linking');
      hint.textContent = 'Touchez maintenant la seconde carte.';
      return true;
    }
    if (linkFrom.id !== b.id) link(linkFrom, b);
    linkFrom = null;
    return true;
  }

  const tools = h('div', { class: 'board-tools' },
    h('button', { class: 'btn small primary', disabled: !running, onclick: addDialog }, icon('plus', 16), 'Carte'),
    linkBtn,
    h('span', { class: 'spacer' }),
    h('div', { class: 'seg' },
      h('button', { 'aria-pressed': String(mode === 'libre'), onclick: () => (sessionStorage.setItem('dx.boardMode', 'libre'), refresh()) }, 'Tableau'),
      h('button', { 'aria-pressed': String(mode === 'liste'), onclick: () => (sessionStorage.setItem('dx.boardMode', 'liste'), refresh()) }, 'Liste'),
    ),
  );

  let body;
  if (mode === 'liste') {
    body = h('div', { class: 'lane-list' }, ...LANES.map(([lane, label]) => {
      const cards = items.filter((b) => b.lane === lane);
      return h('section', { class: 'lane-col' }, h('h3', null, `${label} (${cards.length})`),
        cards.length ? cards.map((b) => {
          const ls = links.filter((l) => l.from_id === b.id || l.to_id === b.id).map((l) => {
            const o = items.find((x) => x.id === (l.from_id === b.id ? l.to_id : l.from_id));
            return o ? `${title(o)}${l.label ? ` (${l.label})` : ''}` : null;
          }).filter(Boolean);
          const card = h('div', { class: `mcard kind-${b.kind}` },
            h('span', { class: 'ref' }, meta(b)), h('div', null, h('strong', null, title(b))),
            ls.length ? h('div', { class: 'links' }, '↔ ', ls.join(' · ')) : null,
            h('div', { class: 'row' },
              ...LANES.filter(([k]) => k !== lane).map(([k, l]) => h('button', { class: 'btn small', disabled: !running, onclick: () => patch(b, { lane: k }) }, `→ ${l}`)),
              h('button', { class: 'btn small', disabled: !running, onclick: () => (tapForLink(b, card) || editDialog(b)) }, linkFrom ? 'Choisir' : 'Détails'),
            ),
          );
          return card;
        }) : h('p', { class: 'small muted' }, 'Aucune carte.'));
    }));
  } else {
    const board = h('div', { class: 'board' });
    const strings = s('svg', { class: 'strings' });
    board.append(strings);
    const nodes = new Map();
    const center = (b) => {
      const n = nodes.get(b.id);
      return n ? [n.offsetLeft + n.offsetWidth / 2, n.offsetTop + 10] : [b.x + 88, b.y + 10];
    };
    const drawStrings = () => {
      strings.replaceChildren(...links.flatMap((l) => {
        const a = items.find((x) => x.id === l.from_id);
        const b = items.find((x) => x.id === l.to_id);
        if (!a || !b) return [];
        const [x1, y1] = center(a);
        const [x2, y2] = center(b);
        return [s('line', { x1, y1, x2, y2 }), l.label ? s('text', { x: (x1 + x2) / 2 + 4, y: (y1 + y2) / 2 - 4 }, l.label) : null].filter(Boolean);
      }));
    };
    for (const b of items) {
      const n = h('div', { class: `bcard kind-${b.kind} lane-${b.lane}`, style: { left: `${b.x}px`, top: `${b.y}px` }, tabindex: 0, role: 'button', 'aria-label': `${KIND_TXT[b.kind]} : ${title(b)}` },
        b.kind === 'personnage' ? portrait(st.characters.find((c) => c.ref === b.ref), 52) : null,
        h('strong', null, title(b)),
        b.kind === 'indice' ? h('div', { class: 'ref', style: { color: '#6b665e' } }, b.ref) : null,
        h('div', { class: 'bmeta', style: { clear: 'both' } }, meta(b)),
      );
      nodes.set(b.id, n);
      let start = null;
      n.addEventListener('pointerdown', (e) => {
        if (!running || linkFrom) return;
        start = { x: e.clientX, y: e.clientY, left: b.x, top: b.y, moved: false };
        n.setPointerCapture(e.pointerId);
      });
      n.addEventListener('pointermove', (e) => {
        if (!start) return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (!start.moved && Math.hypot(dx, dy) < 5) return;
        start.moved = true;
        dragging = true;
        n.classList.add('dragging');
        n.style.left = `${Math.max(0, start.left + dx)}px`;
        n.style.top = `${Math.max(0, start.top + dy)}px`;
        drawStrings();
      });
      const end = async () => {
        if (!start) return;
        const moved = start.moved;
        start = null;
        n.classList.remove('dragging');
        if (moved) {
          suppressClick = true;
          setTimeout(() => (suppressClick = false), 0);
          dragging = false;
          await patch(b, { x: n.offsetLeft, y: n.offsetTop });
        }
      };
      n.addEventListener('pointerup', end);
      n.addEventListener('pointercancel', end);
      n.addEventListener('click', () => {
        if (suppressClick) return;
        if (!tapForLink(b, n)) editDialog(b);
      });
      n.addEventListener('keydown', (e) => e.key === 'Enter' && (tapForLink(b, n) || editDialog(b)));
      board.append(n);
    }
    body = h('div', { class: 'board-wrap' }, board);
    requestAnimationFrame(drawStrings);
  }

  const el = h('div', null,
    h('div', { class: 'row between' }, h('h2', { style: { margin: 0 } }, "Tableau d'enquête"), h('span', { class: 'ref' }, `${items.length} CARTES · ${links.length} LIENS`)),
    h('p', { class: 'small muted' }, 'Partagé en direct avec tous les enquêteurs. Glissez les cartes, reliez-les par un fil rouge, classez vos pistes.'),
    tools, hint,
    items.length ? body : h('div', { class: 'empty' }, h('span', { class: 'hand' }, 'Le tableau est vierge.'), 'Ajoutez une preuve, un suspect ou une hypothèse.'),
  );
  return { el, isBusy: () => dragging, destroy() {} };
}
