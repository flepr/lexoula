-- Λεξούλα — mots à réviser : ceux des classes dont on est membre
-- © 2026 Φοίβος Λεπέρ (Fabien Lepère). Tous droits réservés.
--
-- Demande de Fabien du 01/11/2026 : un professeur ou l'admin membre de certaines classes ne révise que les mots de
-- ces classes (et ses listes personnelles), pas ceux de toutes les classes qu'il enseigne. Sans aucune classe, il
-- garde les mots des classes qu'il enseigne. Même règle que les textes à lire (readableTexts, src/store.js).
-- La date d'ajout d'un mot (et donc « dernier cours » sur l'accueil) ne tient compte que de ces listes.
create or replace function public.my_words()
returns table (id uuid, status text, data jsonb, added date, input text, personal boolean)
language sql stable security definer set search_path = public as $$
  with member as (
    select group_id from public.group_members where user_id = auth.uid()
  ), sources as (
    select group_id from member
    union
    select g.id from public.groups g where g.teacher_id = auth.uid() and not exists (select 1 from member)
  )
  select l.id, l.status, l.data, min(li_l.lesson_date) as added, l.input,
         bool_and(li_l.owner_id is not null) as personal
  from public.lexemes l
  join (
    select li.lexeme_id, ls.lesson_date, ls.owner_id
    from public.list_items li
    join public.lists ls on ls.id = li.list_id
    where ls.owner_id = auth.uid()
       or ls.group_id in (select group_id from sources)
  ) li_l on li_l.lexeme_id = l.id
  group by l.id;
$$;
