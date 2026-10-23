-- Nom par défaut tiré de l'adresse e-mail mis en forme : « vincent.moro42@… » → « Vincent Moro »
create or replace function public.name_from_email(p_email text)
returns text language sql immutable as $$
  select nullif(initcap(trim(regexp_replace(regexp_replace(split_part(coalesce(p_email, ''), '@', 1), '[0-9]+', ' ', 'g'), '[._+\-\s]+', ' ', 'g'))), '');
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admins jsonb;
  v_name text;
begin
  select value into v_admins from public.app_config where key = 'admin_emails';
  v_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    public.name_from_email(new.email)
  );
  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    lower(new.email),
    nullif(v_name, ''),
    case when v_admins ? lower(coalesce(new.email, '')) then 'admin'::public.app_role
         else 'student'::public.app_role end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- comptes existants dont le nom est encore la partie avant @
update public.profiles
   set display_name = public.name_from_email(email)
 where display_name = split_part(email, '@', 1);
