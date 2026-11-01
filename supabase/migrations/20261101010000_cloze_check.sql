-- Λεξούλα — contrôle des phrases à trous
-- © 2026 Φοίβος Λεπέρ (Fabien Lepère). Tous droits réservés.
--
-- Problème signalé par Fabien le 01/11/2026 : « Θέλω ___ μήλα, παρακαλώ » avec δέκα / οκτώ / πέντε / δύο,
-- où toutes les propositions conviennent. Décision : la phrase doit appeler le mot à elle seule (pas de
-- traduction affichée pendant l'exercice). Nouvelle tâche « cloze » du worker : un relecteur lit chaque phrase
-- avec chacun de ses leurres ; si l'un d'eux convient aussi, il propose d'autres leurres ou une nouvelle phrase.
-- Elle suit chaque enrichissement (phrase principale) et chaque tâche « example » (phrase de l'autre palier).

alter table public.jobs drop constraint if exists jobs_type_check;
alter table public.jobs add constraint jobs_type_check
  check (type in ('enrich', 'example', 'cloze', 'text', 'proofread', 'translate'));

-- contrôle des phrases déjà écrites (principale et, s'il y en a une, celle de l'autre palier), par paquets de 10
insert into public.jobs (type, payload)
select 'cloze', jsonb_build_object('lexeme_ids', jsonb_agg(id order by id))
from (
  select id, (row_number() over (order by id) - 1) / 10 as pack
  from public.lexemes
  where status = 'ready' and coalesce(data ->> 'ex', '') <> ''
) l
group by pack;
