-- Λεξούλα — deux phrases réécrites par le contrôle des phrases à trous gardaient un « ___ » littéral
-- © 2026 Φοίβος Λεπέρ (Fabien Lepère). Tous droits réservés.
-- Le worker refuse désormais ces phrases ; ici, correction des deux mots touchés (traductions inchangées).
update public.lexemes
set data = jsonb_set(data, '{ex}', to_jsonb(replace(data ->> 'ex', 'μία σταγόνα ___ στη', 'μία σταγόνα στη'))), updated_at = now()
where data ->> 'gr' = 'το ξύδι' and data ->> 'ex' like '%σταγόνα \_\_\_ στη%';

update public.lexemes
set data = jsonb_set(data, '{ex}', to_jsonb(replace(data ->> 'ex', 'Εγώ ___ μαθητής', 'Εγώ είμαι μαθητής'))), updated_at = now()
where data ->> 'gr' = 'είμαι' and data ->> 'ex' like 'Εγώ \_\_\_ μαθητής%';
