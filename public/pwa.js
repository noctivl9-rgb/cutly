let installPrompt;
const installButton = document.querySelector('[data-install-app]');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {
      const status = document.querySelector('[data-install-status]');
      if (status) status.textContent = 'Installation hors ligne indisponible sur cette connexion.';
    });
  });
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  if (installButton) installButton.hidden = false;
});

installButton?.addEventListener('click', async () => {
  if (!installPrompt) return;
  await installPrompt.prompt();
  installPrompt = null;
  installButton.hidden = true;
});

window.addEventListener('appinstalled', () => {
  if (installButton) installButton.hidden = true;
  const status = document.querySelector('[data-install-status]');
  if (status) status.textContent = 'CUTLY est installée sur cet appareil.';
});
