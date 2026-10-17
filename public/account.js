/* Shared authenticated requests. Tokens stay in HttpOnly cookies. */
(() => {
  const allowedReturns = new Set(['recap.html', 'appointments.html', 'appointment.html', 'history.html', 'loyalty.html', 'profile.html', 'settings.html', 'booking.html']);
  function safeReturn(value) {
    try {
      const url = new URL(value || '/profile.html', location.origin);
      if (url.origin !== location.origin || !allowedReturns.has(url.pathname.slice(1))) return '/profile.html';
      return url.pathname + url.search;
    } catch { return '/profile.html'; }
  }
  async function api(url, options = {}) {
    let response;
    try { response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers } }); }
    catch { throw new Error('network_unavailable'); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data.error || 'request_failed'); error.status = response.status; throw error; }
    return data;
  }
  const labels = {
    authentication_required: 'Votre session a expiré. Reconnectez-vous pour continuer.',
    network_unavailable: 'Connexion interrompue. Vérifiez votre réseau puis réessayez.',
    invalid_credentials: 'E-mail ou mot de passe incorrect.',
    email_provider_not_configured: 'L’envoi des e-mails est indisponible. Réessayez plus tard.',
    public_base_url_not_configured: 'L’inscription n’est pas encore disponible.',
    administrator_not_initialized: 'L’inscription n’est pas encore disponible.',
    verification_secret_not_configured: 'La vérification est temporairement indisponible.',
    account_already_exists: 'Un compte utilise déjà cet e-mail. Connectez-vous ou réinitialisez votre mot de passe.',
    phone_already_in_use: 'Ce numéro est déjà associé à un compte.',
    invalid_phone_e164: 'Utilisez le format international, par exemple +33612345678.',
    too_many_attempts: 'Trop de tentatives. Patientez avant de réessayer.',
    version_conflict: 'Ces informations ont changé ailleurs. Rechargez la page avant de réessayer.',
    invalid_or_expired_token: 'Ce lien est invalide ou expiré. Demandez un nouveau lien.',
    appointment_not_cancellable: 'Ce rendez-vous ne peut plus être annulé.',
    review_already_exists: 'Un avis a déjà été déposé pour ce rendez-vous.',
    invalid_new_password: 'Choisissez un mot de passe d’au moins 12 caractères.'
  };
  const message = error => labels[error.message] || 'Cette action n’a pas abouti. Réessayez ou contactez Thomas.';
  async function submit(form, action, output) {
    if (form.dataset.busy) return;
    form.dataset.busy = 'true';
    const buttons = [...form.querySelectorAll('button[type="submit"]')];
    buttons.forEach(button => { button.disabled = true; });
    output.textContent = 'En cours…';
    try { await action(); } catch (error) { output.textContent = message(error); }
    finally { delete form.dataset.busy; buttons.forEach(button => { button.disabled = false; }); }
  }
  window.CutlyAccount = { api, safeReturn, message, submit };
  if (!document.querySelector('#identity-page')) return;
  const query = new URLSearchParams(location.search);
  if (location.hash === '#appointments') { location.replace('/appointments.html'); return; }
  if (location.hash === '#account-dashboard') { location.replace('/profile.html'); return; }
  let returnTo = safeReturn(query.get('return'));
  try {
    if (query.has('return')) sessionStorage.setItem('cutly-account-return', returnTo);
    else returnTo = safeReturn(sessionStorage.getItem('cutly-account-return'));
  } catch {}
  const mode = query.has('resetPassword') ? 'reset' : query.has('verifyEmail') ? 'verify' : ['register', 'forgot', 'verify'].includes(query.get('mode')) ? query.get('mode') : 'login';
  document.querySelectorAll('[data-auth-panel]').forEach(panel => { panel.hidden = panel.dataset.authPanel !== mode; });
  const titles = { login: 'Ravi de vous retrouver', register: 'Créer mon compte', forgot: 'Retrouver mon compte', reset: 'Nouveau mot de passe', verify: 'Vérifier mon e-mail' };
  document.querySelector('h1').textContent = titles[mode];
  for (const link of document.querySelectorAll('[data-auth-mode]')) link.href = `/account.html?mode=${link.dataset.authMode}&return=${encodeURIComponent(returnTo)}`;
  const goNext = async () => {
    const profile = await api('/api/client/profile');
    if (!profile.emailVerifiedAt) location.assign(`/account.html?mode=verify&return=${encodeURIComponent(returnTo)}`);
    else location.assign(returnTo);
  };
  const bind = (id, action) => {
    const form = document.getElementById(id);
    form.addEventListener('submit', event => { event.preventDefault(); submit(form, () => action(Object.fromEntries(new FormData(form))), form.querySelector('[role="status"]')); });
  };
  bind('account-login-form', async data => { await api('/api/auth/client/login', { method: 'POST', body: JSON.stringify(data) }); await goNext(); });
  bind('register-form', async data => { await api('/api/auth/client/register', { method: 'POST', body: JSON.stringify(data) }); await goNext(); });
  bind('resend-form', async data => {
    await api('/api/auth/client/resend-verification', { method: 'POST', body: JSON.stringify(data) });
    document.querySelector('#resend-message').textContent = 'Si cette adresse correspond à un compte à vérifier, une demande d’envoi a été acceptée. Consultez votre boîte de réception et vos indésirables.';
  });
  bind('reset-request-form', async data => {
    await api('/api/auth/client/password-reset', { method: 'POST', body: JSON.stringify(data) });
    document.querySelector('#reset-request-message').textContent = 'Si cette adresse correspond à un compte, une demande de récupération a été acceptée. Consultez votre boîte de réception.';
  });
  bind('reset-confirm-form', async data => {
    await api('/api/auth/client/password-reset/confirm', { method: 'POST', body: JSON.stringify({ token: query.get('resetPassword'), newPassword: data.password }) });
    history.replaceState({}, '', '/account.html');
    document.querySelector('#reset-confirm-message').textContent = 'Mot de passe mis à jour. Vous pouvez vous connecter.';
    document.querySelector('#reset-login').hidden = false;
  });
  document.querySelector('#verification-check').addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    const output = document.querySelector('#verify-email-message');
    try {
      const profile = await api('/api/client/profile');
      if (profile.emailVerifiedAt) location.assign(returnTo);
      else output.textContent = 'Votre adresse n’est pas encore vérifiée. Ouvrez le lien reçu par e-mail, puis revenez ici.';
    } catch (error) { output.textContent = message(error); }
    finally { event.currentTarget.disabled = false; }
  });
  if (query.has('verifyEmail')) {
    const token = query.get('verifyEmail');
    history.replaceState({}, '', `/account.html?mode=verify&return=${encodeURIComponent(returnTo)}`);
    api('/api/auth/client/verify-email', { method: 'POST', body: JSON.stringify({ token }) }).then(async () => {
      document.querySelector('#verify-email-message').textContent = 'Adresse e-mail vérifiée. Vous pouvez continuer votre réservation.';
      try { await goNext(); } catch { document.querySelector('#verified-login').hidden = false; }
    }).catch(error => { document.querySelector('#verify-email-message').textContent = message(error); });
  } else if (mode === 'login') {
    api('/api/client/profile').then(profile => {
      const existing = document.querySelector('#existing-session');
      existing.hidden = false;
      existing.querySelector('a').href = returnTo;
      existing.querySelector('span').textContent = `Vous êtes connecté avec ${profile.email}.`;
    }).catch(() => {});
  }
})();
