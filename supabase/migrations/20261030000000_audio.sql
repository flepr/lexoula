-- Λεξούλα — fichiers audio générés côté serveur (voix Gemini) pour les mots, les phrases d'exemple et les textes.
--  * La fonction « audio » calcule tout ce que l'appli peut lire (module supabase/functions/_shared/speech.js),
--    génère les fichiers manquants et les dépose dans le bucket public « audio » sous le nom <clé>.mp3.
--  * La table public.audio dit quels fichiers sont prêts ; l'appli la lit et, à défaut, prend la voix de l'appareil.
--  * public.kick_audio(), appelée chaque minute par pg_cron, ne réveille la fonction que s'il y a du nouveau
--    (mot enrichi, texte prêt, reste à faire) et au moins une fois par jour.

create table if not exists public.audio (
  key text primary key,
  text text not null,
  status text not null default 'pending' check (status in ('pending', 'ready', 'error')),
  model text,
  seconds real,
  bytes int,
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists audio_status_idx on public.audio (status);

alter table public.audio enable row level security;
drop policy if exists audio_read on public.audio;
create policy audio_read on public.audio for select to authenticated using (status = 'ready');
grant all on public.audio to service_role;
grant select on public.audio to authenticated;

-- bucket public : fichiers lisibles par URL (nom = empreinte du texte), écrits seulement par la fonction (service_role)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('audio', 'audio', true, 5242880, array['audio/mpeg'])
on conflict (id) do update set public = true, file_size_limit = 5242880, allowed_mime_types = array['audio/mpeg'];

-- réveil de la fonction « audio »
create or replace function public.kick_audio()
returns void
language plpgsql security definer set search_path = public, private, extensions as $$
declare
  v_secret text;
  v_state jsonb;
  v_sweep jsonb;
  v_at timestamptz;
begin
  select value into v_state from public.app_config where key = 'audio_state';
  if (v_state->>'pause_until') is not null and (v_state->>'pause_until')::timestamptz > now() then return; end if;
  if (v_state->>'running_since') is not null and (v_state->>'running_since')::timestamptz > now() - interval '3 minutes' then return; end if;

  select value into v_sweep from public.app_config where key = 'audio_sweep';
  v_at := coalesce((v_sweep->>'at')::timestamptz, '-infinity'::timestamptz);
  if not (
       coalesce((v_sweep->>'more')::boolean, true)
    or v_at < now() - interval '1 day'
    or exists (select 1 from public.lexemes where status = 'ready' and updated_at > v_at)
    or (select count(*) from public.texts where status = 'ready') <> coalesce((v_sweep->>'texts')::int, -1)
  ) then
    return;
  end if;

  select value into v_secret from private.secrets where name = 'cron_secret';
  perform net.http_post(
    url := 'https://bffjndnxeynyoseryfzs.supabase.co/functions/v1/audio',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
end;
$$;
revoke execute on function public.kick_audio() from public, anon, authenticated;

select cron.unschedule('lexoula-audio') where exists (select 1 from cron.job where jobname = 'lexoula-audio');
select cron.schedule('lexoula-audio', '* * * * *', $$ select public.kick_audio(); $$);
