// Moteur de scénarios : import, versions, publication, registre des ressources QR.
import type { Database, Query } from '../db.ts';
import type { ScenarioDefinition } from '../scenario/types.ts';
import { HttpError } from '../http.ts';

export interface VersionContent {
  id: string;
  scenarioId: string;
  slug: string;
  caseNumber: string;
  version: number;
  status: string;
  meta: { title: string; synopsis: string; objective: string; difficulty: string; durationMinutes: number; minPlayers: number; maxPlayers: number; intro: any };
  solution: any;
  stages: Array<{ idx: number; title: string; description: string; unlock: any }>;
  locations: Array<{ ref: string; sort: number; name: string; stage: number; public: any }>;
  characters: Array<{ ref: string; sort: number; name: string; role: string; public: any; private: any; truth: any }>;
  items: Array<{ ref: string; kind: string; type: string; title: string; locationRef: string | null; confidentiality: string; ownerCharacter: string | null; stage: number; discovery: any; teaser: string; content: any; relations: any[] }>;
  envelopes: Array<{ ref: string; sort: number; title: string; stage: number; teaser: string; content: any; unlocks: string[] }>;
  events: Array<{ ref: string; title: string; body: string; unlocks: string[] }>;
  timeline: Array<{ ref: string; sort: number; at: string; title: string; body: string; visibility: any; characters: string[]; location: string | null }>;
}

/** Colonnes éditables de chaque entité, pour l'éditeur d'enquêtes. */
export const ENTITIES: Record<string, { table: string; key: 'ref' | 'idx'; cols: Record<string, 'text' | 'int' | 'json' | 'textnull'> }> = {
  characters: { table: 'sv_characters', key: 'ref', cols: { ref: 'text', sort: 'int', name: 'text', role: 'text', public: 'json', private: 'json', truth: 'json' } },
  locations: { table: 'sv_locations', key: 'ref', cols: { ref: 'text', sort: 'int', name: 'text', stage: 'int', public: 'json' } },
  items: {
    table: 'sv_items', key: 'ref',
    cols: { ref: 'text', kind: 'text', type: 'text', title: 'text', location_ref: 'textnull', confidentiality: 'text', owner_character: 'textnull', stage: 'int', discovery: 'json', teaser: 'text', content: 'json', relations: 'json' },
  },
  envelopes: { table: 'sv_envelopes', key: 'ref', cols: { ref: 'text', sort: 'int', title: 'text', stage: 'int', teaser: 'text', content: 'json', unlocks: 'json' } },
  timeline: { table: 'sv_timeline', key: 'ref', cols: { ref: 'text', sort: 'int', at_label: 'text', title: 'text', body: 'text', visibility: 'json', characters: 'json', location_ref: 'textnull' } },
  stages: { table: 'sv_stages', key: 'idx', cols: { idx: 'int', title: 'text', description: 'text', unlock: 'json' } },
  events: { table: 'sv_events', key: 'ref', cols: { ref: 'text', title: 'text', body: 'text', unlocks: 'json' } },
};

const cache = new Map<string, VersionContent>();

