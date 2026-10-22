-- Λεξούλα (Lexoula) — schéma initial
-- © 2026 Φοίβος Λεπέρ (Fabien Lepère). Tous droits réservés.
--
-- Principes :
--  * chaque élève ne voit que ses propres données (RLS) ;
--  * le professeur voit la progression de ses élèves seulement s'ils la partagent ;
--  * le dictionnaire (lexemes) est partagé entre tous les groupes : un mot traité une fois est réutilisé ;
--  * le travail d'IA passe par une file (jobs) traitée par la fonction « worker », réveillée par pg_cron.

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
create extension if not exists pg_net with schema extensions;

-- ─────────────────────────────────────────── types et configuration
do $$ begin
  create type public.app_role as enum ('student', 'teacher', 'admin');
exception when duplicate_object then null; end $$;

create table if not exists public.app_config (
  key text primary key,
  value jsonb not null
);
insert into public.app_config (key, value)
values ('admin_emails', '["fabien.lepere@me.com"]'::jsonb)
on conflict (key) do nothing;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.secrets (
  name text primary key,
  value text not null
);
insert into private.secrets (name, value)
values ('cron_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (name) do nothing;

-- ─────────────────────────────────────────── profils
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  native_lang text not null default 'en'
    check (native_lang in ('en', 'fr', 'de', 'es', 'it', 'ru', 'pl', 'tr')),
  role public.app_role not null default 'student',
  share_progress boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  onboarded boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admins jsonb;
  v_name text;
begin
  select value into v_admins from public.app_config where key = 'admin_emails';
  v_name := coalesce(
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name',
    split_part(coalesce(new.email, ''), '@', 1)
  );
  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    lower(new.email),
    nullif(v_name, ''),
    case when v_admins ? lower(coalesce(new.email, '')) then 'admin'::public.app_role
         else 'student'::public.app_role end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────── groupes
create or replace function public.gen_invite_code()
returns text
language sql
volatile
as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, 8);
$$;

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  level text check (level in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  kind text not null default 'group' check (kind in ('group', 'individual')),
  teacher_id uuid references public.profiles (id) on delete set null,
  invite_code text not null unique default public.gen_invite_code(),
  archived boolean not null default false,
  texts_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists group_members_user_idx on public.group_members (user_id);

-- ─────────────────────────────────────────── dictionnaire partagé
create table if not exists public.lexemes (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  input text not null,
  hint text,
  status text not null default 'pending' check (status in ('pending', 'ready', 'error')),
  data jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lists (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.groups (id) on delete cascade,
  owner_id uuid references public.profiles (id) on delete cascade,
  title text not null,
  lesson_date date not null default current_date,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((group_id is not null) <> (owner_id is not null))
);
create index if not exists lists_group_idx on public.lists (group_id);
create index if not exists lists_owner_idx on public.lists (owner_id);

create table if not exists public.list_items (
  list_id uuid not null references public.lists (id) on delete cascade,
  lexeme_id uuid not null references public.lexemes (id) on delete cascade,
  position int not null default 0,
  primary key (list_id, lexeme_id)
);
create index if not exists list_items_lexeme_idx on public.list_items (lexeme_id);

-- ─────────────────────────────────────────── textes
create table if not exists public.texts (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  kind text not null check (kind in ('short', 'long')),
  title text not null,
  title_tr jsonb not null default '{}'::jsonb,
  paragraphs jsonb not null,
  word_ids uuid[] not null default '{}',
  status text not null default 'translating' check (status in ('translating', 'ready', 'error')),
  created_at timestamptz not null default now()
);
create index if not exists texts_group_idx on public.texts (group_id, created_at desc);

-- ─────────────────────────────────────────── progression
create table if not exists public.progress (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  lexeme_id uuid not null references public.lexemes (id) on delete cascade,
  box smallint not null default 0 check (box between 0 and 6),
  due date not null default current_date,
  seen int not null default 0,
  ok int not null default 0,
  ko int not null default 0,
  last date,
  known boolean not null default false,
  star boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, lexeme_id)
);

create table if not exists public.activity (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  day date not null,
  n int not null default 0,
  ok int not null default 0,
  primary key (user_id, day)
);

-- ─────────────────────────────────────────── file de travail IA
create table if not exists public.jobs (
  id bigserial primary key,
  type text not null check (type in ('enrich', 'text', 'translate')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'error')),
  attempts int not null default 0,
  last_error text,
  run_after timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists jobs_pending_idx on public.jobs (status, run_after);

-- ─────────────────────────────────────────── fonctions d'aide à la sécurité
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('teacher', 'admin'));
$$;

