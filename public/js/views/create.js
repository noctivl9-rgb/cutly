import { api, busy, errorMessage, h, link, navigate, store } from '../core.js';
import { logo } from '../art.js';

function radio(name, value, title, hint, checked) {
  return h('label', { class: 'choice' }, h('input', { type: 'radio', name, value, checked }), h('span', null, title, hint ? h('small', null, hint) : null));
}
function check(name, title, hint, checked) {
  return h('label', { class: 'choice' }, h('input', { type: 'checkbox', name, checked }), h('span', null, title, hint ? h('small', null, hint) : null));
}

export function createView() {
  const err = h('div');
  const scenarioBox = h('div', { class: 'choices' }, h('div', { class: 'skeleton', style: { height: '80px' } }));
  const maxPlayers = h('input', { type: 'number', name: 'maxPlayers', min: 1, max: 6, value: 6, inputmode: 'numeric' });
  const form = h('form', { class: 'stack' },
    h('fieldset', null, h('legend', null, '1. Enquête'), scenarioBox),
    h('fieldset', null, h('legend', null, '2. Participants'),
      h('div', { class: 'field' }, h('label', { for: 'mp' }, 'Nombre maximum de joueurs'), Object.assign(maxPlayers, { id: 'mp' })),
      h('div', { class: 'choices' },
        radio('assignment', 'libre', 'Choix libre des personnages', 'Chaque joueur choisit son rôle en rejoignant.', true),
        radio('assignment', 'auto', 'Attribution automatique', 'Un personnage libre est tiré au sort.'),
      ),
      h('div', { class: 'choices', style: { marginTop: '8px' } },
        check('uniqueCharacters', 'Personnages uniques', 'Un personnage ne peut être incarné que par un joueur.', true),
        check('lateJoin', 'Arrivées tardives', 'Rejoindre reste possible après le lancement.', true),
      ),
    ),
    h('fieldset', null, h('legend', null, '3. Déroulement'),
      h('div', { class: 'choices' },
        radio('progression', 'auto', 'Progression automatique', 'Les étapes se débloquent selon les preuves découvertes.', true),
        radio('progression', 'organisateur', "Progression par l'organisateur", 'Vous débloquez chaque étape vous-même.'),
      ),
      h('div', { class: 'choices', style: { marginTop: '8px' } },
        check('physicalCards', 'Cartes physiques imprimées', 'Certaines preuves ne se découvrent qu’en scannant leur carte. Décochez pour jouer sans impression.', true),
        check('allowSharing', 'Partage volontaire des secrets', 'Un joueur peut révéler une information de sa fiche au groupe.', true),
      ),
    ),
    h('fieldset', null, h('legend', null, '4. Accusation finale'),
      h('div', { class: 'choices' },
        radio('accusationMode', 'collectif', 'Décision collective', 'Tous les enquêteurs approuvent la même accusation.', true),
        radio('accusationMode', 'vote', 'Vote', 'Chacun vote ; la majorité désigne le suspect.'),
        radio('accusationMode', 'designe', 'Porte-parole désigné', 'Un seul joueur soumet l’accusation.'),
      ),
      h('div', { class: 'choices', style: { marginTop: '8px' } },
        check('autoReveal', 'Révélation automatique', 'La solution s’affiche dès la soumission. Sinon, c’est vous qui la révélez.', false),
      ),
    ),
    h('fieldset', null, h('legend', null, '5. Lancement'),
      h('div', { class: 'choices' },
        radio('launch', 'manuel', 'Je lance la partie', 'Depuis la console, quand tout le monde est prêt.', true),
        radio('launch', 'auto', 'Lancement automatique', 'Dès que tous les joueurs inscrits sont prêts.'),
      ),
    ),
    err,
    h('button', { class: 'btn primary big block', type: 'submit' }, 'Ouvrir le dossier'),
  );
  const submitBtn = form.querySelector('button[type=submit]');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(submitBtn, async () => {
      err.replaceChildren();
      const fd = new FormData(form);
      const body = {
        scenario: fd.get('scenario'),
        maxPlayers: Number(fd.get('maxPlayers')),
        settings: {
          assignment: fd.get('assignment'), progression: fd.get('progression'), accusationMode: fd.get('accusationMode'), launch: fd.get('launch'),
          uniqueCharacters: fd.has('uniqueCharacters'), lateJoin: fd.has('lateJoin'), physicalCards: fd.has('physicalCards'),
          allowSharing: fd.has('allowSharing'), autoReveal: fd.has('autoReveal'),
        },
      };
      try {
        const res = await api('/api/games', { method: 'POST', body, admin: store.admin() || undefined });
        store.saveOrganizer({ gameId: res.gameId, code: res.code, token: res.organizerToken });
        navigate(`/organisateur/${res.code}`);
      } catch (ex) {
        err.replaceChildren(h('div', { class: 'error-box' }, errorMessage(ex)));
      }
    })();
  });

  api('/api/scenarios').then((list) => {
    scenarioBox.replaceChildren(...list.map((sc, i) => h('label', { class: 'choice' },
      h('input', { type: 'radio', name: 'scenario', value: sc.slug, checked: i === 0, onchange: () => {
        maxPlayers.max = sc.maxPlayers;
        maxPlayers.value = Math.min(Number(maxPlayers.value), sc.maxPlayers);
      } }),
      h('span', null, h('span', { class: 'ref' }, `DOSSIER ${sc.caseNumber}`), h('br'), h('strong', { style: { fontFamily: 'var(--serif)', fontSize: '1.15rem' } }, sc.title),
        h('small', null, `${sc.minPlayers} à ${sc.maxPlayers} joueurs · ${Math.round(sc.durationMinutes / 60 * 10) / 10} h · ${sc.difficulty}`)),
    )));
    if (list[0]) maxPlayers.max = list[0].maxPlayers;
  }).catch((ex) => scenarioBox.replaceChildren(h('div', { class: 'error-box' }, errorMessage(ex))));

  return h('div', null,
    h('header', { class: 'topbar' }, h('div', { class: 'topbar-inner' }, link('/', { class: 'brand' }, logo(22), 'DOSSIER X'))),
    h('main', { class: 'wrap narrow' }, h('p', { class: 'caps red' }, 'Nouvelle partie'), h('h1', null, 'Ouvrir un dossier'), h('p', { class: 'muted' }, "Vous deviendrez l'organisateur de cette partie. Les joueurs la rejoindront avec un code ou un QR code."), form),
  );
}