export async function loadVersion(q: Query, versionId: string): Promise<VersionContent> {
  const cached = cache.get(versionId);
  if (cached) return cached;
  const [v] = await q(
    `select v.*, s.slug, s.case_number from scenario_versions v join scenarios s on s.id = v.scenario_id where v.id = $1`,
    [versionId],
  );
  if (!v) throw new HttpError(404, 'Version de scénario introuvable');
  const [stages, locations, characters, items, envelopes, events, timeline] = await Promise.all([
    q('select * from sv_stages where version_id = $1 order by idx', [versionId]),
    q('select * from sv_locations where version_id = $1 order by sort, ref', [versionId]),
    q('select * from sv_characters where version_id = $1 order by sort, ref', [versionId]),
    q('select * from sv_items where version_id = $1 order by ref', [versionId]),
    q('select * from sv_envelopes where version_id = $1 order by sort, ref', [versionId]),
    q('select * from sv_events where version_id = $1 order by ref', [versionId]),
    q('select * from sv_timeline where version_id = $1 order by sort, ref', [versionId]),
  ]);
  const content: VersionContent = {
    id: v.id,
    scenarioId: v.scenario_id,
    slug: v.slug,
    caseNumber: v.case_number,
    version: v.version,
    status: v.status,
    meta: {
      title: v.title, synopsis: v.synopsis, objective: v.objective, difficulty: v.difficulty,
      durationMinutes: v.duration_minutes, minPlayers: v.min_players, maxPlayers: v.max_players, intro: v.intro,
    },
    solution: v.solution,
    stages: stages.map((r) => ({ idx: r.idx, title: r.title, description: r.description, unlock: r.unlock })),
    locations: locations.map((r) => ({ ref: r.ref, sort: r.sort, name: r.name, stage: r.stage, public: r.public })),
    characters: characters.map((r) => ({ ref: r.ref, sort: r.sort, name: r.name, role: r.role, public: r.public, private: r.private, truth: r.truth })),
    items: items.map((r) => ({
      ref: r.ref, kind: r.kind, type: r.type, title: r.title, locationRef: r.location_ref, confidentiality: r.confidentiality,
      ownerCharacter: r.owner_character, stage: r.stage, discovery: r.discovery, teaser: r.teaser, content: r.content, relations: r.relations,
    })),
    envelopes: envelopes.map((r) => ({ ref: r.ref, sort: r.sort, title: r.title, stage: r.stage, teaser: r.teaser, content: r.content, unlocks: r.unlocks })),
    events: events.map((r) => ({ ref: r.ref, title: r.title, body: r.body, unlocks: r.unlocks })),
    timeline: timeline.map((r) => ({ ref: r.ref, sort: r.sort, at: r.at_label, title: r.title, body: r.body, visibility: r.visibility, characters: r.characters, location: r.location_ref })),
  };
  // Seules les versions publiées sont immuables, donc mises en cache.
  if (v.status !== 'draft') cache.set(versionId, content);
  return content;
}

export function invalidateVersion(versionId: string) {
  cache.delete(versionId);
}

const j = (v: unknown) => JSON.stringify(v ?? null);

/** Importe une définition d'enquête (version 1). Idempotent : ne fait rien si le slug existe. */
export async function importScenario(db: Database, def: ScenarioDefinition, opts: { publish: boolean }) {
  const existing = await db.one('select id from scenarios where slug = $1', [def.slug]);
  if (existing) return existing.id as string;
  return db.tx(async (q) => {
    const [s] = await q('insert into scenarios (slug, case_number) values ($1, $2) returning id', [def.slug, def.caseNumber]);
    const m = def.meta;
    const [v] = await q(
      `insert into scenario_versions (scenario_id, version, status, title, synopsis, objective, difficulty, duration_minutes, min_players, max_players, intro, solution)
       values ($1, 1, 'draft', $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb) returning id`,
      [s.id, m.title, m.synopsis, m.objective, m.difficulty, m.durationMinutes, m.minPlayers, m.maxPlayers, j(m.intro), j(def.solution)],
    );
    const vid = v.id;
    for (const st of def.stages) {
      await q('insert into sv_stages (version_id, idx, title, description, unlock) values ($1,$2,$3,$4,$5::jsonb)', [vid, st.idx, st.title, st.description, j(st.unlock)]);
    }
    for (const [i, l] of def.locations.entries()) {
      await q('insert into sv_locations (version_id, ref, sort, name, stage, public) values ($1,$2,$3,$4,$5,$6::jsonb)', [vid, l.ref, i, l.name, l.stage, j({ ...l.public, qrKey: l.key })]);
    }
    for (const [i, c] of def.characters.entries()) {
      await q('insert into sv_characters (version_id, ref, sort, name, role, public, private, truth) values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb)', [vid, c.ref, i, c.name, c.role, j(c.public), j(c.private), j(c.truth)]);
    }
    for (const it of def.items) {
      await q(
        `insert into sv_items (version_id, ref, kind, type, title, location_ref, confidentiality, owner_character, stage, discovery, teaser, content, relations)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12::jsonb,$13::jsonb)`,
        [vid, it.ref, it.kind, it.type, it.title, it.locationRef, it.confidentiality ?? 'commun', it.ownerCharacter ?? null, it.stage, j(it.discovery), it.teaser, j(it.content), j(it.relations ?? [])],
      );
    }
    for (const e of def.envelopes) {
      await q('insert into sv_envelopes (version_id, ref, sort, title, stage, teaser, content, unlocks) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)', [vid, e.ref, e.sort, e.title, e.stage, e.teaser, j(e.content), j(e.unlocks)]);
    }
    for (const e of def.events) {
      await q('insert into sv_events (version_id, ref, title, body, unlocks) values ($1,$2,$3,$4,$5::jsonb)', [vid, e.ref, e.title, e.body, j(e.unlocks)]);
    }
    for (const t of def.timeline) {
      await q(
        'insert into sv_timeline (version_id, ref, sort, at_label, title, body, visibility, characters, location_ref) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)',
        [vid, t.ref, t.sort, t.at, t.title, t.body, j(t.visibility), j(t.characters), t.location],
      );
    }
    if (opts.publish) await publishVersion(q, vid, null);
    return s.id as string;
  });
}

