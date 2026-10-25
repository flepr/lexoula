-- Correctif (26/10/2026) : les droits du worker (service_role) sur les tables étaient accordés une seule fois
-- dans la migration initiale ; les tables ai_batches et ai_usage créées ensuite n'y avaient pas accès.
grant all on public.ai_batches, public.ai_usage to service_role;
grant all on all sequences in schema public to service_role;
grant select on public.ai_usage to authenticated; -- filtré par RLS : admin seulement

-- retrouver les lots déjà envoyés dont la ligne de suivi n'a pas pu être écrite
insert into public.ai_batches (id, job_ids, created_at)
select batch_id, array_agg(id), min(updated_at)
from public.jobs where status = 'batched' and batch_id is not null
group by batch_id
on conflict (id) do nothing;

-- réveiller aussi le worker tant que des tâches attendent le résultat d'un lot
create or replace function public.kick_worker()
returns void
language plpgsql security definer set search_path = public, private, extensions as $$
declare v_secret text;
begin
  update public.jobs set status = 'pending', updated_at = now()
  where status = 'running' and updated_at < now() - interval '6 minutes' and attempts < 4;
  update public.jobs set status = 'error', last_error = coalesce(last_error, 'timeout'), updated_at = now()
  where status = 'running' and updated_at < now() - interval '6 minutes' and attempts >= 4;

  if not exists (select 1 from public.jobs where status = 'pending' and run_after <= now())
     and not exists (select 1 from public.jobs where status = 'batched')
     and not exists (select 1 from public.ai_batches where status in ('in_progress', 'canceling', 'ended')) then
    return;
  end if;
  if exists (select 1 from public.jobs where status = 'running' and updated_at > now() - interval '3 minutes') then return; end if;

  select value into v_secret from private.secrets where name = 'cron_secret';
  perform net.http_post(
    url := 'https://bffjndnxeynyoseryfzs.supabase.co/functions/v1/worker',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
end;
$$;
revoke execute on function public.kick_worker() from public, anon, authenticated;
