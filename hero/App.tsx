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

type Anchor = { left: number; bottom: number; width: number; fontSize: number } | null;

// Reproduit le calcul d'object-cover pour que le texte reste sur l'écran du téléphone, quel que soit le cadrage.
function useScreenAnchor(frame: RefObject<HTMLDivElement | null>): Anchor {
  const [anchor, setAnchor] = useState<Anchor>(null);
  useLayoutEffect(() => {
    const node = frame.current;
    if (!node) return;
    const update = () => {
      const { clientWidth: w, clientHeight: h } = node;
      if (!w || !h) return;
      const scale = Math.max(w / VIDEO.width, h / VIDEO.height);
      const offsetX = (w - VIDEO.width * scale) / 2;
      const offsetY = (h - VIDEO.height * scale) / 2;
      setAnchor({
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
  return (
    <div className="fixed top-6 left-1/2 -translate-x-1/2 w-[95%] max-w-5xl z-50 pointer-events-none" style={{ top: 'calc(1.5rem + env(safe-area-inset-top))' }}>
      <nav aria-label="Navigation de l’accueil" className="hero-pill pointer-events-auto backdrop-blur-md rounded-full bg-transparent border border-black/10 flex items-center justify-between pl-6 pr-2 py-2">
        <a href="/" aria-label="CUTLY, accueil" className="font-instrument text-[28px] tracking-tight text-[#1a1a1a] leading-none no-underline">{COPY.logo}</a>
        <div className="hidden md:flex items-center gap-10">
          {links.map(link => (
            <a key={link.href} href={link.href} className="font-sans text-[14px] text-[#1a1a1a] no-underline transition-opacity duration-300 hover:opacity-60">{link.label}</a>
          ))}
        </div>
        <a href="/booking.html" className="group liquid-cta relative overflow-hidden inline-flex items-center rounded-full bg-[#0871E7] text-white font-sans text-[14px] font-medium px-5 py-2.5 no-underline shadow-[inset_0_-4px_4px_rgba(255,255,255,0.39)] outline-1 outline-[#0871E7] -outline-offset-1">
          <span aria-hidden="true" className="absolute w-[80%] h-4 left-[10%] top-[1px] bg-gradient-to-b from-[#DEF0FC] to-transparent rounded-[12px] transition-transform duration-500 group-hover:scale-x-105" />
          <span className="relative">{COPY.cta}</span>
        </a>
      </nav>
    </div>
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
        <video className="absolute inset-0 w-full h-full object-cover" src={VIDEO_SRC} autoPlay loop muted playsInline preload="auto" aria-hidden="true" />
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
