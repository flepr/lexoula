-- L'administrateur se connecte désormais avec son compte Microsoft (fabien@lepe.re),
-- l'ancien compte (fabien.lepere@me.com) est appelé à être supprimé.
-- 1. Les nouveaux comptes créés avec cette adresse deviennent admin automatiquement.
-- 2. Si le compte Microsoft existe déjà, il devient admin.
-- 3. Les classes dont l'ancien compte était le professeur passent au nouveau compte,
--    pour qu'elles ne se retrouvent pas sans professeur à la suppression de l'ancien
--    (groups.teacher_id est en « on delete set null »). Idem pour l'auteur des listes.

update public.app_config
   set value = '["fabien@lepe.re"]'::jsonb
 where key = 'admin_emails';

do $$
declare
  v_old uuid;
  v_new uuid;
  v_groups int := 0;
begin
  select id into v_old from public.profiles where lower(email) = 'fabien.lepere@me.com' limit 1;
  select id into v_new from public.profiles where lower(email) = 'fabien@lepe.re' limit 1;

  if v_new is null then
    raise notice 'admin_microsoft: new account not created yet; it will become admin at first sign-in';
    return;
  end if;

  update public.profiles set role = 'admin' where id = v_new;

  if v_old is not null and v_old <> v_new then
    update public.groups set teacher_id = v_new where teacher_id = v_old;
    get diagnostics v_groups = row_count;
    update public.lists set created_by = v_new where created_by = v_old;
  end if;

  raise notice 'admin_microsoft: new account is admin; % class(es) transferred', v_groups;
end;
$$;
