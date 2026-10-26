-- Codes de classe : 6 lettres, sans chiffres (décision de Fabien du 26/10/2026).
-- Alphabet sans I ni O (confusion avec 1, l et 0) : 24⁶ ≈ 190 millions de codes.
-- S'applique aux nouvelles classes et au bouton « Nouveau code » ; les codes existants
-- (dont celui de la classe Β2, déjà partagé) ne changent pas.

create or replace function public.gen_invite_code()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare v_code text;
begin
  loop
    select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + floor(random() * 24)::int, 1), '')
      into v_code from generate_series(1, 6);
    exit when not exists (select 1 from public.groups where invite_code = v_code);
  end loop;
  return v_code;
end;
$$;
