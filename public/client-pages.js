(() => {
  const { api, message, submit, safeReturn } = window.CutlyAccount;
  const page = document.body.dataset.clientPage;
  const query = new URLSearchParams(location.search);
  let profile;
  const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
  const money = amount => (amount / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
  const date = value => new Date(value).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long', timeStyle: 'short' });
  const statuses = { PENDING: 'En attente de Thomas', CONFIRMED: 'Confirmé', REJECTED: 'Refusé', CANCELLED: 'Annulé', COMPLETED: 'Terminé', NO_SHOW: 'Absence signalée' };
  const status = item => el('span', statuses[item.status] || 'État inconnu', `client-status status-${String(item.status).toLowerCase()}`);
  const errorBox = document.querySelector('#client-error');
  function showError(error) {
    errorBox.hidden = false;
    errorBox.querySelector('p').textContent = message(error);
    errorBox.querySelector('a').hidden = error.status !== 401;
    errorBox.querySelector('a').href = `/account.html?return=${encodeURIComponent(safeReturn(location.pathname + location.search))}`;
    document.querySelector('#client-loading').hidden = true;
    if (error.status === 401) document.querySelector('#client-page-content').hidden = true;
  }
  document.querySelector('#client-retry').addEventListener('click', () => location.reload());
  async function ownedAppointments(offset = 0) {
    return (await api(`/api/client/appointments?limit=100&offset=${offset}`)).appointments;
  }
  function appointmentLink(item) {
    const link = el('a', undefined, 'appointment-link');
    link.href = `/appointment.html?id=${encodeURIComponent(item.id)}`;
    const part = options => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', ...options }).format(new Date(item.startsAt));
    const tile = el('span', undefined, 'date-tile'); tile.setAttribute('aria-hidden', 'true');
    tile.append(el('span', part({ weekday: 'short' }).replace('.', '')), el('strong', part({ day: 'numeric' })), el('span', part({ month: 'short' }).replace('.', '')));
    const body = el('span', undefined, 'appointment-body');
    body.append(el('strong', item.serviceName), el('span', `${date(item.startsAt)}`, 'appointment-when'), el('span', `Thomas · ${item.durationMinutes} min · ${money(item.priceCents)}`, 'muted'), status(item));
    link.append(tile, body);
    return link;
  }
  async function appointments() {
    const list = document.querySelector('#appointments-list');
    const pending = query.get('filter') === 'pending';
    document.querySelector(`[data-filter="${pending ? 'pending' : 'upcoming'}"]`)?.setAttribute('aria-current', 'page');
    const now = Date.now();
    const accepts = item => page === 'history'
      ? !['PENDING', 'CONFIRMED'].includes(item.status) || Date.parse(item.startsAt) < now
      : pending ? item.status === 'PENDING' : ['PENDING', 'CONFIRMED'].includes(item.status) && Date.parse(item.startsAt) >= now;
    let offset = 0, exhausted = false, items = [], busy = false;
    const more = document.querySelector('#load-more');
    const load = async () => {
      if (busy) return;
      busy = true; more.disabled = true;
      try {
        let added = 0;
        while (!exhausted && added < 20 && offset <= 10000) {
          const batch = await ownedAppointments(offset); offset += batch.length;
          const matches = batch.filter(accepts); items.push(...matches); added += matches.length;
          exhausted = batch.length < 100 || offset > 10000;
        }
        items = [...new Map(items.map(item => [item.id, item])).values()];
        items.sort((a, b) => page === 'history' ? Date.parse(b.startsAt) - Date.parse(a.startsAt) : Date.parse(a.startsAt) - Date.parse(b.startsAt));
        list.replaceChildren(...items.map(appointmentLink));
        if (!items.length) {
          list.append(el('p', page === 'history' ? 'Aucun rendez-vous dans votre historique.' : pending ? 'Aucune demande en attente.' : 'Aucun rendez-vous à venir.', 'notice'));
          const book = el('a', 'Réserver une coupe', 'button'); book.href = '/booking.html'; list.append(book);
        }
        more.hidden = exhausted;
      } finally { busy = false; more.disabled = false; }
    };
    more.addEventListener('click', () => load().catch(showError));
    await load();
  }
  function calendarDownload(item) {
    const stamp = value => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const escape = value => String(value).replace(/\\/g, '\\\\').replace(/[\r\n]+/g, '\\n').replace(/[,;]/g, '\\$&');
    const text = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CUTLY//Thomas Shop//FR', 'BEGIN:VEVENT', `UID:${escape(item.id)}@cutly`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(item.startsAt)}`, `DTEND:${stamp(item.endsAt)}`, `SUMMARY:${escape(item.serviceName + ' · Thomas Shop')}`, `LOCATION:${escape('8 cours de l’Île Seguin, Boulogne-Billancourt')}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const link = document.createElement('a'), url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
    link.href = url; link.download = 'cutly-rendez-vous.ics'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function detail() {
    const id = query.get('id');
    let item;
    // Search only the current user's server-filtered list. Never fetch another client's data.
    if (id && id.length <= 100) for (let offset = 0; offset <= 10000; offset += 100) {
      const batch = await ownedAppointments(offset); item = batch.find(row => row.id === id);
      if (item || batch.length < 100) break;
    }
    const content = document.querySelector('#appointment-detail');
    content.replaceChildren();
    if (!item) { content.append(el('p', 'Ce rendez-vous est introuvable dans votre compte.', 'notice')); return; }
    document.querySelector('h1').textContent = item.serviceName;
    content.append(status(item));
    if (item.status === 'PENDING') content.append(el('p', 'Votre demande attend la confirmation de Thomas. Le créneau est réservé pendant son examen.', 'notice'));
    const panel = el('section', undefined, 'panel'), data = el('dl', undefined, 'client-details');
    const payments = { PAID: 'Paiement déclaré reçu', UNPAID: 'Non payé', NOT_APPLICABLE: 'Prestation offerte' };
    for (const [label, value] of [['Date et heure', date(item.startsAt)], ['Durée', `${item.durationMinutes} minutes`], ['Prix', money(item.priceCents)], ['Professionnel', 'Thomas · Thomas Shop'], ['Adresse', '8 cours de l’Île Seguin, Boulogne-Billancourt'], ['Paiement sur place', payments[item.paymentStatus] || item.paymentStatus]]) {
      const row = el('div'); row.append(el('dt', label), el('dd', value)); data.append(row);
    }
    if (item.rewardId) { const row = el('div'); row.append(el('dt', 'Récompense'), el('dd', 'Coupe classique offerte')); data.append(row); }
    panel.append(data); content.append(panel);
    if (item.status === 'CONFIRMED') {
      const calendar = el('button', 'Ajouter à mon calendrier', 'button secondary'); calendar.type = 'button'; calendar.addEventListener('click', () => calendarDownload(item)); content.append(calendar);
    }
    if (['PENDING', 'CONFIRMED'].includes(item.status)) {
      const section = el('section', undefined, 'panel'); section.append(el('h2', 'Annulation'));
      if (item.cancellationStatus === 'PENDING') section.append(el('p', 'Votre demande d’annulation attend la décision de Thomas. Le rendez-vous reste actif.', 'notice'));
      else {
        const direct = Date.parse(item.startsAt) - Date.now() > 86400000;
        section.append(el('p', direct ? 'Plus de 24 heures avant votre rendez-vous, vous pouvez l’annuler directement.' : 'À 24 heures ou moins, Thomas doit accepter votre demande. Le rendez-vous reste actif jusqu’à sa décision.'));
        const form = el('form', undefined, 'client-form');
        const label = el('label', 'Motif (facultatif)'), reason = el('textarea'); reason.name = 'reason'; reason.maxLength = 500; reason.rows = 2; label.append(reason);
        const checkLabel = el('label', undefined, 'check'), check = el('input'); check.type = 'checkbox'; check.required = true; checkLabel.append(check, el('span', 'Je confirme vouloir annuler ce rendez-vous.'));
        const button = el('button', direct ? 'Annuler ce rendez-vous' : 'Demander l’annulation', 'button secondary'); button.type = 'submit';
        const output = el('p', '', 'client-message'); output.setAttribute('role', 'status');
        form.append(label, checkLabel, button, output);
        form.addEventListener('submit', event => { event.preventDefault(); submit(form, async () => {
          const result = await api(`/api/client/appointments/${encodeURIComponent(item.id)}/cancellation`, { method: 'POST', body: JSON.stringify({ reason: reason.value }) });
          document.querySelector('#appointment-message').textContent = result.type === 'CANCELLED' ? 'Votre rendez-vous a été annulé.' : 'Demande d’annulation envoyée. Le rendez-vous reste actif jusqu’à la décision de Thomas.';
          await detail();
        }, output); });
        section.append(form);
      }
      content.append(section);
    }
    if (item.status === 'COMPLETED') {
      const section = el('section', undefined, 'panel'); section.append(el('h2', 'Votre avis'));
      if (item.reviewStatus) section.append(el('p', ({ PENDING_MODERATION: 'Votre avis attend la validation de Thomas.', PUBLISHED: 'Votre avis est publié.', HIDDEN: 'Votre avis est masqué.', REPORTED: 'Votre avis fait l’objet d’un signalement.' })[item.reviewStatus] || 'Votre avis a été enregistré.'));
      else {
        const form = el('form', undefined, 'client-form'), label = el('label', 'Note'), rating = el('select'); rating.name = 'rating'; rating.required = true;
        const placeholder = el('option', 'Choisir une note'); placeholder.value = ''; rating.append(placeholder);
        for (let n = 1; n <= 5; n++) { const option = el('option', `${n} sur 5`); option.value = n; rating.append(option); }
        label.append(rating); const commentLabel = el('label', 'Commentaire (facultatif)'), comment = el('textarea'); comment.maxLength = 2000; comment.rows = 3; commentLabel.append(comment);
        const send = el('button', 'Envoyer mon avis', 'button'); send.type = 'submit'; const output = el('p', '', 'client-message'); output.setAttribute('role', 'status');
        form.append(label, commentLabel, el('p', 'Les avis sont soumis à la validation de Thomas avant publication.', 'muted'), send, output);
        form.addEventListener('submit', event => { event.preventDefault(); submit(form, async () => {
          await api('/api/client/reviews', { method: 'POST', body: JSON.stringify({ appointmentId: item.id, rating: Number(rating.value), comment: comment.value }) });
          document.querySelector('#appointment-message').textContent = 'Avis envoyé à Thomas pour validation.'; await detail();
        }, output); }); section.append(form);
      }
      content.append(section);
    }
  }
  function profilePage() {
    const form = document.querySelector('#profile-form');
    for (const key of ['firstName', 'lastName', 'phone', 'language']) form.elements[key].value = profile[key] || '';
    document.querySelector('#profile-email').textContent = profile.email;
    document.querySelector('#verification-state').textContent = profile.emailVerifiedAt ? 'Adresse e-mail vérifiée' : 'Vérifiez votre adresse e-mail avant de réserver.';
    document.querySelector('#verification-state').classList.toggle('success', !!profile.emailVerifiedAt);
    document.querySelector('#verify-profile').hidden = !!profile.emailVerifiedAt;
    form.addEventListener('submit', event => { event.preventDefault(); submit(form, async () => {
      const values = Object.fromEntries(new FormData(form));
      const result = await api('/api/client/profile', { method: 'PATCH', body: JSON.stringify({ ...values, version: profile.version }) });
      profile = { ...profile, ...values, version: result.version }; document.querySelector('#profile-message').textContent = 'Votre profil a été enregistré.';
    }, document.querySelector('#profile-message')); });
  }
  function settings() {
    const form = document.querySelector('#password-form');
    form.addEventListener('submit', event => { event.preventDefault(); submit(form, async () => {
      await api('/api/client/password', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      form.reset(); location.assign('/account.html?return=settings.html');
    }, document.querySelector('#password-message')); });
    document.querySelector('#account-logout').addEventListener('click', async event => {
      const button = event.currentTarget; button.disabled = true;
      try { await api('/api/auth/logout', { method: 'POST' }); location.assign('/account.html'); }
      catch (error) { document.querySelector('#logout-message').textContent = message(error); button.disabled = false; }
    });
  }
  async function loyalty() {
    const data = await api('/api/client/loyalty'), rewards = document.querySelector('#account-rewards'), ledger = document.querySelector('#loyalty-ledger');
    if (!data.rewards.length) rewards.append(el('p', 'Aucune récompense pour le moment.', 'muted'));
    const rewardLabels = { AVAILABLE: 'Disponible', RESERVED: 'Réservée pour un rendez-vous', USED: 'Utilisée', CANCELLED: 'Annulée', REVIEW_REQUIRED: 'En cours d’examen' };
    for (const reward of data.rewards) {
      const row = el('div', undefined, 'list-row'); row.append(el('strong', 'Coupe classique offerte'), el('p', `${rewardLabels[reward.status] || reward.status} · cycle ${reward.cycleNumber}`));
      if (reward.status === 'AVAILABLE') { const link = el('a', 'Réserver ma coupe offerte', 'button secondary'); link.href = `/booking.html?service=coupe-classique&reward=${encodeURIComponent(reward.id)}`; row.append(link); }
      rewards.append(row);
    }
    if (!data.ledger.length) ledger.append(el('li', 'Aucun mouvement de points pour le moment.'));
    const kindLabels = { EARN: 'Prestation éligible payée', CORRECTION: 'Correction', REDEEM: 'Récompense utilisée', REVERSAL: 'Point annulé' };
    for (const entry of data.ledger) {
      const row = el('li'); row.append(el('strong', `${entry.points > 0 ? '+' : ''}${entry.points} point${Math.abs(entry.points) === 1 ? '' : 's'}`), el('p', `${kindLabels[entry.kind] || 'Mouvement de fidélité'} · cycle ${entry.cycleNumber}`, 'muted'), el('p', date(entry.createdAt), 'muted')); ledger.append(row);
    }
  }
  async function load() {
    profile = await api('/api/client/profile');
    if (page === 'appointments' || page === 'history') await appointments();
    if (page === 'appointment') await detail();
    if (page === 'profile') profilePage();
    if (page === 'settings') settings();
    if (page === 'loyalty') await loyalty();
    document.querySelector('#client-loading').hidden = true; document.querySelector('#client-page-content').hidden = false;
  }
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  load().catch(showError);
})();
