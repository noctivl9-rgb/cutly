import { api, busy, errorMessage, h, link, modal, navigate, store } from '../core.js';
import { logo, portrait } from '../art.js';

function shell(...content) {
  return h('div', null,
    h('header', { class: 'topbar' }, h('div', { class: 'topbar-inner' }, link('/', { class: 'brand' }, logo(22), 'DOSSIER X'))),
    h('main', { class: 'wrap narrow' }, ...content),
  );
}

function afterJoin(res) {
  const pending = store.pending();
  const go = () => {
    if (pending?.kind && (!pending.scenario || pending.scenario === res.scenario)) {
      store.setPending(null);
      navigate(`/q/${pending.kind}/${encodeURIComponent(pending.key)}`);
    } else navigate(`/partie/${res.code}`);
  };
  let close;
  close = modal(h('div', null,
    h('p', null, "Voici votre code personnel. Il permet de récupérer votre personnage si vous changez de téléphone ou effacez votre navigateur. Ne le communiquez à personne."),
    h('p', { class: 'big-code', style: { textAlign: 'center' } }, res.recoveryCode),
    h('p', { class: 'small muted' }, 'Il reste aussi consultable dans PROFIL sur cet appareil.'),
    h('button', { class: 'btn primary block', onclick: () => close() }, "J'ai noté mon code"),
  ), { title: 'Code personnel', onClose: go });
}

export function joinView(codeParam) {
  const invite = new URLSearchParams(location.search).get('i') ?? undefined;
  const box = h('div');
  const err = h('div');

  const codeForm = () => {
    const input = h('input', { type: 'text', class: 'code-input', id: 'code', placeholder: 'DX-0000', autocomplete: 'off', autocapitalize: 'characters', inputmode: 'text', maxlength: 10, value: codeParam ?? '' });
    const btn = h('button', { class: 'btn primary block big', type: 'submit' }, 'Continuer');
    const f = h('form', null, h('div', { class: 'field' }, h('label', { for: 'code' }, 'Code de la partie'), input), err, btn);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const code = input.value.trim().toUpperCase();
      if (code) navigate(`/rejoindre/${encodeURIComponent(code)}`);
    });
    return f;
  };

  if (!codeParam) {
    box.append(h('p', { class: 'caps red' }, 'Rejoindre'), h('h1', null, 'Entrer dans le dossier'), h('p', { class: 'muted' }, "Saisissez le code donné par l'organisateur, ou scannez le QR code d'invitation avec l'appareil photo de votre téléphone."), codeForm());
    return shell(box);
  }

  box.append(h('div', { class: 'skeleton', style: { height: '40px', marginBottom: '12px' } }), h('div', { class: 'skeleton', style: { height: '200px' } }));
  api(`/api/games/lookup/${encodeURIComponent(codeParam)}`).then((g) => {
    const existing = store.player(g.id);
    box.replaceChildren();
    box.append(h('p', { class: 'ref' }, `DOSSIER ${g.caseNumber} · PARTIE ${g.code}`), h('h1', null, g.title), h('p', { class: 'muted' }, g.synopsis));
    if (existing) {
      box.append(h('div', { class: 'info-box' }, h('p', null, `Vous avez déjà rejoint cette partie sur cet appareil sous le nom « ${existing.nickname} ».`), link(`/partie/${g.code}`, { class: 'btn primary block' }, 'Reprendre mon enquête')));
      return;
    }
    if (!g.joinable) {
      box.append(h('div', { class: 'error-box' }, g.status === 'ended' ? 'Cette partie est terminée.' : "Cette partie n'accepte plus de nouveaux joueurs."), h('p', null), link('/recuperer', { class: 'btn ghost block' }, "J'ai déjà un personnage dans cette partie"));
      return;
    }
    const free = g.characters.filter((c) => c.available).length;
    let chosen = null;
    const nick = h('input', { type: 'text', id: 'nick', maxlength: 32, autocomplete: 'nickname', required: true, placeholder: 'Votre nom d’enquêteur' });
    const charGrid = h('div', { class: 'char-grid' }, ...g.characters.map((c) => {
      const b = h('button', { type: 'button', class: 'char-card', disabled: !c.available, 'aria-pressed': 'false', 'aria-label': `${c.name}, ${c.role}${c.available ? '' : ' — déjà attribué'}` },
        portrait(c, 160),
        !c.available ? h('span', { class: 'stamp taken' }, 'Attribué') : null,
        h('div', { class: 'meta' }, h('strong', null, c.name), h('span', { class: 'tiny muted' }, c.role)),
      );
      b.addEventListener('click', () => {
        chosen = c.ref;
        charGrid.querySelectorAll('.char-card').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        detail.replaceChildren(h('div', { class: 'info-box' }, h('strong', null, c.name), ' — ', c.presentation));
      });
      return b;
    }));
    const detail = h('div', { style: { marginTop: '10px' } });
    const btn = h('button', { class: 'btn primary block big', type: 'submit' }, 'Rejoindre la partie');
    const f = h('form', null,
      h('p', { class: 'small muted' }, `${g.playerCount} / ${g.maxPlayers} joueurs inscrits`),
      h('div', { class: 'field' }, h('label', { for: 'nick' }, 'Pseudonyme'), nick),
      g.assignment === 'libre'
        ? h('div', { class: 'field' }, h('label', null, `Votre personnage (${free} disponible${free > 1 ? 's' : ''})`), charGrid, detail)
        : h('p', { class: 'info-box' }, 'Votre personnage vous sera attribué automatiquement.'),
      err, btn,
    );
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      busy(btn, async () => {
        err.replaceChildren();
        if (g.assignment === 'libre' && !chosen) return err.replaceChildren(h('div', { class: 'error-box' }, 'Choisissez un personnage.'));
        try {
          const res = await api('/api/join', { method: 'POST', body: { code: g.code, nickname: nick.value, characterRef: chosen, invite } });
          store.savePlayer({ gameId: res.gameId, code: res.code, token: res.token, recovery: res.recoveryCode, nickname: nick.value.trim(), scenario: g.scenario });
          afterJoin({ ...res, scenario: g.scenario });
        } catch (ex) {
          err.replaceChildren(h('div', { class: 'error-box' }, errorMessage(ex)));
          if (ex.status === 409) setTimeout(() => navigate(location.pathname + location.search, { replace: true }), 1800);
        }
      })();
    });
    box.append(f);
  }).catch((ex) => {
    box.replaceChildren(h('h1', null, 'Partie introuvable'), h('div', { class: 'error-box' }, errorMessage(ex)), h('p'), codeForm());
  });
  return shell(box);
}

