-- Administration : supprimer le compte d'un autre utilisateur depuis l'appli.
-- Suppression définitive : profil, progression, activité, listes personnelles et appartenance aux classes
-- partent en cascade avec auth.users. Les classes dont il était le professeur passent à l'administrateur
-- qui supprime (sinon elles resteraient sans professeur). On ne peut pas se supprimer soi-même ici
-- (l'utilisateur dispose de « Supprimer mon compte » dans ses réglages).

create or replace function public.admin_delete_user(p_user uuid)
returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_user is null or p_user = auth.uid() then raise exception 'cannot_delete_self'; end if;
  update public.groups set teacher_id = auth.uid() where teacher_id = p_user;
  update public.lists set created_by = auth.uid() where created_by = p_user and group_id is not null;
  delete from auth.users where id = p_user;
end;
$$;

revoke execute on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_delete_user(uuid) to authenticated;
