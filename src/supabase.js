import { createClient } from "@supabase/supabase-js";

// Valeurs publiques (la clé « publishable » est faite pour être dans le navigateur ;
// la sécurité repose sur les règles RLS de la base).
export const SUPABASE_URL = "https://bffjndnxeynyoseryfzs.supabase.co";
export const SUPABASE_KEY = "sb_publishable_zh9McIZaZRKpeCaEw8Q6hA_2e2vi6nn";

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
});