export function recoverView() {
  const err = h('div');
  const code = h('input', { type: 'text', class: 'code-input', id: 'rc', placeholder: 'DX-0000', autocomplete: 'off', autocapitalize: 'characters' });
  const rec = h('input', { type: 'text', class: 'code-input', id: 'rr', placeholder: 'XXXX-XXXX', autocomplete: 'off', autocapitalize: 'characters' });
  const btn = h('button', { class: 'btn primary block big', type: 'submit' }, 'Récupérer mon personnage');
  const f = h('form', null,
    h('div', { class: 'field' }, h('label', { for: 'rc' }, 'Code de la partie'), code),
    h('div', { class: 'field' }, h('label', { for: 'rr' }, 'Code personnel'), rec),
    err, btn,
  );
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(btn, async () => {
      err.replaceChildren();
      try {
        const res = await api('/api/recover', { method: 'POST', body: { code: code.value, recoveryCode: rec.value } });
        store.savePlayer({ gameId: res.gameId, code: res.code, token: res.token, recovery: rec.value.toUpperCase(), nickname: '' });
        navigate(`/partie/${res.code}`);
      } catch (ex) {
        err.replaceChildren(h('div', { class: 'error-box' }, errorMessage(ex)));
      }
    })();
  });
  return shell(
    h('p', { class: 'caps red' }, 'Récupération'),
    h('h1', null, 'Retrouver mon personnage'),
    h('p', { class: 'muted' }, "Saisissez le code personnel affiché lorsque vous avez rejoint la partie. Votre ancien appareil sera déconnecté. Si vous l'avez perdu, l'organisateur peut vous en générer un nouveau."),
    f,
  );
}
