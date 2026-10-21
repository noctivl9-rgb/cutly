-- DOSSIER X — schéma initial
-- La base de données est la source officielle de vérité.

-- ─── Administration ──────────────────────────────────────────────
create table admins (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text not null,
  role          text not null check (role in ('superadmin', 'author')),
  created_at    timestamptz not null default now()
);

create table admin_sessions (
  token_hash text primary key,
  admin_id   uuid not null references admins(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index admin_sessions_admin_idx on admin_sessions(admin_id);

-- ─── Moteur de scénarios (versionné) ────────────────────────────
create table scenarios (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  case_number text not null unique,
  created_at  timestamptz not null default now()
);

create table scenario_versions (
  id               uuid primary key default gen_random_uuid(),
  scenario_id      uuid not null references scenarios(id) on delete cascade,
  version          int  not null check (version > 0),
  status           text not null check (status in ('draft', 'published', 'archived')),
  title            text not null,
  synopsis         text not null default '',
  objective        text not null default '',
  difficulty       text not null default 'intermédiaire',
  duration_minutes int  not null default 120,
  min_players      int  not null default 2,
  max_players      int  not null default 6,
  intro            jsonb not null default '{}'::jsonb,
  solution         jsonb not null default '{}'::jsonb,   -- vérité interne : jamais servie aux joueurs avant révélation
  created_by       uuid references admins(id) on delete set null,
  created_at       timestamptz not null default now(),
  published_at     timestamptz,
  unique (scenario_id, version),
  check (min_players <= max_players)
);
create unique index scenario_versions_one_draft on scenario_versions(scenario_id) where status = 'draft';

create table sv_characters (
  version_id uuid not null references scenario_versions(id) on delete cascade,
  ref        text not null,
  sort       int  not null default 0,
  name       text not null,
  role       text not null,
  public     jsonb not null default '{}'::jsonb,  -- visible par tous
  private    jsonb not null default '{}'::jsonb,  -- visible par le joueur qui incarne le personnage
  truth      jsonb not null default '{}'::jsonb,  -- vérité interne (organisateur)
  primary key (version_id, ref)
);

create table sv_locations (
  version_id uuid not null references scenario_versions(id) on delete cascade,
  ref        text not null,
  sort       int  not null default 0,
  name       text not null,
  stage      int  not null default 1,              -- étape à partir de laquelle le lieu est accessible
  public     jsonb not null default '{}'::jsonb,
  primary key (version_id, ref)
);

-- Indices, témoignages et documents
create table sv_items (
  version_id      uuid not null references scenario_versions(id) on delete cascade,
  ref             text not null,
  kind            text not null check (kind in ('indice', 'temoignage', 'document')),
  type            text not null default 'objet',
  title           text not null,
  location_ref    text,
  confidentiality text not null default 'commun' check (confidentiality in ('commun', 'personnel', 'confidentiel')),
  owner_character text,                            -- document personnel d'un personnage
  stage           int  not null default 1,
  discovery       jsonb not null default '{}'::jsonb, -- {modes:[search|qr|envelope|event], requires:[], envelope}
  teaser          text not null default '',        -- description publique avant découverte
  content         jsonb not null default '{}'::jsonb,
  relations       jsonb not null default '[]'::jsonb,
  primary key (version_id, ref)
);

create table sv_envelopes (
  version_id uuid not null references scenario_versions(id) on delete cascade,
  ref        text not null,
  sort       int  not null default 0,
  title      text not null,
  stage      int  not null default 1,
  teaser     text not null default '',
  content    jsonb not null default '{}'::jsonb,
  unlocks    jsonb not null default '[]'::jsonb,
  primary key (version_id, ref)
);

create table sv_timeline (
  version_id   uuid not null references scenario_versions(id) on delete cascade,
  ref          text not null,
  sort         int  not null default 0,
  at_label     text not null,
  title        text not null,
  body         text not null default '',
  visibility   jsonb not null default '{"type":"public"}'::jsonb, -- public | stage | item | envelope | truth
  characters   jsonb not null default '[]'::jsonb,
  location_ref text,
  primary key (version_id, ref)
);

create table sv_stages (
  version_id  uuid not null references scenario_versions(id) on delete cascade,
  idx         int  not null check (idx > 0),
  title       text not null,
  description text not null default '',
  unlock      jsonb not null default '{"type":"organizer"}'::jsonb,
  primary key (version_id, idx)
);

create table sv_events (
  version_id uuid not null references scenario_versions(id) on delete cascade,
  ref        text not null,
  title      text not null,
  body       text not null default '',
  unlocks    jsonb not null default '[]'::jsonb,
  primary key (version_id, ref)
);

-- ─── Registre central des ressources (QR permanents) ────────────
create table resources (
  id          uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references scenarios(id) on delete cascade,
  kind        text not null check (kind in ('lieu', 'indice', 'temoignage', 'document', 'enveloppe', 'evenement')),
  key         text not null,
  ref         text not null,       -- référence de l'entité dans le scénario
  created_at  timestamptz not null default now(),
  unique (kind, key),
  unique (scenario_id, kind, ref)
);

-- Redirections maîtrisées si une clé de route change
create table resource_aliases (
  kind        text not null,
  key         text not null,
  resource_id uuid not null references resources(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (kind, key)
);

-- ─── Parties ────────────────────────────────────────────────────
create table games (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null unique,
  invite_token         text not null unique,
  scenario_version_id  uuid not null references scenario_versions(id),
  status               text not null default 'lobby' check (status in ('lobby', 'running', 'paused', 'ended')),
  settings             jsonb not null default '{}'::jsonb,
  max_players          int  not null check (max_players between 1 and 30),
  current_stage        int  not null default 1,
  created_by_admin     uuid references admins(id) on delete set null,
  created_at           timestamptz not null default now(),
  started_at           timestamptz,
  ended_at             timestamptz,
  solution_revealed_at timestamptz
);
create index games_version_idx on games(scenario_version_id);

create table game_organizers (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references games(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now()
);
create index game_organizers_game_idx on game_organizers(game_id);

create table players (
  id            uuid primary key default gen_random_uuid(),
  game_id       uuid not null references games(id) on delete cascade,
  nickname      text not null check (length(nickname) between 1 and 32),
  character_ref text,
  exclusive     boolean not null default true,
  token_hash    text not null unique,
  recovery_hash text not null,
  ready         boolean not null default false,
  joined_at     timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  unique (game_id, nickname)
);
-- Un personnage ne peut pas être attribué deux fois lorsque l'unicité est active
create unique index players_unique_character on players(game_id, character_ref)
  where exclusive and character_ref is not null;

-- ─── Progression ────────────────────────────────────────────────
create table discoveries (
  game_id         uuid not null references games(id) on delete cascade,
  item_ref        text not null,
  first_player_id uuid references players(id) on delete set null,
  via             text not null,
  discovered_at   timestamptz not null default now(),
  primary key (game_id, item_ref)
);

create table location_visits (
  game_id         uuid not null references games(id) on delete cascade,
  location_ref    text not null,
  first_player_id uuid references players(id) on delete set null,
  visited_at      timestamptz not null default now(),
  primary key (game_id, location_ref)
);

create table game_envelopes (
  game_id      uuid not null references games(id) on delete cascade,
  envelope_ref text not null,
  opened_by    text not null,
  opened_at    timestamptz not null default now(),
  primary key (game_id, envelope_ref)
);

create table shares (
  id            uuid primary key default gen_random_uuid(),
  game_id       uuid not null references games(id) on delete cascade,
  player_id     uuid not null references players(id) on delete cascade,
  character_ref text not null,
  info_key      text not null,
  content       jsonb not null,
  shared_at     timestamptz not null default now(),
  unique (game_id, player_id, info_key)
);

-- ─── Collaboration ──────────────────────────────────────────────
create table board_items (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references games(id) on delete cascade,
  kind       text not null check (kind in ('indice', 'personnage', 'lieu', 'note', 'hypothese')),
  ref        text,
  text       text not null default '',
  x          real not null default 0,
  y          real not null default 0,
  lane       text not null default 'piste' check (lane in ('piste', 'confirme', 'ecarte')),
  version    int  not null default 1,
  created_by uuid references players(id) on delete set null,
  updated_by uuid references players(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index board_items_game_idx on board_items(game_id);

create table board_links (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references games(id) on delete cascade,
  from_id    uuid not null references board_items(id) on delete cascade,
  to_id      uuid not null references board_items(id) on delete cascade,
  label      text not null default '',
  created_by uuid references players(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (game_id, from_id, to_id),
  check (from_id <> to_id)
);

create table game_notes (
  game_id    uuid primary key references games(id) on delete cascade,
  body       text not null default '',
  version    int  not null default 0,
  updated_by uuid references players(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ─── Accusation ─────────────────────────────────────────────────
create table accusations (
  game_id        uuid primary key references games(id) on delete cascade,
  suspect_ref    text,
  motive         text not null default '',
  chronology     text not null default '',
  item_refs      jsonb not null default '[]'::jsonb,
  contradictions text not null default '',
  explanation    text not null default '',
  version        int  not null default 0,
  updated_by     uuid references players(id) on delete set null,
  status         text not null default 'draft' check (status in ('draft', 'submitted')),
  submitted_by   uuid references players(id) on delete set null,
  submitted_at   timestamptz,
  result         jsonb
);

create table accusation_votes (
  game_id          uuid not null references games(id) on delete cascade,
  player_id        uuid not null references players(id) on delete cascade,
  suspect_ref      text,
  approved_version int,
  voted_at         timestamptz not null default now(),
  primary key (game_id, player_id)
);

-- ─── Journal, diffusion et audit ────────────────────────────────
create table game_events (
  id         bigserial primary key,
  game_id    uuid not null references games(id) on delete cascade,
  type       text not null,
  audience   text not null default 'all',   -- all | organizer | player:<uuid>
  actor      text,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index game_events_game_idx on game_events(game_id, id);

create table scans (
  id         bigserial primary key,
  game_id    uuid references games(id) on delete cascade,
  player_id  uuid references players(id) on delete set null,
  kind       text not null,
  key        text not null,
  outcome    text not null,
  created_at timestamptz not null default now()
);
create index scans_game_idx on scans(game_id, created_at);

create table audit_log (
  id         bigserial primary key,
  actor      text not null,
  action     text not null,
  target     text,
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_target_idx on audit_log(target, created_at);
