-- Administration : renommer un élève et choisir ses classes

-- la liste des comptes renvoie aussi les identifiants des classes
drop function if exists public.admin_list_users();
create function public.admin_list_users()
returns table (id uuid, email text, display_name text, role public.app_role, created_at timestamptz, groups text, group_ids uuid[])
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return query
  select p.id, p.email, p.display_name, p.role, p.created_at,
         (select string_agg(g.name, ', ' order by g.name) from public.group_members m join public.groups g on g.id = m.group_id where m.user_id = p.id),
         coalesce((select array_agg(m.group_id) from public.group_members m where m.user_id = p.id), '{}')
  from public.profiles p order by p.created_at desc;
end;
$$;

create or replace function public.admin_set_name(p_user uuid, p_name text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  update public.profiles set display_name = nullif(left(trim(p_name), 60), '') where id = p_user;
end;
$$;

-- remplace l'ensemble des classes d'un compte par la liste donnée
create or replace function public.admin_set_groups(p_user uuid, p_groups uuid[])
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  delete from public.group_members
   where user_id = p_user and not (group_id = any (coalesce(p_groups, '{}')));
  insert into public.group_members (group_id, user_id)
  select g.id, p_user from public.groups g where g.id = any (coalesce(p_groups, '{}'))
  on conflict do nothing;
end;
$$;

revoke execute on function public.admin_list_users(), public.admin_set_name(uuid, text), public.admin_set_groups(uuid, uuid[]),
  public.name_from_email(text) from public, anon;
grant execute on function public.admin_list_users(), public.admin_set_name(uuid, text), public.admin_set_groups(uuid, uuid[])
  to authenticated;
revoke execute on function public.name_from_email(text) from authenticated;
