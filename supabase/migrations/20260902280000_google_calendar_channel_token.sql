ALTER TABLE public.user_calendar_connections
  ADD COLUMN IF NOT EXISTS channel_token TEXT;

COMMENT ON COLUMN public.user_calendar_connections.channel_token IS
  'Segredo que definimos ao abrir o canal de avisos. O Google devolve em cada aviso; é como sabemos que o aviso veio dele.';