create or replace function public.is_teacher_of(p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.groups g where g.id = p_group and g.teacher_id = auth.uid())
      or public.is_admin();
$$;

create or replace function public.is_member(p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members m where m.group_id = p_group and m.user_id = auth.uid());
$$;

-- le professeur peut-il voir la progression de cet élève ?
create or replace function public.can_see_progress_of(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_user = auth.uid()
      or exists (
        select 1
        from public.profiles p
        join public.group_members m on m.user_id = p.id
        join public.groups g on g.id = m.group_id
        where p.id = p_user and p.share_progress
          and (g.teacher_id = auth.uid() or public.is_admin())
      );
$$;

-- ─────────────────────────────────────────── RLS
alter table public.app_config enable row level security;
alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.lexemes enable row level security;
alter table public.lists enable row level security;
alter table public.list_items enable row level security;
alter table public.texts enable row level security;
alter table public.progress enable row level security;
alter table public.activity enable row level security;
alter table public.jobs enable row level security;

-- profils
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (
  id = auth.uid()
  or public.is_admin()
  or exists (
    select 1 from public.group_members m join public.groups g on g.id = m.group_id
    where m.user_id = profiles.id and g.teacher_id = auth.uid()
  )
);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- groupes
drop policy if exists groups_select on public.groups;
create policy groups_select on public.groups for select to authenticated using (
  public.is_member(id) or teacher_id = auth.uid() or public.is_admin()
);
drop policy if exists groups_update on public.groups;
create policy groups_update on public.groups for update to authenticated
  using (teacher_id = auth.uid() or public.is_admin())
  with check (teacher_id = auth.uid() or public.is_admin());
drop policy if exists groups_delete on public.groups;
create policy groups_delete on public.groups for delete to authenticated
  using (teacher_id = auth.uid() or public.is_admin());

drop policy if exists members_select on public.group_members;
create policy members_select on public.group_members for select to authenticated using (
  user_id = auth.uid() or public.is_teacher_of(group_id)
);
drop policy if exists members_delete on public.group_members;
create policy members_delete on public.group_members for delete to authenticated using (
  user_id = auth.uid() or public.is_teacher_of(group_id)
);

-- dictionnaire : lisible par tout utilisateur connecté (aucune donnée personnelle)
drop policy if exists lexemes_select on public.lexemes;
create policy lexemes_select on public.lexemes for select to authenticated using (true);

drop policy if exists lists_select on public.lists;
create policy lists_select on public.lists for select to authenticated using (
  owner_id = auth.uid()
  or (group_id is not null and (public.is_member(group_id) or public.is_teacher_of(group_id)))
);
drop policy if exists lists_delete on public.lists;
create policy lists_delete on public.lists for delete to authenticated using (
  owner_id = auth.uid() or (group_id is not null and public.is_teacher_of(group_id))
);

drop policy if exists list_items_select on public.list_items;
create policy list_items_select on public.list_items for select to authenticated using (
  exists (select 1 from public.lists l where l.id = list_items.list_id and (
    l.owner_id = auth.uid()
    or (l.group_id is not null and (public.is_member(l.group_id) or public.is_teacher_of(l.group_id)))
  ))
);

drop policy if exists texts_select on public.texts;
create policy texts_select on public.texts for select to authenticated using (
  public.is_member(group_id) or public.is_teacher_of(group_id)
);
drop policy if exists texts_delete on public.texts;
create policy texts_delete on public.texts for delete to authenticated using (
  public.is_teacher_of(group_id)
);

drop policy if exists progress_select on public.progress;
create policy progress_select on public.progress for select to authenticated using (
  public.can_see_progress_of(user_id)
);
drop policy if exists progress_insert on public.progress;
create policy progress_insert on public.progress for insert to authenticated with check (user_id = auth.uid());
drop policy if exists progress_update on public.progress;
create policy progress_update on public.progress for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists progress_delete on public.progress;
create policy progress_delete on public.progress for delete to authenticated using (user_id = auth.uid());

drop policy if exists activity_select on public.activity;
create policy activity_select on public.activity for select to authenticated using (
  public.can_see_progress_of(user_id)
);
drop policy if exists activity_insert on public.activity;
create policy activity_insert on public.activity for insert to authenticated with check (user_id = auth.uid());
drop policy if exists activity_update on public.activity;
create policy activity_update on public.activity for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ─────────────────────────────────────────── droits (« expose new tables » est désactivé)
revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated, service_role;

grant select on public.profiles, public.groups, public.group_members, public.lexemes,
  public.lists, public.list_items, public.texts, public.progress, public.activity to authenticated;
grant update (display_name, native_lang, share_progress, settings, onboarded) on public.profiles to authenticated;
grant update (name, level, archived, texts_enabled) on public.groups to authenticated;
grant delete on public.groups, public.group_members, public.lists, public.texts to authenticated;
grant insert, update, delete on public.progress to authenticated;
grant insert, update on public.activity to authenticated;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- ─────────────────────────────────────────── fonctions appelées par l'appli
create or replace function public.normalize_key(p text)
returns text language sql immutable as $$
  -- minuscules + espaces normalisés + sigma final (ς) en fin de mot
  select regexp_replace(
           lower(regexp_replace(trim(normalize(coalesce(p, ''), NFC)), '\s+', ' ', 'g')),
           'σ(?=$|[\s,.;:!?·)/\-])', 'ς', 'g');
$$;

-- rejoindre un groupe avec un code d'invitation
create or replace function public.join_group(p_code text)
returns table (id uuid, name text)
language plpgsql security definer set search_path = public as $$
declare v_group public.groups;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into v_group from public.groups g
  where g.invite_code = upper(trim(p_code)) and not g.archived;
  if v_group.id is null then raise exception 'invalid_code'; end if;
  insert into public.group_members (group_id, user_id) values (v_group.id, auth.uid())
  on conflict do nothing;
  return query select v_group.id, v_group.name;
end;
$$;

-- aperçu d'un groupe à partir de son code (avant connexion complète)
create or replace function public.peek_group(p_code text)
returns table (name text, level text, teacher text)
language sql stable security definer set search_path = public as $$
  select g.name, g.level, p.display_name
  from public.groups g left join public.profiles p on p.id = g.teacher_id
  where g.invite_code = upper(trim(p_code)) and not g.archived;
$$;

create or replace function public.create_group(p_name text, p_level text, p_kind text default 'group')
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  insert into public.groups (name, level, kind, teacher_id)
  values (trim(p_name), nullif(p_level, ''), coalesce(nullif(p_kind, ''), 'group'), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.regenerate_invite(p_group uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if not public.is_teacher_of(p_group) then raise exception 'forbidden'; end if;
  update public.groups set invite_code = public.gen_invite_code() where id = p_group
  returning invite_code into v_code;
  return v_code;
end;
$$;

-- déposer une liste de mots : p_items = [{"input": "...", "hint": "..."}]
-- p_group null = liste personnelle de l'utilisateur
create or replace function public.submit_list(p_group uuid, p_title text, p_date date, p_items jsonb)
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
  i int;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'empty_list'; end if;
  if jsonb_array_length(p_items) > 200 then raise exception 'too_many_words'; end if;

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
      where j.type = 'enrich' and j.status in ('pending', 'running')
        and j.payload -> 'lexeme_ids' ? l.id::text
    );
  if v_pending is not null then
    i := 1;
    while i <= array_length(v_pending, 1) loop
      insert into public.jobs (type, payload) values ('enrich', jsonb_build_object(
        'lexeme_ids', to_jsonb(v_pending[i:least(i + 3, array_length(v_pending, 1))]),
        'list_id', v_list,
        'level', coalesce(v_level, 'B1')
      ));
      i := i + 4;
    end loop;
  else
    -- tous les mots existaient déjà : on peut directement proposer un texte
    if p_group is not null then
      insert into public.jobs (type, payload)
      values ('text', jsonb_build_object('group_id', p_group, 'kind', 'short', 'reason', 'new_list'));
    end if;
  end if;
  return v_list;
end;
$$;

-- vocabulaire de l'utilisateur : mots des listes de ses groupes + ses listes personnelles
create or replace function public.my_words()
returns table (id uuid, status text, data jsonb, added date, input text, personal boolean)
language sql stable security definer set search_path = public as $$
  select l.id, l.status, l.data, min(li_l.lesson_date) as added, l.input,
         bool_and(li_l.owner_id is not null) as personal
  from public.lexemes l
  join (
    select li.lexeme_id, ls.lesson_date, ls.owner_id
    from public.list_items li
    join public.lists ls on ls.id = li.list_id
    where ls.owner_id = auth.uid()
       or ls.group_id in (select group_id from public.group_members where user_id = auth.uid())
       or ls.group_id in (select g.id from public.groups g where g.teacher_id = auth.uid())
  ) li_l on li_l.lexeme_id = l.id
  group by l.id;
$$;

-- listes visibles avec leur état de traitement
create or replace function public.my_lists()
returns table (id uuid, group_id uuid, owner_id uuid, title text, lesson_date date, created_at timestamptz,
               total int, ready int, failed int)
language sql stable security definer set search_path = public as $$
  select ls.id, ls.group_id, ls.owner_id, ls.title, ls.lesson_date, ls.created_at,
         count(li.lexeme_id)::int,
         count(*) filter (where lx.status = 'ready')::int,
         count(*) filter (where lx.status = 'error')::int
  from public.lists ls
  left join public.list_items li on li.list_id = ls.id
  left join public.lexemes lx on lx.id = li.lexeme_id
  where ls.owner_id = auth.uid()
     or ls.group_id in (select group_id from public.group_members where user_id = auth.uid())
     or ls.group_id in (select g.id from public.groups g where g.teacher_id = auth.uid())
     or (ls.group_id is not null and public.is_admin())
  group by ls.id
  order by ls.lesson_date desc, ls.created_at desc;
$$;

-- vue d'ensemble d'un groupe pour le professeur (respecte le choix de partage de chaque élève)
create or replace function public.group_overview(p_group uuid)
returns table (user_id uuid, display_name text, email text, shares boolean, joined_at timestamptz,
               words_seen int, words_acquired int, starred int, last_active date, answers_30d int, success_30d int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_teacher_of(p_group) then raise exception 'forbidden'; end if;
  return query
  select p.id, p.display_name, p.email, p.share_progress, m.joined_at,
    case when p.share_progress then (select count(*)::int from public.progress pr where pr.user_id = p.id and pr.seen > 0) end,
    case when p.share_progress then (select count(*)::int from public.progress pr where pr.user_id = p.id and (pr.known or pr.box >= 5)) end,
    case when p.share_progress then (select count(*)::int from public.progress pr where pr.user_id = p.id and pr.star) end,
    case when p.share_progress then (select max(a.day) from public.activity a where a.user_id = p.id) end,
    case when p.share_progress then (select coalesce(sum(a.n), 0)::int from public.activity a where a.user_id = p.id and a.day > current_date - 30) end,
    case when p.share_progress then (select coalesce(sum(a.ok), 0)::int from public.activity a where a.user_id = p.id and a.day > current_date - 30) end
  from public.group_members m join public.profiles p on p.id = m.user_id
  where m.group_id = p_group
  order by p.display_name;
end;
$$;

-- mots les plus difficiles du groupe (élèves qui partagent leur progression)
create or replace function public.group_hard_words(p_group uuid, p_limit int default 15)
returns table (lexeme_id uuid, data jsonb, students int, stars int, errors int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_teacher_of(p_group) then raise exception 'forbidden'; end if;
  return query
  select pr.lexeme_id, lx.data, count(distinct pr.user_id)::int,
         count(*) filter (where pr.star)::int, coalesce(sum(pr.ko), 0)::int
  from public.progress pr
  join public.profiles p on p.id = pr.user_id and p.share_progress
  join public.group_members m on m.user_id = p.id and m.group_id = p_group
  join public.lexemes lx on lx.id = pr.lexeme_id
  where pr.star or pr.ko > 0
  group by pr.lexeme_id, lx.data
  order by count(*) filter (where pr.star) desc, sum(pr.ko) desc
  limit p_limit;
end;
$$;

create or replace function public.request_text(p_group uuid, p_kind text default 'short')
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_teacher_of(p_group) then raise exception 'forbidden'; end if;
  if exists (select 1 from public.jobs where type in ('text', 'translate') and status in ('pending', 'running')
             and payload ->> 'group_id' = p_group::text) then
    raise exception 'already_running';
  end if;
  insert into public.jobs (type, payload)
  values ('text', jsonb_build_object('group_id', p_group, 'kind', case when p_kind = 'long' then 'long' else 'short' end,
                                     'reason', 'manual'));
end;
$$;

-- relancer les mots en erreur d'une liste
create or replace function public.retry_list(p_list uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare v_ids uuid[]; v_level text; i int; v_group uuid; v_owner uuid;
begin
  select group_id, owner_id into v_group, v_owner from public.lists where id = p_list;
  if not (v_owner = auth.uid() or (v_group is not null and public.is_teacher_of(v_group))) then
    raise exception 'forbidden';
  end if;
  select level into v_level from public.groups where id = v_group;
  update public.lexemes l set status = 'pending', error = null, updated_at = now()
  from public.list_items li where li.list_id = p_list and li.lexeme_id = l.id and l.status = 'error';
  select array_agg(l.id) into v_ids from public.list_items li join public.lexemes l on l.id = li.lexeme_id
  where li.list_id = p_list and l.status = 'pending';
  if v_ids is null then return 0; end if;
  i := 1;
  while i <= array_length(v_ids, 1) loop
    insert into public.jobs (type, payload) values ('enrich', jsonb_build_object(
      'lexeme_ids', to_jsonb(v_ids[i:least(i + 3, array_length(v_ids, 1))]), 'list_id', p_list, 'level', coalesce(v_level, 'B1')));
    i := i + 4;
  end loop;
  return array_length(v_ids, 1);
end;
$$;

-- administration
create or replace function public.admin_list_users()
returns table (id uuid, email text, display_name text, role public.app_role, created_at timestamptz, groups text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return query
  select p.id, p.email, p.display_name, p.role, p.created_at,
         (select string_agg(g.name, ', ') from public.group_members m join public.groups g on g.id = m.group_id where m.user_id = p.id)
  from public.profiles p order by p.created_at desc;
end;
$$;

create or replace function public.admin_set_role(p_user uuid, p_role public.app_role)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_user = auth.uid() and p_role <> 'admin' then raise exception 'cannot_demote_self'; end if;
  update public.profiles set role = p_role where id = p_user;
end;
$$;

create or replace function public.admin_set_teacher(p_group uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  update public.groups set teacher_id = p_user where id = p_group;
end;
$$;

-- suppression de compte (RGPD)
create or replace function public.delete_my_account()
returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  delete from auth.users where id = auth.uid();
end;
$$;

-- ─────────────────────────────────────────── fonctions réservées au worker (service_role)
create or replace function public.worker_secret_ok(p_secret text)
returns boolean language sql stable security definer set search_path = public, private as $$
  select exists (select 1 from private.secrets where name = 'cron_secret' and value = p_secret);
$$;

create or replace function public.claim_jobs(p_limit int)
returns setof public.jobs
language sql security definer set search_path = public as $$
  update public.jobs j
  set status = 'running', attempts = j.attempts + 1, updated_at = now()
  where j.id in (
    select id from public.jobs
    where status = 'pending' and run_after <= now()
    order by case type when 'enrich' then 0 when 'translate' then 1 else 2 end, id
    limit p_limit
    for update skip locked
  )
  returning j.*;
$$;

-- réveille le worker s'il y a du travail (appelé chaque minute par pg_cron)
create or replace function public.kick_worker()
returns void
language plpgsql security definer set search_path = public, private, extensions as $$
declare v_secret text;
begin
  update public.jobs set status = 'pending', updated_at = now()
  where status = 'running' and updated_at < now() - interval '6 minutes' and attempts < 4;
  update public.jobs set status = 'error', last_error = coalesce(last_error, 'timeout'), updated_at = now()
  where status = 'running' and updated_at < now() - interval '6 minutes' and attempts >= 4;

  if not exists (select 1 from public.jobs where status = 'pending' and run_after <= now()) then return; end if;
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

-- programme des textes : pour chaque groupe actif ayant assez de mots
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
    if not exists (select 1 from public.jobs where type in ('text', 'translate') and status in ('pending', 'running')
                   and payload ->> 'group_id' = r.id::text) then
      insert into public.jobs (type, payload)
      values ('text', jsonb_build_object('group_id', r.id, 'kind', p_kind, 'reason', 'schedule'));
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- droits d'exécution
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.is_admin(), public.is_staff(), public.is_teacher_of(uuid), public.is_member(uuid),
  public.can_see_progress_of(uuid), public.normalize_key(text),
  public.join_group(text), public.peek_group(text), public.create_group(text, text, text),
  public.regenerate_invite(uuid), public.submit_list(uuid, text, date, jsonb),
  public.my_words(), public.my_lists(), public.group_overview(uuid), public.group_hard_words(uuid, int),
  public.request_text(uuid, text), public.retry_list(uuid),
  public.admin_list_users(), public.admin_set_role(uuid, public.app_role), public.admin_set_teacher(uuid, uuid),
  public.delete_my_account()
to authenticated;
grant execute on all functions in schema public to service_role;
grant execute on function public.peek_group(text) to anon;
revoke execute on function public.worker_secret_ok(text), public.claim_jobs(int), public.kick_worker(),
  public.schedule_texts(text), public.handle_new_user() from authenticated;

-- ─────────────────────────────────────────── tâches planifiées
do $$ begin perform cron.unschedule('lexoula-worker'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('lexoula-texts-short'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('lexoula-texts-long'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('lexoula-cleanup'); exception when others then null; end $$;

select cron.schedule('lexoula-worker', '* * * * *', $$ select public.kick_worker(); $$);
-- jeudi : texte court ; dimanche : texte long (05:30 UTC = 6 h 30 ou 7 h 30 à Paris)
select cron.schedule('lexoula-texts-short', '30 5 * * 4', $$ select public.schedule_texts('short'); $$);
select cron.schedule('lexoula-texts-long', '30 5 * * 0', $$ select public.schedule_texts('long'); $$);
select cron.schedule('lexoula-cleanup', '15 3 * * *', $$
  delete from public.jobs where status = 'done' and updated_at < now() - interval '14 days';
  delete from net._http_response where created < now() - interval '2 days';
$$);
