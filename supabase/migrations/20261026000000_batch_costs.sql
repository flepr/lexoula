-- Coûts de l'IA (26/10/2026, décisions de Fabien).
--  * Les tâches d'IA passent par défaut par l'API « batch » d'Anthropic (−50 %, prêt en général en moins d'une heure).
--    Filet de sécurité dans le worker : un lot non terminé au bout de 2 h est annulé et le reste repasse en direct.
--  * Un professeur ou un admin peut demander un traitement rapide (appels directs, plein tarif) à l'import.
--  * Chaque appel est enregistré (ai_usage) pour estimer le coût d'un import, affiché en euros aux profs et admins.

-- ─────────────────────────────────────────── file de travail : mode, lot, contexte
alter table public.jobs add column if not exists mode text not null default 'batch';
alter table public.jobs drop constraint if exists jobs_mode_check;
alter table public.jobs add constraint jobs_mode_check check (mode in ('batch', 'sync'));
alter table public.jobs add column if not exists batch_id text;
alter table public.jobs add column if not exists ctx jsonb;
alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs add constraint jobs_status_check check (status in ('pending', 'running', 'batched', 'done', 'error'));

-- lots envoyés à Anthropic (réservé au worker)
create table if not exists public.ai_batches (
  id text primary key,
  status text not null default 'in_progress' check (status in ('in_progress', 'canceling', 'ended', 'processed')),
  job_ids bigint[] not null default '{}',
  cached boolean not null default false,
  created_at timestamptz not null default now(),
  polled_at timestamptz,
  cancel_requested_at timestamptz,
  processed_at timestamptz
);
alter table public.ai_batches enable row level security;

