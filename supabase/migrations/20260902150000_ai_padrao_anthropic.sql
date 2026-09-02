-- Alinha o provedor de IA ao que o produto realmente usa: Anthropic.
--
-- O schema nascia com ai_provider = 'google' e um modelo do Gemini gravado.
-- Depois da troca para Claude isso vira um erro silencioso e confuso: a chave da
-- Anthropic e salva numa coluna, o sistema le a outra, e a validacao testa a
-- chave contra um modelo que so existe no Google -- aparecendo na tela como
-- "chave invalida", que e a explicacao errada.

ALTER TABLE public.organization_settings
  ALTER COLUMN ai_provider SET DEFAULT 'anthropic';

-- So mexe em quem esta apontado para o Google sem chave do Google configurada,
-- ou seja, configuracao herdada e nunca usada. Quem usa Gemini de verdade fica
-- exatamente como esta.
UPDATE public.organization_settings
   SET ai_provider = 'anthropic',
       ai_model    = 'claude-sonnet-5'
 WHERE COALESCE(ai_provider, 'google') = 'google'
   AND COALESCE(ai_google_key, '') = '';

-- Sobra do Gemini em linhas ja migradas para a Anthropic.
UPDATE public.organization_settings
   SET ai_model = 'claude-sonnet-5'
 WHERE ai_provider = 'anthropic'
   AND COALESCE(ai_model, '') NOT LIKE 'claude-%';
