-- Transfert de la progression de l'ancien compte administrateur (fabien.lepere@me.com)
-- vers le compte Microsoft (fabien@lepe.re), à la demande de Fabien (24/10/2026).
-- Fusion sans perte si le nouveau compte a déjà révisé :
--   progress : compteurs additionnés, boîte/échéance/dernière révision de la révision la plus récente,
--              « connu » et « étoilé » conservés s'ils le sont d'un côté ou de l'autre ;
--   activity : réponses du jour additionnées ;
--   listes personnelles, classes et réglages repris (les réglages du nouveau compte priment).
-- L'ancien compte n'est pas supprimé ici : Fabien le supprime depuis l'appli.

do $$
declare
  v_old uuid;
  v_new uuid;
  v_p int; v_a int; v_l int;
begin
  select id into v_old from public.profiles where lower(email) = 'fabien.lepere@me.com' limit 1;
  select id into v_new from public.profiles where lower(email) = 'fabien@lepe.re' limit 1;
  if v_old is null or v_new is null or v_old = v_new then
    raise notice 'merge_admin_progress: nothing to do (old: %, new: %)', v_old is not null, v_new is not null;
    return;
  end if;

  insert into public.progress as p (user_id, lexeme_id, box, due, seen, ok, ko, last, known, star, updated_at)
  select v_new, o.lexeme_id, o.box, o.due, o.seen, o.ok, o.ko, o.last, o.known, o.star, now()
    from public.progress o where o.user_id = v_old
  on conflict (user_id, lexeme_id) do update set
    box  = case when coalesce(excluded.last, '-infinity') > coalesce(p.last, '-infinity') then excluded.box  else p.box  end,
    due  = case when coalesce(excluded.last, '-infinity') > coalesce(p.last, '-infinity') then excluded.due  else p.due  end,
    last = greatest(p.last, excluded.last),
    seen = p.seen + excluded.seen,
    ok   = p.ok + excluded.ok,
    ko   = p.ko + excluded.ko,
    known = p.known or excluded.known,
    star  = p.star or excluded.star,
    updated_at = now();
  get diagnostics v_p = row_count;

  insert into public.activity as a (user_id, day, n, ok)
  select v_new, o.day, o.n, o.ok from public.activity o where o.user_id = v_old
  on conflict (user_id, day) do update set n = a.n + excluded.n, ok = a.ok + excluded.ok;
  get diagnostics v_a = row_count;

  update public.lists set owner_id = v_new where owner_id = v_old;
  get diagnostics v_l = row_count;

  insert into public.group_members (group_id, user_id)
  select m.group_id, v_new from public.group_members m where m.user_id = v_old
  on conflict do nothing;

  update public.profiles n
     set settings = coalesce(o.settings, '{}'::jsonb) || coalesce(n.settings, '{}'::jsonb)
    from public.profiles o
   where n.id = v_new and o.id = v_old;

  -- l'ancien compte est vidé pour qu'une suppression ultérieure ne fasse rien perdre et qu'on ne compte rien deux fois
  delete from public.progress where user_id = v_old;
  delete from public.activity where user_id = v_old;

  raise notice 'merge_admin_progress: % words, % days, % personal lists moved', v_p, v_a, v_l;
end;
$$;
