-- Suite de 20261029000000_tr_without_greek.sql : la traduction d'un nom ne contient que des noms.
-- Pour το διαζύγιο et η πρόταση γάμου, la migration précédente avait gardé la locution verbale
-- dans la traduction (« divorce ; to get a divorce ») et l'avait répétée en tête de la note
-- (« παίρνω διαζύγιο = to get a divorce. ») alors que la note l'expliquait déjà ; forms la répétait aussi.
-- Ici : retrait de la locution de tr ; retrait de l'ajout en tête de note quand le reste de la note
-- cite déjà la locution grecque ; retrait de forms des locutions (sans étiquette) déjà citées en note.

create or replace function private.fix_noun_tr(d jsonb)
returns jsonb language plpgsql as $$
declare
  lang text; tr_val text; note_val text; m text[]; rest text;
  segs text[]; all_notes text; f text; kept text[] := '{}';
begin
  for lang, note_val in select key, value from jsonb_each_text(coalesce(d -> 'note', '{}'::jsonb)) loop
    -- « <locution grecque> = <traduction>. <note d'origine> »
    m := regexp_match(note_val, '^([^=.]*[Ͱ-Ͽἀ-῿][^=.]*) = ([^.]+?)(?:\.\s+(.*))?$');
    continue when m is null;
    tr_val := coalesce(d -> 'tr' ->> lang, '');
    select array_agg(x) into segs from unnest(regexp_split_to_array(tr_val, '\s*;\s*')) x where x <> m[2];
    if segs is not null and cardinality(segs) > 0 then
      d := jsonb_set(d, array['tr', lang], to_jsonb(array_to_string(segs, ' ; ')));
    end if;
    rest := coalesce(m[3], '');
    if position(m[1] in rest) > 0 then
      d := jsonb_set(d, array['note', lang], to_jsonb(rest));
    end if;
  end loop;

  select string_agg(value, ' ') into all_notes from jsonb_each_text(coalesce(d -> 'note', '{}'::jsonb));
  foreach f in array regexp_split_to_array(coalesce(d ->> 'forms', ''), '\s*·\s*') loop
    if f <> '' and (position('.' in f) > 0 or position(f in coalesce(all_notes, '')) = 0) then
      kept := kept || f;
    end if;
  end loop;
  return jsonb_set(d, '{forms}', to_jsonb(array_to_string(kept, ' · ')));
end $$;

update public.lexemes
set data = private.fix_noun_tr(data), updated_at = now()
where status = 'ready' and input in ('το διαζύγιο', 'η πρόταση γάμου');

drop function private.fix_noun_tr(jsonb);