/** Vérifie la cohérence d'une version (références croisées, solution). */
export function validateVersion(c: VersionContent): string[] {
  const errors: string[] = [];
  const chars = new Set(c.characters.map((x) => x.ref));
  const locs = new Set(c.locations.map((x) => x.ref));
  const items = new Set(c.items.map((x) => x.ref));
  const envs = new Set(c.envelopes.map((x) => x.ref));
  const stages = new Set(c.stages.map((s) => s.idx));
  if (!c.meta.title.trim()) errors.push('Le titre est obligatoire.');
  if (!stages.has(1)) errors.push("L'étape 1 est obligatoire.");
  if (c.characters.length < c.meta.minPlayers) errors.push(`Il faut au moins ${c.meta.minPlayers} personnages.`);
  for (const it of c.items) {
    if (it.locationRef && !locs.has(it.locationRef)) errors.push(`${it.ref} : lieu inconnu ${it.locationRef}.`);
    if (it.ownerCharacter && !chars.has(it.ownerCharacter)) errors.push(`${it.ref} : personnage inconnu ${it.ownerCharacter}.`);
    const modes: string[] = it.discovery?.modes ?? [];
    if (!modes.length) errors.push(`${it.ref} : aucun mode de découverte.`);
    if (modes.includes('search') && !it.locationRef) errors.push(`${it.ref} : la fouille nécessite un lieu.`);
    if (it.discovery?.envelope && !envs.has(it.discovery.envelope)) errors.push(`${it.ref} : enveloppe inconnue ${it.discovery.envelope}.`);
    for (const r of it.discovery?.requires ?? []) if (!items.has(r)) errors.push(`${it.ref} : prérequis inconnu ${r}.`);
    if (!stages.has(it.stage)) errors.push(`${it.ref} : étape inconnue ${it.stage}.`);
  }
  for (const e of c.envelopes) for (const r of e.unlocks ?? []) if (!items.has(r)) errors.push(`${e.ref} : débloque un élément inconnu ${r}.`);
  for (const e of c.events) for (const r of e.unlocks ?? []) if (!items.has(r)) errors.push(`${e.ref} : débloque un élément inconnu ${r}.`);
  for (const t of c.timeline) {
    if (t.visibility?.type === 'item' && !items.has(t.visibility.ref)) errors.push(`${t.ref} : visibilité liée à un élément inconnu.`);
    if (t.location && !locs.has(t.location)) errors.push(`${t.ref} : lieu inconnu.`);
  }
  for (const s of c.stages) {
    for (const r of [...(s.unlock?.all ?? []), ...(s.unlock?.among ?? [])]) if (!items.has(r)) errors.push(`Étape ${s.idx} : élément inconnu ${r}.`);
  }
  const sol = c.solution ?? {};
  if (!chars.has(sol.culprit)) errors.push('Solution : coupable inconnu.');
  const motives = (c.meta.intro?.accusation?.motives ?? []).map((m: any) => m.key);
  if (!motives.includes(sol.motive)) errors.push('Solution : le mobile doit figurer dans la liste des mobiles proposés.');
  for (const r of sol.keyItems ?? []) if (!items.has(r)) errors.push(`Solution : preuve clé inconnue ${r}.`);
  return errors;
}

