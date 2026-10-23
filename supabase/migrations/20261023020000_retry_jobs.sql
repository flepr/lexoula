-- Relance les tâches IA bloquées par l'ancien appel « outil forcé » (refusé par Sonnet 5.5)
update public.jobs
   set attempts = 0, run_after = now(), last_error = null, status = 'pending', updated_at = now()
 where status in ('pending', 'error') and last_error like '%tool_choice%';
