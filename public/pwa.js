const INSTALL_DISMISSED_KEY = 'cutly-install-dismissed-v1';
let installPrompt;
const installButton = document.querySelector('[data-install-app]');
const installDialog = document.querySelector('#install-dialog');
const installHelp = document.querySelector('[data-install-help]');
const installHelpTitle = document.querySelector('[data-install-help-title]');
const installHelpSteps = document.querySelector('[data-install-help-steps]');
const installStatus = document.querySelector('[data-install-status]');

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
}

function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isSafari() {
  return /Safari/.test(navigator.userAgent) && !/(CriOS|FxiOS|EdgiOS|OPiOS)/.test(navigator.userAgent);
}

function configureInstallPage() {
  const platform = isIos() ? 'ios' : /Android/i.test(navigator.userAgent) ? 'android' : 'desktop';
  document.querySelectorAll('[data-install-platform]').forEach(section => {
    section.hidden = section.dataset.installPlatform !== platform;
  });
  const safariNote = document.querySelector('[data-install-safari-note]');
  if (safariNote) safariNote.hidden = !isIos() || isSafari();
}

function setInstallHelp() {
  if (!installHelp || !installHelpTitle || !installHelpSteps) return;
  installHelp.hidden = false;
  installHelpSteps.replaceChildren();
  const instructions = isIos()
    ? isSafari()
      ? ['Touchez Partager dans Safari.', 'Choisissez « Sur l’écran d’accueil ».', 'Activez « Ouvrir comme app web », puis touchez « Ajouter ».']
      : ['Ouvrez cette page dans Safari.', 'Touchez Partager, puis « Sur l’écran d’accueil ».', 'Activez « Ouvrir comme app web », puis touchez « Ajouter ».']
    : /Android/i.test(navigator.userAgent)
      ? ['Ouvrez le menu de votre navigateur.', 'Choisissez « Installer l’application » ou « Ajouter à l’écran d’accueil ».', 'Confirmez dans la fenêtre du navigateur.']
      : ['Ouvrez le menu d’installation de votre navigateur, près de la barre d’adresse.', 'Choisissez « Installer CUTLY » ou « Installer l’application ».'];
  installHelpTitle.textContent = isIos() ? 'Installation sur iPhone' : /Android/i.test(navigator.userAgent) ? 'Installation sur Android' : 'Installation sur cet appareil';
  for (const instruction of instructions) {
    const item = document.createElement('li');
    item.textContent = instruction;
    installHelpSteps.append(item);
  }
}

function closeInstallDialog({ remember = false } = {}) {
  if (remember) {
    try { localStorage.setItem(INSTALL_DISMISSED_KEY, '1'); } catch {}
  }
  if (installDialog?.open) installDialog.close();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {
      if (installStatus) installStatus.textContent = 'L’installation hors ligne n’est pas disponible pour le moment.';
    });
  });
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  if (installButton) installButton.hidden = false;
});

installButton?.addEventListener('click', async () => {
  if (!installPrompt) {
    setInstallHelp();
    installButton.hidden = true;
    return;
  }
  const prompt = installPrompt;
  installPrompt = null;
  installButton.disabled = true;
  try {
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice?.outcome === 'accepted') {
      if (installStatus) installStatus.textContent = 'Installation lancée. Suivez la confirmation de votre navigateur.';
    } else {
      if (installStatus) installStatus.textContent = 'Vous pourrez installer CUTLY plus tard depuis le menu de votre navigateur.';
    }
  } catch {
    setInstallHelp();
  } finally {
    installButton.disabled = false;
  }
});

document.querySelector('[data-install-later]')?.addEventListener('click', () => closeInstallDialog({ remember: true }));

installDialog?.addEventListener('cancel', event => {
  event.preventDefault();
  closeInstallDialog({ remember: true });
});

window.addEventListener('appinstalled', () => {
  installPrompt = null;
  try { localStorage.setItem(INSTALL_DISMISSED_KEY, '1'); } catch {}
  if (installStatus) installStatus.textContent = 'CUTLY est ajoutée à votre appareil.';
  closeInstallDialog();
});

if (installDialog && !isStandalone()) {
  let dismissed = false;
  try { dismissed = localStorage.getItem(INSTALL_DISMISSED_KEY) === '1'; } catch {}
  if (!dismissed) {
    window.addEventListener('DOMContentLoaded', () => {
      if (!installDialog.open) installDialog.showModal();
    }, { once: true });
  }
}

configureInstallPage();