export async function publishVersion(q: Query, versionId: string, adminId: string | null) {
  invalidateVersion(versionId);
  const content = await loadVersion(q, versionId);
  if (content.status !== 'draft') throw new HttpError(409, 'Seul un brouillon peut être publié.');
  const errors = validateVersion(content);
  if (errors.length) throw new HttpError(422, 'Version incohérente', { errors });
  await q(`update scenario_versions set status = 'published', published_at = now() where id = $1`, [versionId]);
  invalidateVersion(versionId);
  await syncResources(q, content);
  if (adminId) await audit(q, `admin:${adminId}`, 'scenario.publish', versionId, { version: content.version });
}

/** Crée les ressources QR manquantes. Les ressources existantes ne sont jamais supprimées :
 *  un QR imprimé reste valable pour toutes les versions de l'enquête. */
async function syncResources(q: Query, c: VersionContent) {
  const prefix = c.caseNumber === '001' ? '' : `${c.caseNumber}-`;
  const wanted: Array<{ kind: string; key: string; ref: string }> = [
    ...c.locations.map((l) => ({ kind: 'lieu', key: String(l.public?.qrKey ?? l.ref).toLowerCase(), ref: l.ref })),
    ...c.items.filter((i) => i.confidentiality !== 'personnel').map((i) => ({ kind: i.kind, key: i.ref, ref: i.ref })),
    ...c.envelopes.map((e) => ({ kind: 'enveloppe', key: e.ref, ref: e.ref })),
    ...c.events.map((e) => ({ kind: 'evenement', key: e.ref, ref: e.ref })),
  ];
  for (const w of wanted) {
    const exists = await q('select id from resources where scenario_id = $1 and kind = $2 and ref = $3', [c.scenarioId, w.kind, w.ref]);
    if (exists.length) continue;
    let key = w.key;
    const clash = await q('select scenario_id from resources where kind = $1 and key = $2', [w.kind, key]);
    if (clash.length) key = `${prefix || c.caseNumber + '-'}${w.key}`;
    await q('insert into resources (scenario_id, kind, key, ref) values ($1, $2, $3, $4)', [c.scenarioId, w.kind, key, w.ref]);
  }
}

/** Crée un brouillon à partir de la dernière version publiée. */
export async function createDraft(db: Database, scenarioId: string, adminId: string) {
  return db.tx(async (q) => {
    const [draft] = await q(`select id from scenario_versions where scenario_id = $1 and status = 'draft'`, [scenarioId]);
    if (draft) return draft.id as string;
    const [src] = await q(`select * from scenario_versions where scenario_id = $1 order by version desc limit 1`, [scenarioId]);
    if (!src) throw new HttpError(404, 'Enquête introuvable');
    const [v] = await q(
      `insert into scenario_versions (scenario_id, version, status, title, synopsis, objective, difficulty, duration_minutes, min_players, max_players, intro, solution, created_by)
       select scenario_id, $2, 'draft', title, synopsis, objective, difficulty, duration_minutes, min_players, max_players, intro, solution, $3
       from scenario_versions where id = $1 returning id`,
      [src.id, src.version + 1, adminId],
    );
    for (const spec of Object.values(ENTITIES)) {
      const cols = Object.keys(spec.cols).join(', ');
      await q(`insert into ${spec.table} (version_id, ${cols}) select $2, ${cols} from ${spec.table} where version_id = $1`, [src.id, v.id]);
    }
    await audit(q, `admin:${adminId}`, 'scenario.draft', v.id, { from: src.version });
    return v.id as string;
  });
}

export async function createScenario(db: Database, input: { slug: string; caseNumber: string; title: string }, adminId: string) {
  if (!/^[a-z0-9-]{3,40}$/.test(input.slug)) throw new HttpError(400, 'Identifiant invalide (minuscules, chiffres, tirets).');
  if (!/^[0-9]{3}$/.test(input.caseNumber)) throw new HttpError(400, 'Le numéro de dossier comporte trois chiffres.');
  return db.tx(async (q) => {
    const dup = await q('select 1 from scenarios where slug = $1 or case_number = $2', [input.slug, input.caseNumber]);
    if (dup.length) throw new HttpError(409, 'Identifiant ou numéro de dossier déjà utilisé.');
    const [s] = await q('insert into scenarios (slug, case_number) values ($1, $2) returning id', [input.slug, input.caseNumber]);
    const [v] = await q(
      `insert into scenario_versions (scenario_id, version, status, title, intro, solution, created_by)
       values ($1, 1, 'draft', $2, $3::jsonb, '{}'::jsonb, $4) returning id`,
      [s.id, input.title, j({ accusation: { motives: [] } }), adminId],
    );
    await q(`insert into sv_stages (version_id, idx, title, unlock) values ($1, 1, 'Début', '{"type":"start"}'::jsonb)`, [v.id]);
    await audit(q, `admin:${adminId}`, 'scenario.create', s.id, input);
    return { scenarioId: s.id as string, versionId: v.id as string };
  });
}

