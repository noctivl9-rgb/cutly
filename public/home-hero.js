// TypingMessages — même logique que la spécification : frappe 100 ms, effacement 50 ms, pause 2000 ms.
(() => {
  const root = document.querySelector('[data-typing-messages]');
  if (!root) return;
  const output = root.querySelector('.typing-text');
  //   : espace insécable avant ? et ! (typographie française).
  const messages = ['Un créneau samedi ?', '10h30, c’est libre.', 'Réservé. À samedi !'];
  const TYPING = 100, DELETING = 50, PAUSE = 2000;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let index = 0, text = '', deleting = false, timer = null;

  function tick() {
    const current = messages[index];
    if (reduced) {
      // Sans animation de frappe : chaque message s'affiche entier, puis le suivant.
      output.textContent = current;
      index = (index + 1) % messages.length;
      timer = setTimeout(tick, PAUSE + 1000);
      return;
    }
    if (!deleting && text === current) { deleting = true; timer = setTimeout(tick, PAUSE); return; }
    if (deleting && text === '') { deleting = false; index = (index + 1) % messages.length; }
    text = deleting ? current.slice(0, text.length - 1) : messages[index].slice(0, text.length + 1);
    output.textContent = text;
    timer = setTimeout(tick, deleting ? DELETING : TYPING);
  }

  document.addEventListener('visibilitychange', () => {
    clearTimeout(timer);
    if (document.visibilityState === 'visible') tick();
  });
  tick();
})();
