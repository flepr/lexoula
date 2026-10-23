-- Professeurs et administrateur : renommer un élève et choisir ses classes.
-- Un professeur n'agit que sur les élèves de ses classes, et seulement sur ses propres classes.

-- l'élève appartient-il à une classe de l'appelant (ou l'appelant est-il administrateur) ?
create or replace function public.can_manage_student(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.group_members m join public.groups g on g.id = m.group_id
     where m.user_id = p_user and g.teacher_id = auth.uid()
  );
$$;

-- élèves que l'appelant peut gérer, avec leurs classes (limitées aux classes de l'appelant pour un professeur)
create or replace function public.staff_list_students()
returns table (id uuid, email text, display_name text, group_ids uuid[])
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  return query
  select p.id, p.email, p.display_name,
         coalesce((select array_agg(m.group_id) from public.group_members m join public.groups g on g.id = m.group_id
                    where m.user_id = p.id and (public.is_admin() or g.teacher_id = auth.uid())), '{}')
    from public.profiles p
   where public.can_manage_student(p.id)
   order by p.display_name;
end;
$$;

create or replace function public.set_student_name(p_user uuid, p_name text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() or not public.can_manage_student(p_user) then raise exception 'forbidden'; end if;
  update public.profiles set display_name = nullif(left(trim(p_name), 60), '') where id = p_user;
end;
$$;

-- remplace les classes de l'élève par la liste donnée, dans le périmètre de l'appelant
create or replace function public.set_student_groups(p_user uuid, p_groups uuid[])
returns void
language plpgsql security definer set search_path = public as $$
declare v_admin boolean := public.is_admin();
begin
  if not public.is_staff() or not public.can_manage_student(p_user) then raise exception 'forbidden'; end if;
  delete from public.group_members m
   using public.groups g
   where g.id = m.group_id and m.user_id = p_user
     and (v_admin or g.teacher_id = auth.uid())
     and not (m.group_id = any (coalesce(p_groups, '{}')));
  insert into public.group_members (group_id, user_id)
  select g.id, p_user from public.groups g
   where g.id = any (coalesce(p_groups, '{}')) and (v_admin or g.teacher_id = auth.uid())
  on conflict do nothing;
end;
$$;

-- les versions réservées à l'administrateur sont remplacées par celles-ci
drop function if exists public.admin_set_name(uuid, text);
drop function if exists public.admin_set_groups(uuid, uuid[]);

revoke execute on function public.can_manage_student(uuid), public.staff_list_students(),
  public.set_student_name(uuid, text), public.set_student_groups(uuid, uuid[]) from public, anon;
grant execute on function public.staff_list_students(), public.set_student_name(uuid, text), public.set_student_groups(uuid, uuid[])
  to authenticated;
revoke execute on function public.can_manage_student(uuid) from authenticated;
