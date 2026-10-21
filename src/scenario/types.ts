// Format d'import d'une enquête. Une fois publiée, une version est immuable en base.

export type Visibility =
  | { type: 'public' }
  | { type: 'stage'; stage: number }
  | { type: 'item'; ref: string }
  | { type: 'envelope'; ref: string }
  | { type: 'truth' };

export type StageUnlock =
  | { type: 'start' }
  | { type: 'organizer' }
  | { type: 'items'; all?: string[]; among?: string[]; min?: number };

export interface Discovery {
  /** search : fouille du lieu · qr : carte physique · envelope : ouverture d'enveloppe · event : événement · owner : document personnel */
  modes: Array<'search' | 'qr' | 'envelope' | 'event' | 'owner'>;
  requires?: string[];
  envelope?: string;
}

export interface ScenarioDefinition {
  slug: string;
  caseNumber: string;
  meta: {
    title: string;
    synopsis: string;
    objective: string;
    difficulty: string;
    durationMinutes: number;
    minPlayers: number;
    maxPlayers: number;
    intro: Record<string, any>;
  };
  stages: Array<{ idx: number; title: string; description: string; unlock: StageUnlock }>;
  locations: Array<{ ref: string; key: string; name: string; stage: number; public: Record<string, any> }>;
  characters: Array<{ ref: string; name: string; role: string; public: Record<string, any>; private: Record<string, any>; truth: Record<string, any> }>;
  items: Array<{
    ref: string;
    kind: 'indice' | 'temoignage' | 'document';
    type: string;
    title: string;
    locationRef: string | null;
    stage: number;
    confidentiality?: 'commun' | 'personnel' | 'confidentiel';
    ownerCharacter?: string;
    discovery: Discovery;
    teaser: string;
    content: Record<string, any>;
    relations?: string[];
  }>;
  envelopes: Array<{ ref: string; sort: number; title: string; stage: number; teaser: string; content: Record<string, any>; unlocks: string[] }>;
  events: Array<{ ref: string; title: string; body: string; unlocks: string[] }>;
  timeline: Array<{ ref: string; sort: number; at: string; title: string; body: string; visibility: Visibility; characters: string[]; location: string | null }>;
  solution: {
    culprit: string;
    motive: string;
    motiveText: string;
    keyItems: string[];
    contradictions: string[];
    conclusion: string[];
    itemRoles: Record<string, string>;
  };
}
