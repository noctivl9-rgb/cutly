import { useRef } from 'react';
import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from 'motion/react';

// Texte révélé mot à mot au défilement ; les mots en italique passent en Instrument Serif italique.
const WORDS: Array<[string, boolean?]> = [
  ['Chez'], ['Thomas,'], ['chaque'], ['coupe'], ['commence'], ['par'], ['un'], ['créneau'], ['clair.'],
  ['Dégradé,', true], ['taper,', true], ['contours', true], ['—'], ['vous'], ['choisissez'], ['l’heure,'], ['il'], ['s’occupe'], ['du'], ['reste.']
];

function Word({ children, italic, progress, range }: { children: string; italic?: boolean; progress: MotionValue<number>; range: [number, number] }) {
  const opacity = useTransform(progress, range, [0.12, 1]);
  const y = useTransform(progress, range, [10, 0]);
  return (
    <motion.span style={{ opacity, y }} className={`inline-block mr-[0.24em] ${italic ? 'italic text-[#0871E7]' : ''}`}>
      {children}
    </motion.span>
  );
}

export default function Manifesto() {
  const section = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: section, offset: ['start 0.85', 'end 0.45'] });
  // Inter variable : la graisse de l'intitulé glisse de 200 à 700 pendant la lecture.
  const weight = useTransform(scrollYProgress, [0, 1], [200, 700]);
  const tracking = useTransform(scrollYProgress, [0, 1], ['0.4em', '0.18em']);

  return (
    <section ref={section} aria-labelledby="manifesto-title" className="relative bg-[#F3F4ED] px-5 pt-24 pb-16 md:pt-36 md:pb-24">
      <div className="max-w-3xl mx-auto text-center">
        <motion.p
          id="manifesto-title"
          style={reduce ? undefined : { fontWeight: weight, letterSpacing: tracking }}
          className="font-sans uppercase text-[12px] md:text-[13px] text-[#1a1a1a]/60 mb-8"
        >
          Thomas Shop · Boulogne-Billancourt
        </motion.p>
        <p className="font-instrument text-[34px] md:text-[52px] leading-[1.02] tracking-tight text-[#1a1a1a] m-0" aria-label={WORDS.map(([word]) => word).join(' ')}>
          {WORDS.map(([word, italic], index) => {
            const start = index / WORDS.length;
            return (
              <Word key={index} italic={italic} progress={scrollYProgress} range={reduce ? [-1, 0] : [start, Math.min(1, start + 2.5 / WORDS.length)]}>
                {word}
              </Word>
            );
          })}
        </p>
      </div>
    </section>
  );
}
