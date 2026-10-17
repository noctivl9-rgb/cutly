import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { motion, useMotionTemplate, useReducedMotion, useScroll, useTransform } from 'motion/react';
import Manifesto from './Manifesto';

const VIDEO_SRC = '/media/cutly-hero.mp4';
const EASE = [0.16, 1, 0.3, 1] as const;

// Mode « reference » : textes d'origine de la maquette, utilisé uniquement pour les captures de comparaison (jamais publié).
const REFERENCE = import.meta.env.MODE === 'reference';
const COPY = REFERENCE
  ? { logo: 'dot.', cta: 'Link up', title: ['Short notes.', 'Daily calm.'], subtitle: 'Linked with a single anonymous peer. One message every day. A quiet rhythm in the digital noise.',
      messages: ['Are you here?', 'Yes, I am.', 'Speak soon.'], links: ['Philosophy', 'Trust', 'Access', 'Tribe'].map(label => ({ label, href: '#' })) }
  : { logo: 'CUTLY', cta: 'Réserver une coupe', title: ['Coupe nette.', 'Heure juste.'], subtitle: 'Votre coupe, votre créneau. Réservez chez Thomas Shop à Boulogne-Billancourt, simplement.',
      messages: ['Une coupe samedi ?', 'Créneau disponible.', 'À bientôt chez Thomas.'],
      links: [{ label: 'Prestations', href: '/services.html' }, { label: 'Le salon', href: '/shop.html' }, { label: 'Rendez-vous', href: '/appointments.html' }, { label: 'Fidélité', href: '/loyalty.html' }] };

// Zone de message de l'écran du Nokia, mesurée dans la vidéo source (1920 × 1080).
const VIDEO = { width: 1920, height: 1080 };
const SCREEN = { left: 848, bottom: 752, width: 166, fontAt1x: 22 };
// Axe vertical du Nokia dans la vidéo (corps du téléphone entre x≈765 et x≈1095).
const PHONE_CENTER_X = 930;

type Anchor = { left: number; bottom: number; width: number; fontSize: number; objectPositionX: number } | null;