async function assertDraft(q: Query, versionId: string) {
  const [v] = await q('select status from scenario_versions where id = $1', [versionId]);
  if (!v) throw new HttpError(404, 'Version introuvable');
  if (v.status !== 'draft') throw new HttpError(409, 'Une version publiée est immuable. Créez un brouillon pour la modifier.');
}

function coerce(type: string, value: unknown, col: string) {
  if (type === 'json') return JSON.stringify(value ?? null);
  if (type === 'int') {
    const n = Number(value);
    if (!Number.isInteger(n)) throw new HttpError(400, `Champ ${col} : entier attendu.`);
    return n;
  }
  if (type === 'textnull') return value === null || value === '' || value === undefined ? null : String(value);
  if (value === undefined || value === null) throw new HttpError(400, `Champ ${col} obligatoire.`);
  return String(value);
}

export async function upsertEntity(db: Database, versionId: string, entity: string, data: Record<string, unknown>, adminId: string) {
  const spec = ENTITIES[entity];
  if (!spec) throw new HttpError(404, 'Type d’entité inconnu');
  await db.tx(async (q) => {
    await assertDraft(q, versionId);
    const cols = Object.keys(spec.cols);
    const values = cols.map((c) => coerce(spec.cols[c], data[c], c));
    const placeholders = cols.map((c, i) => `$${i + 2}${spec.cols[c] === 'json' ? '::jsonb' : ''}`);
    const updates = cols.filter((c) => c !== spec.key).map((c) => `${c} = excluded.${c}`);
    await q(
      `insert into ${spec.table} (version_id, ${cols.join(', ')}) values ($1, ${placeholders.join(', ')})
       on conflict (version_id, ${spec.key}) do update set ${updates.join(', ')}`,
      [versionId, ...values],
    );
    await audit(q, `admin:${adminId}`, 'scenario.entity.save', versionId, { entity, key: data[spec.key] });
  });
  invalidateVersion(versionId);
}

export async function deleteEntity(db: Database, versionId: string, entity: string, key: string, adminId: string) {
  const spec = ENTITIES[entity];
  if (!spec) throw new HttpError(404, 'Type d’entité inconnu');
  await db.tx(async (q) => {
    await assertDraft(q, versionId);
    await q(`delete from ${spec.table} where version_id = $1 and ${spec.key} = $2`, [versionId, spec.key === 'idx' ? Number(key) : key]);
    await audit(q, `admin:${adminId}`, 'scenario.entity.delete', versionId, { entity, key });
  });
  invalidateVersion(versionId);
}

export async function updateMeta(db: Database, versionId: string, m: Record<string, any>, adminId: string) {
  await db.tx(async (q) => {
    await assertDraft(q, versionId);
    await q(
      `update scenario_versions set title = $2, synopsis = $3, objective = $4, difficulty = $5, duration_minutes = $6,
         min_players = $7, max_players = $8, intro = $9::jsonb, solution = $10::jsonb where id = $1`,
      [versionId, String(m.title ?? ''), String(m.synopsis ?? ''), String(m.objective ?? ''), String(m.difficulty ?? ''),
        Number(m.durationMinutes ?? 120), Number(m.minPlayers ?? 2), Number(m.maxPlayers ?? 6), j(m.intro ?? {}), j(m.solution ?? {})],
    );
    await audit(q, `admin:${adminId}`, 'scenario.meta.save', versionId, {});
  });
  invalidateVersion(versionId);
}

export async function audit(q: Query, actor: string, action: string, target: string | null, details: unknown) {
  await q('insert into audit_log (actor, action, target, details) values ($1, $2, $3, $4::jsonb)', [actor, action, target, j(details)]);
}
