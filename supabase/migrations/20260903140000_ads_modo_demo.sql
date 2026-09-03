-- Modo demonstração do painel de Ads.
--
-- A Bright gerencia contas de clientes e não tem autorização para trazer esses
-- dados para dentro do CRM. Sem este modo, mostrar a tela funcionando exigiria
-- conectar uma conta real -- isto é, usar dado de cliente sem permissão.
--
-- Fica por organização, e não por pessoa ou por navegador, porque uma
-- demonstração precisa mostrar a mesma coisa em qualquer tela.

ALTER TABLE public.organization_settings
  ADD COLUMN IF NOT EXISTS ads_modo_demo BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organization_settings.ads_modo_demo IS
  'Painel de Ads mostra dados fictícios, com aviso na tela. Não substitui conexão: quando ligado, nem toca nas APIs de anúncio.';
