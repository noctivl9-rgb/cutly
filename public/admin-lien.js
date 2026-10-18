// Lien privé administrateur : le secret est après « # » (jamais envoyé dans l'adresse au serveur ni dans les journaux).
// Il est retiré de la barre d'adresse puis échangé contre une session, et la page renvoie vers l'administration.
(async () => {
  const message = document.getElementById('link-message');
  const token = new URLSearchParams(location.hash.slice(1)).get('lien') || '';
  history.replaceState(null, '', location.pathname);
  if (!token) { message.textContent = 'Lien incomplet. Recopiez le lien entier.'; return; }
  try {
    const response = await fetch('/api/auth/admin/link', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
    if (response.ok) { location.replace('/admin.html'); return; }
    message.textContent = response.status === 429 ? 'Trop de tentatives. Réessayez dans quelques minutes.' : 'Ce lien a expiré ou a été remplacé. Créez-en un nouveau.';
  } catch { message.textContent = 'Connexion au serveur impossible. Réessayez.'; }
})();
