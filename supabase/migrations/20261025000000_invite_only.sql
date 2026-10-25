-- Accès réservé aux élèves d'une classe (25/10/2026, décision de Fabien).
-- Un compte qui n'a rejoint aucune classe (et n'est ni professeur ni admin) ne peut plus
-- ajouter de mots personnels, relancer une liste ni lire le dictionnaire partagé :
-- il ne déclenche donc aucun appel à l'IA. L'appli lui affiche seulement l'écran du code de classe.

create or replace function public.has_access()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_staff()
      or exists (select 1 from public.group_members m where m.user_id = auth.uid());
$$;
grant execute on function public.has_access() to authenticated;

drop policy if exists lexemes_select on public.lexemes;
create policy lexemes_select on public.lexemes for select to authenticated using (public.has_access());

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
  if not public.has_access() then raise exception 'no_class'; end if;
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

create or replace function public.retry_list(p_list uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare v_ids uuid[]; v_level text; i int; v_group uuid; v_owner uuid;
begin
  if not public.has_access() then raise exception 'no_class'; end if;
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
