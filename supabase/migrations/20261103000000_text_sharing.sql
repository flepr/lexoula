-- Λεξούλα — partage des textes par lien (décision du 03/11/2026)
--  * Tout membre d'une classe (et son professeur, et l'admin) peut partager un texte prêt : public.share_text()
--    renvoie un code aléatoire de 10 caractères, toujours le même pour un texte donné.
--  * Le lien app.lexoula.gr/t/?s=<code> s'ouvre sans compte : public.shared_text() (ouverte aux visiteurs) ne renvoie
--    que le texte, ses traductions et le sens des mots soulignés, rien sur la classe ni sur les élèves.
--  * Le professeur ou l'admin peut couper le partage d'une classe (groups.sharing_enabled, activé par défaut) :
--    les liens déjà envoyés cessent alors de fonctionner, et reviennent si le partage est réactivé.

alter table public.groups add column if not exists sharing_enabled boolean not null default true;
grant update (sharing_enabled) on public.groups to authenticated;

create table if not exists public.text_shares (
  token text primary key,
  text_id uuid not null unique references public.texts (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  opened integer not null default 0,      -- ouvertures de la page publique (visiteurs et élèves)
  last_opened_at timestamptz
);
alter table public.text_shares enable row level security;
-- aucune politique : la table n'est lue et écrite que par les deux fonctions ci-dessous (et par le diagnostic)
grant all on public.text_shares to service_role;

-- code d'un texte à partager (créé au premier partage)
create or replace function public.share_text(p_text uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_group uuid;
  v_status text;
  v_on boolean;
  v_token text;
  v_alpha constant text := 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- sans l, o, 0, 1, I, O
  v_bytes bytea;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select t.group_id, t.status, g.sharing_enabled into v_group, v_status, v_on
    from public.texts t join public.groups g on g.id = t.group_id
    where t.id = p_text;
  if v_group is null or not (public.is_member(v_group) or public.is_teacher_of(v_group)) then
    raise exception 'not_found';
  end if;
  if v_status <> 'ready' then raise exception 'not_ready'; end if;
  if not v_on then raise exception 'sharing_disabled'; end if;

  select token into v_token from public.text_shares where text_id = p_text;
  if v_token is not null then return v_token; end if;

  for attempt in 1..5 loop
    v_bytes := gen_random_bytes(10);
    select string_agg(substr(v_alpha, 1 + get_byte(v_bytes, i) % length(v_alpha), 1), '' order by i)
      into v_token from generate_series(0, 9) as i;
    begin
      insert into public.text_shares (token, text_id, created_by) values (v_token, p_text, auth.uid());
      return v_token;
    exception when unique_violation then
      -- partage simultané du même texte : on rend le code déjà créé
      select token into v_token from public.text_shares where text_id = p_text;
      if v_token is not null then return v_token; end if;
    end;
  end loop;
  raise exception 'token_failed';
end;
$$;
revoke all on function public.share_text(uuid) from public, anon;
grant execute on function public.share_text(uuid) to authenticated;

-- page publique : le texte d'un lien, ou {"disabled": true} si la classe a coupé le partage, ou null
create or replace function public.shared_text(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  v_ids uuid[];
begin
  if p_token is null or length(p_token) > 40 then return null; end if;
  select t.id, t.group_id, t.kind, t.title, t.title_tr, t.paragraphs, t.word_ids, t.created_at,
         g.sharing_enabled, g.level
    into s
    from public.text_shares ts
    join public.texts t on t.id = ts.text_id
    join public.groups g on g.id = t.group_id
    where ts.token = p_token and t.status = 'ready';
  if s.id is null then return null; end if;
  if not s.sharing_enabled then return jsonb_build_object('disabled', true); end if;

  update public.text_shares set opened = opened + 1, last_opened_at = now() where token = p_token;

  -- mots soulignés : ceux du texte et ceux balisés [[forme|id]] dans les paragraphes
  select coalesce(array_agg(distinct x), '{}') into v_ids from (
    select unnest(s.word_ids) as x
    union
    select (m[1])::uuid from regexp_matches(s.paragraphs::text, '\|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]\]', 'g') as m
  ) z;

  return jsonb_build_object(
    'id', s.id,
    'kind', s.kind,
    'level', s.level,
    'title', s.title,
    'title_tr', s.title_tr,
    'paragraphs', s.paragraphs,
    'created_at', s.created_at,
    'member', auth.uid() is not null and (public.is_member(s.group_id) or public.is_teacher_of(s.group_id)),
    'words', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'gr', l.data->'gr', 'tr', l.data->'tr', 'note', l.data->'note', 'forms', l.data->'forms',
        'fem', l.data->'fem', 'neu', l.data->'neu', 'ans', l.data->'ans'))
      from public.lexemes l where l.id = any(v_ids) and l.status = 'ready'), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.shared_text(text) from public;
grant execute on function public.shared_text(text) to anon, authenticated;
