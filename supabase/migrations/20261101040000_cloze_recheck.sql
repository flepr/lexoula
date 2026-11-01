-- Λεξούλα — seconde relecture des phrases à trous, avec un relecteur plus strict
-- © 2026 Φοίβος Λεπέρ (Fabien Lepère). Tous droits réservés.
--
-- La première passe a laissé des cas où tous les nombres conviennent (« Έχω πέντε αδερφές », « Θέλω τρία μήλα »)
-- ou plusieurs membres de la famille (« Ο πατέρας μου διαβάζει εφημερίδα »). Le relecteur rend désormais un verdict
-- pour chaque leurre de chaque question. Départ différé de 10 minutes : la fonction est déployée après les migrations.
insert into public.jobs (type, payload, run_after)
select 'cloze', jsonb_build_object('lexeme_ids', jsonb_agg(id order by id)), now() + interval '10 minutes'
from (
  select id, (row_number() over (order by id) - 1) / 10 as pack
  from public.lexemes
  where status = 'ready' and coalesce(data ->> 'ex', '') <> ''
) l
group by pack;
