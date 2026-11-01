-- Λεξούλα — relance des contrôles de phrases à trous
-- © 2026 Φοίβος Λεπέρ (Fabien Lepère). Tous droits réservés.
--
-- Le worker s'est réveillé entre la migration 20261101010000_cloze_check.sql et le déploiement de la fonction :
-- l'ancien code ne connaissait pas le type « cloze » et a marqué les tâches terminées sans les exécuter.
update public.jobs
set status = 'pending', attempts = 0, run_after = now(), last_error = null, updated_at = now()
where type = 'cloze' and status = 'done' and ctx is null and batch_id is null;
