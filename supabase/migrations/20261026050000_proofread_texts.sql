-- Relecture automatique des textes (26/10/2026)
-- Un texte écrit par l'IA passe désormais par une relecture (job « proofread ») avant ses traductions :
-- conjugaisons et accords des mots du vivier (ex. « ήθελε να μεταφέρω » au lieu de « μεταφέρει »).

alter table public.jobs drop constraint if exists jobs_type_check;
alter table public.jobs add constraint jobs_type_check check (type in ('enrich', 'text', 'proofread', 'translate'));

-- un texte en relecture compte comme un texte en cours pour sa classe
create or replace function public.request_text(p_group uuid, p_kind text default 'short')
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_teacher_of(p_group) then raise exception 'forbidden'; end if;
  if exists (select 1 from public.jobs where type in ('text', 'proofread', 'translate') and status in ('pending', 'running', 'batched')
             and payload ->> 'group_id' = p_group::text and not coalesce((payload ->> 'existing')::boolean, false)) then
    raise exception 'already_running';
  end if;
  insert into public.jobs (type, payload)
  values ('text', jsonb_build_object('group_id', p_group, 'kind', case when p_kind = 'long' then 'long' else 'short' end,
                                     'reason', 'manual'));
end;
$$;

create or replace function public.schedule_texts(p_kind text)
returns int
language plpgsql security definer set search_path = public as $$
declare v_count int := 0; r record;
begin
  for r in
    select g.id from public.groups g
    where not g.archived and g.texts_enabled
      and exists (select 1 from public.group_members m where m.group_id = g.id)
      and (select count(distinct li.lexeme_id) from public.lists ls join public.list_items li on li.list_id = ls.id
           join public.lexemes lx on lx.id = li.lexeme_id where ls.group_id = g.id and lx.status = 'ready') >= 8
  loop
    if not exists (select 1 from public.jobs where type in ('text', 'proofread', 'translate') and status in ('pending', 'running', 'batched')
                   and payload ->> 'group_id' = r.id::text and not coalesce((payload ->> 'existing')::boolean, false)) then
      insert into public.jobs (type, payload)
      values ('text', jsonb_build_object('group_id', r.id, 'kind', p_kind, 'reason', 'schedule'));
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- la relecture passe avant les nouveaux textes, comme les traductions
create or replace function public.claim_jobs_mode(p_mode text, p_limit int)
returns setof public.jobs
language sql security definer set search_path = public as $$
  update public.jobs j
  set status = 'running', attempts = j.attempts + 1, updated_at = now()
  where j.id in (
    select id from public.jobs
    where status = 'pending' and run_after <= now() and mode = p_mode
    order by case type when 'enrich' then 0 when 'translate' then 1 when 'proofread' then 1 else 2 end, id
    limit p_limit
    for update skip locked
  )
  returning j.*;
$$;

-- estimation affichée à l'import : texte court + relecture + deux traductions
create or replace function public.estimate_import(p_group uuid, p_items jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_new int := 0;
  v_units int; v_word_std numeric; v_word numeric;
  v_text numeric; v_ntext int; v_tr numeric; v_ntr int; v_pr numeric;
  v_rate numeric;
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'bad_items'; end if;

  select count(distinct k) into v_new
  from (select public.normalize_key(x ->> 'input') as k from jsonb_array_elements(p_items) x) s
  where k <> '' and length(k) <= 200
    and not exists (select 1 from public.lexemes l where l.key = s.k and l.status in ('ready', 'pending'));

  select coalesce(sum(units), 0), sum(std_usd) into v_units, v_word_std
  from public.ai_usage where job_type = 'enrich' and created_at > now() - interval '60 days';
  v_word := case when v_units >= 20 then v_word_std / v_units else 0.0146 end;

  select count(*), avg(std_usd) into v_ntext, v_text
  from public.ai_usage where job_type = 'text' and kind = 'short' and created_at > now() - interval '60 days';
  select count(*), avg(std_usd) into v_ntr, v_tr
  from public.ai_usage where job_type = 'translate' and kind = 'short' and created_at > now() - interval '60 days';
  -- relecture : mesurée si possible, sinon environ la moitié d'un texte court
  select avg(std_usd) into v_pr
  from public.ai_usage where job_type = 'proofread' and kind = 'short' and created_at > now() - interval '60 days';

  select coalesce((value ->> 'rate')::numeric, 0.86) into v_rate from public.app_config where key = 'usd_eur';

  return jsonb_build_object(
    'new_words', v_new,
    'word_usd', round(v_word, 6),
    'text_usd', case when p_group is null then 0
                     when v_ntext >= 2 and v_ntr >= 2 then round(v_text + coalesce(v_pr, v_text / 2) + 2 * v_tr, 6)
                     else 0.07 end,
    'usd_eur', coalesce(v_rate, 0.86),
    'measured', v_units >= 20
  );
end;
$$;

revoke execute on function public.estimate_import(uuid, jsonb), public.claim_jobs_mode(text, int) from public, anon;
grant execute on function public.estimate_import(uuid, jsonb) to authenticated;
revoke execute on function public.claim_jobs_mode(text, int), public.schedule_texts(text) from authenticated;
grant execute on function public.claim_jobs_mode(text, int) to service_role;

-- faute repérée par Fabien dans « Η συζήτηση στο πανεπιστήμιο » (et sa copie de démonstration)
update public.texts
set paragraphs = replace(paragraphs::text, 'να [[μεταφέρω|', 'να [[μεταφέρει|')::jsonb
where paragraphs::text like '%να [[μεταφέρω|%';

-- relecture des textes déjà publiés : un seul exemplaire par texte (les copies de la classe de
-- démonstration reçoivent la même correction sans nouvel appel), sans retraduction
insert into public.jobs (type, payload)
select 'proofread', jsonb_build_object('text_id', t.id, 'group_id', t.group_id, 'existing', true)
from (
  select distinct on (t.title, t.created_at) t.id, t.group_id
  from public.texts t join public.groups g on g.id = t.group_id
  where t.status = 'ready'
  order by t.title, t.created_at, g.created_at
) t;
