-- Pause des textes automatiques (11/11/2026)
-- Deux interrupteurs :
--   * par classe : groups.texts_enabled (existait, mais n'arrêtait que les textes du jeudi et du dimanche) ;
--   * général, réservé à l'admin : app_config « texts_paused », qui arrête les textes automatiques de toutes les classes.
-- Les textes automatiques sont ceux du jeudi et du dimanche (reason = 'schedule') et le texte court écrit après
-- chaque nouvelle liste (reason = 'new_list'). Les textes demandés à la main (« Générer », reason = 'manual')
-- restent toujours possibles.

insert into public.app_config (key, value) values ('texts_paused', 'false'::jsonb)
on conflict (key) do nothing;

-- pause générale décidée par l'admin ?
create or replace function public.texts_paused()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select value = 'true'::jsonb from public.app_config where key = 'texts_paused'), false);
$$;
grant execute on function public.texts_paused() to authenticated, service_role;

-- une classe reçoit-elle des textes automatiques ?
create or replace function public.auto_texts_on(p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not public.texts_paused()
     and exists (select 1 from public.groups g where g.id = p_group and g.texts_enabled and not g.archived);
$$;
grant execute on function public.auto_texts_on(uuid) to authenticated, service_role;

-- l'admin met en pause (ou relance) les textes automatiques de toutes les classes
create or replace function public.admin_set_texts_paused(p_paused boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  insert into public.app_config (key, value) values ('texts_paused', to_jsonb(coalesce(p_paused, false)))
  on conflict (key) do update set value = excluded.value;
end;
$$;
grant execute on function public.admin_set_texts_paused(boolean) to authenticated;

-- garde-fou unique : une tâche de texte automatique n'est pas créée pour une classe en pause,
-- quel que soit l'endroit qui la crée (submit_list, schedule_texts, worker après une liste)
create or replace function private.skip_paused_texts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.type = 'text'
     and coalesce(new.payload ->> 'reason', '') in ('schedule', 'new_list')
     and not public.auto_texts_on((new.payload ->> 'group_id')::uuid) then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists jobs_skip_paused_texts on public.jobs;
create trigger jobs_skip_paused_texts before insert on public.jobs
  for each row execute function private.skip_paused_texts();
