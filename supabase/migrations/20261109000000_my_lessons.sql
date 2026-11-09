-- Λεξούλα — leçons de l'élève, avec leurs mots (09/11/2026)
-- Pour « Choisir les leçons… » sur l'accueil : les leçons dont l'élève voit les mots (mêmes sources que
-- my_words() : classes dont il est membre, ou classes qu'il enseigne s'il n'est membre d'aucune, et ses listes
-- personnelles), avec le nom de la classe, son professeur et les identifiants des mots de chaque leçon.
-- Sert aussi à « Dernière leçon » : tous les mots du dernier cours, y compris ceux déjà vus dans un cours précédent.
-- Nouvelle fonction en lecture seule : my_words() et my_lists() ne changent pas.

create or replace function public.my_lessons()
returns table (id uuid, group_id uuid, group_name text, group_level text, teacher_name text,
               title text, lesson_date date, created_at timestamptz, personal boolean, lexeme_ids uuid[])
language sql stable security definer set search_path = public as $$
  with member as (
    select gm.group_id from public.group_members gm where gm.user_id = auth.uid()
  ), sources as (
    select m.group_id from member m
    union
    select g.id from public.groups g where g.teacher_id = auth.uid() and not exists (select 1 from member)
  )
  select ls.id, ls.group_id, g.name, g.level, p.display_name,
         ls.title, ls.lesson_date, ls.created_at, ls.owner_id is not null,
         coalesce(array_agg(li.lexeme_id) filter (where li.lexeme_id is not null), '{}')
  from public.lists ls
  left join public.groups g on g.id = ls.group_id
  left join public.profiles p on p.id = g.teacher_id
  left join public.list_items li on li.list_id = ls.id
  where ls.owner_id = auth.uid()
     or ls.group_id in (select s.group_id from sources s)
  group by ls.id, g.name, g.level, p.display_name
  order by ls.lesson_date desc, ls.created_at desc;
$$;

revoke execute on function public.my_lessons() from public, anon;
grant execute on function public.my_lessons() to authenticated, service_role;
