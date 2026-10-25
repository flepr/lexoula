-- Classe de démonstration figée pour les proches de Fabien (demande du 26/10/2026).
-- Copie de la classe Ομαδικό Β2 à cette date : mêmes listes (mêmes mots du dictionnaire partagé,
-- donc rien à réenrichir) et copie des textes déjà prêts. Textes automatiques désactivés : la classe
-- ne déclenche aucun appel à l'IA. La classe Β2 d'origine n'est pas modifiée.
-- Idempotent : ne fait rien si la classe de démonstration existe déjà.

do $$
declare
  v_src uuid;
  v_n int;
  v_new uuid;
  v_lists int := 0;
  v_items int := 0;
  v_texts int := 0;
  r record;
  v_list uuid;
begin
  if exists (select 1 from public.groups where name = 'Δοκιμαστική τάξη') then
    raise notice 'test_class: already exists';
    return;
  end if;

  select count(*) into v_n from public.groups
   where not archived and level = 'B2' and name ilike 'Ομαδικό%';
  if v_n <> 1 then
    raise notice 'test_class: expected one B2 group, found %', v_n;
    return;
  end if;
  select id into v_src from public.groups
   where not archived and level = 'B2' and name ilike 'Ομαδικό%';

  insert into public.groups (name, level, kind, teacher_id, texts_enabled)
  select 'Δοκιμαστική τάξη', g.level, g.kind, g.teacher_id, false
    from public.groups g where g.id = v_src
  returning id into v_new;

  for r in select * from public.lists where group_id = v_src order by lesson_date, created_at loop
    insert into public.lists (group_id, title, lesson_date, created_by, created_at)
    values (v_new, r.title, r.lesson_date, r.created_by, r.created_at)
    returning id into v_list;
    insert into public.list_items (list_id, lexeme_id, position)
    select v_list, li.lexeme_id, li.position from public.list_items li where li.list_id = r.id;
    get diagnostics v_n = row_count;
    v_items := v_items + v_n;
    v_lists := v_lists + 1;
  end loop;

  insert into public.texts (group_id, kind, title, title_tr, paragraphs, word_ids, status, created_at)
  select v_new, t.kind, t.title, t.title_tr, t.paragraphs, t.word_ids, t.status, t.created_at
    from public.texts t where t.group_id = v_src and t.status = 'ready';
  get diagnostics v_texts = row_count;

  raise notice 'test_class: created % (% lists, % words, % texts)', v_new, v_lists, v_items, v_texts;
end $$;
