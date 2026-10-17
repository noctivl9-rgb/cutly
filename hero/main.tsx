import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

const root = document.getElementById('cutly-home-root');
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);

// La barre inférieure reste cachée (et inactive) tant que la scène d'accueil est à l'écran.
const nav = document.querySelector<HTMLElement>('.bottom-nav');
const watchHero = () => {
  const hero = document.querySelector('#cutly-home-root section');
  if (!hero) return requestAnimationFrame(watchHero);
  new IntersectionObserver(([entry]) => {
    const visible = entry.intersectionRatio > 0.35;
    document.body.classList.toggle('hero-in-view', visible);
    if (nav) nav.inert = visible;
  }, { threshold: [0, 0.35, 0.6, 1] }).observe(hero);
};
document.body.classList.add('hero-in-view');
if (nav) nav.inert = true;
watchHero();

// Le contenu existant sous le Hero apparaît au défilement.
const reveal = new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add('is-visible'); reveal.unobserve(entry.target); }
}, { rootMargin: '0px 0px -12% 0px' });
const observeContent = () => document.querySelectorAll('.home-content > *:not(#page-error)').forEach(node => { node.classList.add('reveal'); reveal.observe(node); });
observeContent();
// Les prestations et le prochain rendez-vous sont chargés ensuite par app.js.
new MutationObserver(() => document.querySelectorAll('.home-content > *:not(.reveal):not(#page-error)').forEach(node => { node.classList.add('reveal'); reveal.observe(node); }))
  .observe(document.querySelector('.home-content') ?? document.body, { childList: true });