-- consommation réelle de chaque appel (sert aux estimations ; lisible par l'admin)
create table if not exists public.ai_usage (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  job_type text not null,
  kind text,                     -- 'short' / 'long' pour les textes et leurs traductions
  mode text not null,            -- 'batch' ou 'sync'
  model text,
  units int not null default 0,  -- nombre de mots pour un enrichissement
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  cache_write_tokens int not null default 0,
  cost_usd numeric not null default 0,  -- coût réellement facturé
  std_usd numeric not null default 0    -- même appel au tarif direct (sans remise batch), base des estimations
);
create index if not exists ai_usage_recent_idx on public.ai_usage (job_type, created_at desc);
alter table public.ai_usage enable row level security;
drop policy if exists ai_usage_admin on public.ai_usage;
create policy ai_usage_admin on public.ai_usage for select to authenticated using (public.is_admin());

-- taux de change de repli (le worker le met à jour chaque jour depuis la BCE)
insert into public.app_config (key, value)
values ('usd_eur', '{"rate": 0.86, "date": null}'::jsonb)
on conflict (key) do nothing;

-- ─────────────────────────────────────────── import d'une liste (option « rapide » pour le staff)
drop function if exists public.submit_list(uuid, text, date, jsonb);
create or replace function public.submit_list(p_group uuid, p_title text, p_date date, p_items jsonb, p_fast boolean default false)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_list uuid;
  v_item jsonb;
  v_key text;
  v_lex uuid;
  v_pos int := 0;
  v_level text;
  v_pending uuid[];
  v_recent int;
  v_mode text;
  i int;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.has_access() then raise exception 'no_class'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'empty_list'; end if;
  if jsonb_array_length(p_items) > 200 then raise exception 'too_many_words'; end if;
  v_mode := case when coalesce(p_fast, false) and public.is_staff() then 'sync' else 'batch' end;

  if p_group is not null then
    if not public.is_teacher_of(p_group) then raise exception 'forbidden'; end if;
    select level into v_level from public.groups where id = p_group;
    insert into public.lists (group_id, title, lesson_date, created_by)
    values (p_group, trim(p_title), coalesce(p_date, current_date), auth.uid()) returning id into v_list;
  else
    -- garde-fou de coût : 300 nouveaux mots personnels par semaine et par élève
    select count(*) into v_recent
    from public.list_items li join public.lists l on l.id = li.list_id
    where l.owner_id = auth.uid() and l.created_at > now() - interval '7 days';
    if v_recent + jsonb_array_length(p_items) > 300 and not public.is_staff() then
      raise exception 'weekly_limit';
    end if;
    insert into public.lists (owner_id, title, lesson_date, created_by)
    values (auth.uid(), trim(p_title), coalesce(p_date, current_date), auth.uid()) returning id into v_list;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_key := public.normalize_key(v_item ->> 'input');
    continue when v_key = '' or length(v_key) > 200;
    insert into public.lexemes (key, input, hint)
    values (v_key, trim(v_item ->> 'input'), nullif(trim(coalesce(v_item ->> 'hint', '')), ''))
    on conflict (key) do update set
      hint = coalesce(public.lexemes.hint, excluded.hint),
      status = case when public.lexemes.status = 'error' then 'pending' else public.lexemes.status end,
      updated_at = now()
    returning id into v_lex;
    insert into public.list_items (list_id, lexeme_id, position) values (v_list, v_lex, v_pos)
    on conflict do nothing;
    v_pos := v_pos + 1;
  end loop;

  -- mots à traiter par l'IA, par paquets de 4
  select array_agg(l.id order by li.position) into v_pending
  from public.list_items li join public.lexemes l on l.id = li.lexeme_id
  where li.list_id = v_list and l.status = 'pending'
    and not exists (
      select 1 from public.jobs j
      where j.type = 'enrich' and j.status in ('pending', 'running', 'batched')
        and j.payload -> 'lexeme_ids' ? l.id::text
    );
  if v_pending is not null then
    i := 1;
    while i <= array_length(v_pending, 1) loop
      insert into public.jobs (type, mode, payload) values ('enrich', v_mode, jsonb_build_object(
        'lexeme_ids', to_jsonb(v_pending[i:least(i + 3, array_length(v_pending, 1))]),
        'list_id', v_list,
        'level', coalesce(v_level, 'B1')
      ));
      i := i + 4;
    end loop;
  else
    -- tous les mots existaient déjà : on peut directement proposer un texte
    if p_group is not null then
      insert into public.jobs (type, mode, payload)
      values ('text', v_mode, jsonb_build_object('group_id', p_group, 'kind', 'short', 'reason', 'new_list'));
    end if;
  end if;
  return v_list;
end;
$$;

-- ─────────────────────────────────────────── estimation du coût d'un import (staff uniquement)
-- Renvoie des montants en dollars au tarif direct ; l'interface applique la remise batch et convertit en euros.
create or replace function public.estimate_import(p_group uuid, p_items jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_new int := 0;
  v_units int; v_word_std numeric; v_word numeric;
  v_text numeric; v_ntext int; v_tr numeric; v_ntr int;
  v_rate numeric;
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'bad_items'; end if;

  select count(distinct k) into v_new
  from (select public.normalize_key(x ->> 'input') as k from jsonb_array_elements(p_items) x) s
  where k <> '' and length(k) <= 200
    and not exists (select 1 from public.lexemes l where l.key = s.k and l.status in ('ready', 'pending'));

  -- coût moyen d'un mot, mesuré sur les 60 derniers jours (repli : mesure des 235 premiers mots, 26/10/2026)
  select coalesce(sum(units), 0), sum(std_usd) into v_units, v_word_std
  from public.ai_usage where job_type = 'enrich' and created_at > now() - interval '60 days';
  v_word := case when v_units >= 20 then v_word_std / v_units else 0.0146 end;

  -- coût moyen d'un texte court et de ses traductions (deux appels)
  select count(*), avg(std_usd) into v_ntext, v_text
  from public.ai_usage where job_type = 'text' and kind = 'short' and created_at > now() - interval '60 days';
  select count(*), avg(std_usd) into v_ntr, v_tr
  from public.ai_usage where job_type = 'translate' and kind = 'short' and created_at > now() - interval '60 days';

  select coalesce((value ->> 'rate')::numeric, 0.86) into v_rate from public.app_config where key = 'usd_eur';

  return jsonb_build_object(
    'new_words', v_new,
    'word_usd', round(v_word, 6),
    'text_usd', case when p_group is null then 0
                     when v_ntext >= 2 and v_ntr >= 2 then round(v_text + 2 * v_tr, 6)
                     else 0.06 end,
    'usd_eur', coalesce(v_rate, 0.86),
    'measured', v_units >= 20
  );
end;
$$;

-- ─────────────────────────────────────────── textes : tenir compte des tâches envoyées en lot
create or replace function public.request_text(p_group uuid, p_kind text default 'short')
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_teacher_of(p_group) then raise exception 'forbidden'; end if;
  if exists (select 1 from public.jobs where type in ('text', 'translate') and status in ('pending', 'running', 'batched')
             and payload ->> 'group_id' = p_group::text) then
    raise exception 'already_running';
  end if;
  insert into public.jobs (type, payload)
  values ('text', jsonb_build_object('group_id', p_group, 'kind', case when p_kind = 'long' then 'long' else 'short' end,
                                     'reason', 'manual'));
end;
$$;

create or replace function public.schedule_texts(p_kind text)
returns int
language plpgsql security definer set search_path = public as $$
declare v_count int := 0; r record;
begin
  for r in
    select g.id from public.groups g
    where not g.archived and g.texts_enabled
      and exists (select 1 from public.group_members m where m.group_id = g.id)
      and (select count(distinct li.lexeme_id) from public.lists ls join public.list_items li on li.list_id = ls.id
           join public.lexemes lx on lx.id = li.lexeme_id where ls.group_id = g.id and lx.status = 'ready') >= 8
  loop
    if not exists (select 1 from public.jobs where type in ('text', 'translate') and status in ('pending', 'running', 'batched')
                   and payload ->> 'group_id' = r.id::text) then
      insert into public.jobs (type, payload)
      values ('text', jsonb_build_object('group_id', r.id, 'kind', p_kind, 'reason', 'schedule'));
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- ─────────────────────────────────────────── worker : prise de tâches par mode
create or replace function public.claim_jobs_mode(p_mode text, p_limit int)
returns setof public.jobs
language sql security definer set search_path = public as $$
  update public.jobs j
  set status = 'running', attempts = j.attempts + 1, updated_at = now()
  where j.id in (
    select id from public.jobs
    where status = 'pending' and run_after <= now() and mode = p_mode
    order by case type when 'enrich' then 0 when 'translate' then 1 else 2 end, id
    limit p_limit
    for update skip locked
  )
  returning j.*;
$$;

-- réveille le worker s'il y a du travail ou un lot à surveiller (appelé chaque minute par pg_cron)
create or replace function public.kick_worker()
returns void
language plpgsql security definer set search_path = public, private, extensions as $$
declare v_secret text;
begin
  update public.jobs set status = 'pending', updated_at = now()
  where status = 'running' and updated_at < now() - interval '6 minutes' and attempts < 4;
  update public.jobs set status = 'error', last_error = coalesce(last_error, 'timeout'), updated_at = now()
  where status = 'running' and updated_at < now() - interval '6 minutes' and attempts >= 4;

  if not exists (select 1 from public.jobs where status = 'pending' and run_after <= now())
     and not exists (select 1 from public.ai_batches where status in ('in_progress', 'canceling', 'ended')) then
    return;
  end if;
  if exists (select 1 from public.jobs where status = 'running' and updated_at > now() - interval '3 minutes') then return; end if;

  select value into v_secret from private.secrets where name = 'cron_secret';
  perform net.http_post(
    url := 'https://bffjndnxeynyoseryfzs.supabase.co/functions/v1/worker',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
end;
$$;

-- ─────────────────────────────────────────── droits d'exécution
revoke execute on function public.submit_list(uuid, text, date, jsonb, boolean), public.estimate_import(uuid, jsonb),
  public.claim_jobs_mode(text, int) from public, anon;
grant execute on function public.submit_list(uuid, text, date, jsonb, boolean), public.estimate_import(uuid, jsonb)
  to authenticated;
revoke execute on function public.claim_jobs_mode(text, int), public.kick_worker(), public.schedule_texts(text)
  from authenticated;
grant execute on function public.claim_jobs_mode(text, int) to service_role;

-- les lots terminés depuis plus de 30 jours n'ont plus d'utilité
do $$ begin perform cron.unschedule('lexoula-cleanup'); exception when others then null; end $$;
select cron.schedule('lexoula-cleanup', '15 3 * * *', $$
  delete from public.jobs where status = 'done' and updated_at < now() - interval '14 days';
  delete from public.ai_batches where status = 'processed' and processed_at < now() - interval '30 days';
  delete from net._http_response where created < now() - interval '2 days';
$$);
