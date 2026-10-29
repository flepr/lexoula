-- Les traductions (data->'tr') servent de réponses dans les QCM et l'exercice d'association :
-- elles ne doivent contenir aucun grec. Deux mots (το διαζύγιο, η πρόταση γάμου) avaient une
-- locution grecque dans la traduction (« divorce ; divorcer : παίρνω διαζύγιο »). On garde la partie
-- traduite et on déplace la locution en tête de la note (« παίρνω διαζύγιο = divorcer »).
-- Même logique que splitGreekFromTr() dans le worker, qui s'applique aux nouveaux mots.

create or replace function private.split_tr(tr jsonb, note jsonb)
returns jsonb language plpgsql as $$
declare
  g constant text := '[Ͱ-Ͽἀ-῿]';
  lang text; val text; seg text; m text[];
  keep text[]; moved text[]; add text; old_note text;
  out_tr jsonb := coalesce(tr, '{}'::jsonb);
  out_note jsonb := coalesce(note, '{}'::jsonb);
begin
  for lang, val in select key, value from jsonb_each_text(coalesce(tr, '{}'::jsonb)) loop
    continue when val !~ g;
    keep := '{}'; moved := '{}';
    foreach seg in array regexp_split_to_array(val, '\s*;\s*') loop
      seg := btrim(regexp_replace(seg, '\s*\([^)]*' || g || '[^)]*\)', '', 'g'));
      if seg !~ g then
        if seg <> '' then keep := keep || seg; end if;
        continue;
      end if;
      m := regexp_match(seg, '^(.*?)\s*[:=]\s*(.+)$');
      if m is not null and m[1] !~ g and m[2] ~ g then
        keep := keep || m[1]; moved := moved || (m[2] || ' = ' || m[1]);
      elsif m is not null and m[1] ~ g and m[2] !~ g then
        keep := keep || m[2]; moved := moved || (m[1] || ' = ' || m[2]);
      else
        moved := moved || seg;
      end if;
    end loop;
    continue when cardinality(keep) = 0;
    out_tr := jsonb_set(out_tr, array[lang], to_jsonb(array_to_string(keep, ' ; ')));
    old_note := coalesce(out_note ->> lang, '');
    select string_agg(x, ' · ') into add from unnest(moved) x where position(x in old_note) = 0;
    if add is not null then
      out_note := jsonb_set(out_note, array[lang],
        to_jsonb(case when old_note = '' then add else add || '. ' || old_note end));
    end if;
  end loop;
  return jsonb_build_object('tr', out_tr, 'note', out_note);
end $$;

update public.lexemes l
set data = l.data || private.split_tr(l.data -> 'tr', l.data -> 'note'),
    updated_at = now()
where l.status = 'ready'
  and exists (select 1 from jsonb_each_text(l.data -> 'tr') t where t.value ~ '[Ͱ-Ͽἀ-῿]');
drop function private.split_tr(jsonb, jsonb);
