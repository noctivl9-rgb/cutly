// Lien privé administrateur : le secret est après « # » (jamais envoyé dans l'adresse au serveur ni dans les journaux).
// Il est retiré de la barre d'adresse, échangé contre une session, puis gardé sur cet appareil pour que /admin
// se rouvre sans identifiant (admin.js). Le serveur reste seul juge : un lien désactivé ne fonctionne plus.
(async () => {
  const message = document.getElementById('link-message');
  const token = new URLSearchParams(location.hash.slice(1)).get('lien') || '';
  history.replaceState(null, '', location.pathname);
  if (!token) { message.textContent = 'Lien incomplet. Recopiez le lien entier.'; return; }
  try {
    const response = await fetch('/api/auth/admin/link', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
    if (response.ok) {
      try { localStorage.setItem('cutly-admin-link', token); } catch {}
      location.replace('/admin.html'); return;
    }
    try { localStorage.removeItem('cutly-admin-link'); } catch {}
    message.textContent = response.status === 429 ? 'Trop de tentatives. Réessayez dans quelques minutes.' : 'Ce lien n’est plus valable.';
  } catch { message.textContent = 'Connexion au serveur impossible. Réessayez.'; }
})();
