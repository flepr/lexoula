-- Λεξούλα — la première version de la fonction « audio » prenait la limite de requêtes par minute de Google
-- pour un quota épuisé et se mettait en pause 6 h : on lève cette pause (la fonction corrigée gère la limite).
update public.app_config set value = value - 'pause_until' where key = 'audio_state';
