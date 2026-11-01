-- Λεξούλα — deux phrases d'exemple par mot : une pour les débutants (A1, A2), une pour les avancés (B1 à C2)
-- © 2026 Φοίβος Λεπέρ (Fabien Lepère). Tous droits réservés.
--
-- Décision de Fabien du 01/11/2026 :
--   * un mot reçoit la phrase du palier de la première classe qui l'importe (écrite au niveau de cette classe) ;
--   * importé ensuite dans une classe de l'autre palier, il reçoit en plus une phrase de ce palier ;
--     une classe du même palier (B2 puis C1) ne fait rien régénérer.
--   * stockage dans lexemes.data : la phrase d'origine reste dans ex, ex_tr (exTr), cl, cd, dr, avec son palier
--     dans data.exTier ('beg' | 'adv' ; absent = 'adv', cas de tous les mots créés avant cette migration) ;
--     la phrase de l'autre palier va dans data.alt = { tier, ex, exTr, cl, cd, dr }.
--   * le niveau d'une classe devient obligatoire (B1 par défaut).
-- Les phrases manquantes sont repérées par private.queue_examples() : à l'import d'une liste et chaque minute
-- par kick_worker (changement de niveau d'une classe, liste personnelle, mot encore en préparation à l'import).

-- ── niveau obligatoire
update public.groups set level = 'B1' where level is null;
alter table public.groups alter column level set default 'B1';
alter table public.groups alter column level set not null;

create or replace function public.create_group(p_name text, p_level text, p_kind text default 'group')
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  insert into public.groups (name, level, kind, teacher_id)
  values (trim(p_name), coalesce(nullif(p_level, ''), 'B1'), coalesce(nullif(p_kind, ''), 'group'), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- ── paliers
alter table public.jobs drop constraint if exists jobs_type_check;
alter table public.jobs add constraint jobs_type_check check (type in ('enrich', 'example', 'text', 'proofread', 'translate'));

create or replace function public.level_tier(p_level text)
returns text language sql immutable as $$
  select case when p_level in ('A1', 'A2') then 'beg' else 'adv' end;
$$;

-- palier d'un élève : avancé s'il est dans au moins une classe avancée, débutant s'il n'est que dans des classes
-- débutantes ; sans classe (professeur, admin) : avancé. Même règle que l'appli (src/store.js, exampleTier).
create or replace function private.user_tier(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.group_members m join public.groups g on g.id = m.group_id
                 where m.user_id = p_user and public.level_tier(g.level) = 'adv') then 'adv'
    when exists (select 1 from public.group_members m where m.user_id = p_user) then 'beg'
    else 'adv' end;
$$;

-- niveau auquel écrire les mots personnels d'un élève : le plus élevé de ses classes du palier retenu
create or replace function private.user_level(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select max(g.level) from public.group_members m join public.groups g on g.id = m.group_id
     where m.user_id = p_user and public.level_tier(g.level) = private.user_tier(p_user)),
    'B1');
$$;

-- crée les tâches « example » des mots prêts auxquels manque la phrase du palier d'une de leurs listes.
-- Pour chaque mot, la liste retenue est la plus ancienne de ce palier (niveau et vivier de sa classe).
-- Un mot qui a déjà eu une tâche pour ce palier (quel qu'en soit l'état) n'en reçoit pas d'autre : pas de
-- boucle sur un échec ; les tâches terminées sont effacées après 14 jours (lexoula-cleanup), d'où au pire
-- une nouvelle tentative tous les 14 jours.
create or replace function private.queue_examples(p_mode text default 'batch')
returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_ids uuid[];
  v_n int := 0;
  i int;
begin
  for r in
    with need as (
      select distinct on (l.id, t.tier) l.id, t.tier, t.level, ls.id as list_id, ls.created_at
      from public.list_items li
      join public.lists ls on ls.id = li.list_id
      join public.lexemes l on l.id = li.lexeme_id
      left join public.groups g on g.id = ls.group_id
      cross join lateral (
        select case when ls.group_id is not null then public.level_tier(g.level) else private.user_tier(ls.owner_id) end as tier,
               case when ls.group_id is not null then g.level else private.user_level(ls.owner_id) end as level
      ) t
      where l.status = 'ready'
        and coalesce(l.data ->> 'exTier', 'adv') <> t.tier
        and (l.data -> 'alt' ->> 'tier') is distinct from t.tier
        and not exists (
          select 1 from public.jobs j
          where j.type = 'example' and j.payload ->> 'tier' = t.tier and j.payload -> 'lexeme_ids' ? l.id::text
        )
      order by l.id, t.tier, ls.created_at
    )
    select list_id, tier, level, array_agg(id order by id) as ids from need group by list_id, tier, level
  loop
    v_ids := r.ids;
    i := 1;
    while i <= array_length(v_ids, 1) loop
      insert into public.jobs (type, mode, payload) values ('example', coalesce(p_mode, 'batch'), jsonb_build_object(
        'lexeme_ids', to_jsonb(v_ids[i:least(i + 5, array_length(v_ids, 1))]),
        'list_id', r.list_id,
        'tier', r.tier,
        'level', r.level
      ));
      v_n := v_n + 1;
      i := i + 6;
    end loop;
  end loop;
  return v_n;
end;
$$;

revoke execute on function private.user_tier(uuid), private.user_level(uuid), private.queue_examples(text) from public;

-- ── import d'une liste : niveau de l'élève pour une liste personnelle, phrases de l'autre palier
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
    v_level := private.user_level(auth.uid());
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
  -- mots déjà prêts dont la phrase d'exemple n'est pas du palier de cette liste : phrase de l'autre palier
  perform private.queue_examples(v_mode);
  return v_list;
end;
$$;


-- ── réveil du worker : repère d'abord les phrases manquantes (changement de niveau, liste personnelle…)
create or replace function public.kick_worker()
returns void
language plpgsql security definer set search_path = public, private, extensions as $$
declare v_secret text;
begin
  update public.jobs set status = 'pending', updated_at = now()
  where status = 'running' and updated_at < now() - interval '6 minutes' and attempts < 4;
  update public.jobs set status = 'error', last_error = coalesce(last_error, 'timeout'), updated_at = now()
  where status = 'running' and updated_at < now() - interval '6 minutes' and attempts >= 4;

  perform private.queue_examples('batch');

  if not exists (select 1 from public.jobs where status = 'pending' and run_after <= now())
     and not exists (select 1 from public.jobs where status = 'batched')
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
