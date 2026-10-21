-- Row Level Security : défense en profondeur.
-- Le serveur DOSSIER X est le seul client autorisé de la base ; il se connecte avec le rôle
-- propriétaire des tables. Activer la RLS sans politique pour les autres rôles garantit qu'un
-- accès direct (par exemple l'API REST automatique de Supabase avec la clé « anon ») ne peut
-- lire ni modifier aucune ligne : toutes les autorisations passent par les contrôles du serveur.
alter table admins             enable row level security;
alter table admin_sessions     enable row level security;
alter table scenarios          enable row level security;
alter table scenario_versions  enable row level security;
alter table sv_characters      enable row level security;
alter table sv_locations       enable row level security;
alter table sv_items           enable row level security;
alter table sv_envelopes       enable row level security;
alter table sv_timeline        enable row level security;
alter table sv_stages          enable row level security;
alter table sv_events          enable row level security;
alter table resources          enable row level security;
alter table resource_aliases   enable row level security;
alter table games              enable row level security;
alter table game_organizers    enable row level security;
alter table players            enable row level security;
alter table discoveries        enable row level security;
alter table location_visits    enable row level security;
alter table game_envelopes     enable row level security;
alter table shares             enable row level security;
alter table board_items        enable row level security;
alter table board_links        enable row level security;
alter table game_notes         enable row level security;
alter table accusations        enable row level security;
alter table accusation_votes   enable row level security;
alter table game_events        enable row level security;
alter table scans              enable row level security;
alter table audit_log          enable row level security;