// Reproduit le calcul d'object-cover pour que le texte reste sur l'écran du téléphone, quel que soit le cadrage.
// Quand la vidéo est rognée sur les côtés (écran étroit, iPhone), le cadrage est décalé pour centrer le Nokia.
function useScreenAnchor(frame: RefObject<HTMLDivElement | null>): Anchor {
  const [anchor, setAnchor] = useState<Anchor>(null);
  useLayoutEffect(() => {
    const node = frame.current;
    if (!node) return;
    const update = () => {
      const { clientWidth: w, clientHeight: h } = node;
      if (!w || !h) return;
      const scale = Math.max(w / VIDEO.width, h / VIDEO.height);
      const overflowX = w - VIDEO.width * scale; // ≤ 0 : largeur rognée
      const objectPositionX = overflowX < -1 ? Math.min(1, Math.max(0, (w / 2 - PHONE_CENTER_X * scale) / overflowX)) : 0.5;
      const offsetX = overflowX * objectPositionX;
      const offsetY = (h - VIDEO.height * scale) / 2;
      setAnchor({
        objectPositionX,
        left: offsetX + SCREEN.left * scale,
        bottom: h - (offsetY + SCREEN.bottom * scale),
        width: SCREEN.width * scale,
        fontSize: Math.max(9, Math.min(22, SCREEN.fontAt1x * scale))
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [frame]);
  return anchor;
}

function TypingMessages({ anchor }: { anchor: Anchor }) {
  const messages = COPY.messages;
  const [index, setIndex] = useState(0);
  const [text, setText] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const current = messages[index];
    let timeout: ReturnType<typeof setTimeout>;
    if (!deleting && text === current) timeout = setTimeout(() => setDeleting(true), 2000);
    else if (deleting && text === '') { setDeleting(false); setIndex(value => (value + 1) % messages.length); }
    else timeout = setTimeout(() => setText(deleting ? current.slice(0, text.length - 1) : current.slice(0, text.length + 1)), deleting ? 50 : 100);
    return () => clearTimeout(timeout);
  }, [text, deleting, index]);

  // Positions de la spécification tant que le cadrage n'est pas mesuré, puis position calculée sur l'écran du téléphone.
  // (Les utilitaires sont en !important : on ne les applique donc pas une fois la mesure disponible.)
  return (
    <div
      aria-hidden="true"
      className={`absolute z-30 flex justify-start text-left ${anchor ? '' : 'left-[48.5%] md:left-[47.5%] lg:left-[48.5%] -translate-x-1/2 bottom-[32%] w-[110px] sm:w-[130px]'}`}
      style={anchor ? { left: anchor.left, bottom: anchor.bottom, width: anchor.width } : undefined}
    >
      <p className={`font-nokia text-[#2A3616] leading-tight break-words min-h-[1.5em] m-0 ${anchor ? '' : 'text-[10px] sm:text-[14px]'}`} style={anchor ? { fontSize: anchor.fontSize } : undefined}>
        {text}
        <motion.span
          className={`inline-block bg-[#2A3616] ml-1 align-middle ${anchor ? '' : 'w-1.5 h-3'}`}
          style={anchor ? { width: anchor.fontSize * 0.43, height: anchor.fontSize * 0.86 } : undefined}
          animate={{ opacity: [0, 1, 0] }}
          transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
        />
      </p>
    </div>
  );
}

function Navbar() {
  const links = COPY.links;
  // Même « Dynamic Island » que les autres pages (styles et comportement : mobile-app.css et island.js).
  const panelLinks = [['Prestations', '/services.html'], ['Le salon et les avis', '/shop.html'], ['Fidélité', '/loyalty.html'], ['Conditions générales', '/terms.html']];
  return (
    <header className="island" data-island>
      <div className="island-shell">
        <div className="island-bar">
          <a className="island-logo" href="/" aria-label="CUTLY, accueil">{COPY.logo}</a>
          <nav className="island-links" aria-label="Navigation principale">
            {links.map(link => <a key={link.href} href={link.href}>{link.label}</a>)}
          </nav>
          <a className="island-account" href="/profile.html" aria-label="Mon profil">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.8" /><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" /></svg>
          </a>
          <a className="island-cta" href="/booking.html">{REFERENCE ? COPY.cta : 'Réserver'}</a>
          <button className="island-toggle" type="button" data-island-toggle aria-expanded="false" aria-controls="island-panel">
            Thomas Shop<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
          </button>
        </div>
        <div className="island-panel" id="island-panel">
          <div>
            <div className="island-panel-inner">
              <p className="island-shop">Thomas Shop</p>
              <p className="island-status" data-island-status role="status" />
              <p className="island-meta">8 cours de l’Île Seguin, Boulogne-Billancourt</p>
              <nav className="island-panel-links" aria-label="Liens secondaires">
                {panelLinks.map(([label, href]) => <a key={href} href={href}>{label}</a>)}
              </nav>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  const section = useRef<HTMLElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const anchor = useScreenAnchor(frame);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: section, offset: ['start start', 'end start'] });
  // Au défilement : la scène s'approche doucement, le texte s'élève et se floute.
  const sceneScale = useTransform(scrollYProgress, [0, 1], [1, reduce ? 1 : 1.12]);
  const textY = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : -140]);
  const textOpacity = useTransform(scrollYProgress, [0, 0.55], [1, reduce ? 1 : 0]);
  const blur = useTransform(scrollYProgress, [0, 0.55], [0, reduce ? 0 : 10]);
  const textFilter = useMotionTemplate`blur(${blur}px)`;

  return (
    <section ref={section} aria-labelledby="hero-title" className="relative min-h-screen bg-[#F3F4ED] pt-24 md:pt-32 flex flex-col items-center overflow-hidden">
      <motion.div ref={frame} className="absolute inset-0 z-0 origin-center" style={{ scale: sceneScale }}>
        <video className="absolute inset-0 w-full h-full object-cover" style={anchor ? { objectPosition: `${(anchor.objectPositionX * 100).toFixed(2)}% 50%` } : undefined} src={VIDEO_SRC} autoPlay loop muted playsInline preload="auto" aria-hidden="true" />
        <div className="absolute inset-0 bg-white/5" />
        <TypingMessages anchor={anchor} />
      </motion.div>

      <motion.div className="relative z-20 pointer-events-none text-center px-5" style={{ y: textY, opacity: textOpacity, filter: textFilter }}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.5, ease: EASE }}
          className="font-instrument text-[38px] md:text-[56px] lg:text-[72px] leading-[0.85] tracking-tight text-[#1a1a1a] mb-6"
        >
          <h1 id="hero-title" className="font-instrument font-normal text-[38px] md:text-[56px] lg:text-[72px] leading-[0.85] tracking-tight text-[#1a1a1a] m-0">{COPY.title[0]} <br /> {COPY.title[1]}</h1>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.2, delay: 0.3, ease: EASE }}
          className="font-sans text-[16px] md:text-[18px] text-[#1a1a1a]/70 leading-relaxed font-normal max-w-xl mx-auto"
        >
          <p className="m-0 font-sans text-[16px] md:text-[18px] text-[#1a1a1a]/70 leading-relaxed font-normal">{COPY.subtitle}</p>
        </motion.div>
        {/* Sur iPhone l'île ne porte pas « Réserver » : l'action principale est ici, bien visible. */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1, delay: 0.5, ease: EASE }} className="hero-cta-mobile pointer-events-auto mt-7">
          <a className="button" href="/booking.html">Réserver une coupe</a>
        </motion.div>
      </motion.div>
    </section>
  );
}

export default function App() {
  return (
    <>
      <Navbar />
      <Hero />
      {!REFERENCE && <Manifesto />}
    </>
  );
}
