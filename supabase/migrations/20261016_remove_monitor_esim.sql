-- Remove as tabelas dos recursos "Monitor WhatsApp" e "Internet / eSIM" (cards
-- retirados do painel admin). ATENÇÃO: apaga os dados dessas tabelas.
-- Ordem: filhas antes das tabelas referenciadas. Pode ser aplicada de novo.
BEGIN;
DROP TABLE IF EXISTS public.monitor_deliveries;
DROP TABLE IF EXISTS public.monitor_messages;
DROP TABLE IF EXISTS public.monitor_devices;
DROP TABLE IF EXISTS public.monitor_pair_codes;
DROP TABLE IF EXISTS public.monitor_codes;
DROP TABLE IF EXISTS public.esim_api_errors;
DROP TABLE IF EXISTS public.esim_webhook_events;
DROP TABLE IF EXISTS public.esim_topups;
DROP TABLE IF EXISTS public.esim_usage;
DROP TABLE IF EXISTS public.esim_payments;
DROP TABLE IF EXISTS public.esims;
DROP TABLE IF EXISTS public.esim_orders;
DROP TABLE IF EXISTS public.esim_plans;
DROP TABLE IF EXISTS public.esim_users;
DROP TABLE IF EXISTS public.esim_settings;
COMMIT;
