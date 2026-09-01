-- =============================================================================
-- Criar usuario por fora do instalador falhava sempre
-- =============================================================================
-- handle_new_user() chamava get_singleton_organization_id(), que comeca com
-- "IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'".
--
-- O gatilho roda no INSERT em auth.users, ou seja, exatamente no momento em que
-- ainda NAO existe usuario autenticado. Resultado: criar usuario por qualquer
-- caminho que nao passe organization_id no metadata morre com
-- "Database error creating new user", sem dizer o motivo. Isso inclui o
-- formulario do painel do Supabase, a API de admin e o convite por e-mail.
--
-- So o instalador escapava, porque ele passa organization_id no user_metadata.
-- Por isso o defeito nunca apareceu: o unico caminho testado era o que desviava
-- dele. Quem precisasse adicionar um segundo usuario a instancia ia bater aqui.
--
-- A guarda de autenticacao faz sentido para a funcao publica, que o PostgREST
-- expoe como rota RPC. O erro foi o gatilho depender dela. Aqui ele resolve a
-- organizacao direto, seguro porque a propria funcao ja e SECURITY DEFINER e so
-- roda a partir do gatilho.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_org_id uuid;
BEGIN
    v_org_id := (new.raw_user_meta_data->>'organization_id')::uuid;

    IF v_org_id IS NULL THEN
        SELECT id INTO v_org_id
        FROM public.organizations
        WHERE deleted_at IS NULL
        ORDER BY created_at ASC
        LIMIT 1;
    END IF;

    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'Nenhuma organization encontrada. Rode o setup inicial antes de criar usuários.';
    END IF;

    INSERT INTO public.profiles (id, email, name, avatar, role, organization_id)
    VALUES (
        new.id,
        new.email,
        COALESCE(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
        new.raw_user_meta_data->>'avatar_url',
        COALESCE(new.raw_user_meta_data->>'role', 'user'),
        v_org_id
    );

    INSERT INTO public.user_settings (user_id)
    VALUES (new.id)
    ON CONFLICT (user_id) DO NOTHING;

    RETURN new;
END;
$function$;
