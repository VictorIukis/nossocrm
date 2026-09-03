-- Conexão com o Google Ads, por organização.
--
-- Diferente da Meta, aqui não existe "token de acesso" simples. O Google exige
-- três coisas distintas, e confundi-las é a causa mais comum de erro:
--
--   developer token  → identifica o APLICATIVO junto ao Google Ads. Um por
--                      instalação do CRM, fica em variável de ambiente.
--   refresh token    → identifica QUEM autorizou. Um por organização, vem do
--                      OAuth e fica aqui.
--   customer id      → identifica QUAL conta de anúncios ler.
--
-- E há um quarto, que só aparece em conta gerenciada por agência:
--   login customer id → a conta gerenciadora (MCC) por onde o acesso passa.
--   Sem ela, o Google recusa com "user doesn't have permission", mesmo com
--   tudo certo -- e a mensagem não sugere nada sobre isso.

ALTER TABLE public.organization_settings
  ADD COLUMN IF NOT EXISTS google_ads_refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS google_ads_access_token TEXT,
  ADD COLUMN IF NOT EXISTS google_ads_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS google_ads_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS google_ads_login_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS google_ads_account_name TEXT,
  ADD COLUMN IF NOT EXISTS google_ads_last_error TEXT;

COMMENT ON COLUMN public.organization_settings.google_ads_login_customer_id IS
  'Conta gerenciadora (MCC), quando a conta de anúncios é gerida por agência. Sem ela o Google recusa por permissão, sem explicar o motivo.';
COMMENT ON COLUMN public.organization_settings.google_ads_customer_id IS
  'Conta de anúncios a ler, só dígitos (sem hífen).';
