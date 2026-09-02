-- Indices nas colunas que as telas realmente filtram.
--
-- O linter aponta 74 chaves estrangeiras sem indice. Criar as 74 seria trocar um
-- problema por outro: indice que ninguem le continua sendo atualizado a cada
-- gravacao. Estes sete sao os que aparecem em consulta de tela ou em politica de
-- acesso, ou seja, rodam o tempo todo.
--
-- profiles.organization_id e o mais importante da lista: a politica de leitura
-- de perfis compara essa coluna em TODA consulta a perfis, e perfis sao lidos em
-- toda tela que mostra responsavel.
--
-- Sem CONCURRENTLY de proposito: as tabelas tem dezenas de linhas hoje, entao a
-- criacao e instantanea, e CONCURRENTLY nao roda dentro da transacao da migration.

CREATE INDEX IF NOT EXISTS idx_profiles_organization_id
  ON public.profiles (organization_id);

CREATE INDEX IF NOT EXISTS idx_crm_companies_organization_id
  ON public.crm_companies (organization_id);

-- "Meus negocios", "meus contatos", "minhas atividades": filtro por responsavel
-- e o recorte mais usado por quem vende.
CREATE INDEX IF NOT EXISTS idx_deals_owner_id
  ON public.deals (owner_id);

CREATE INDEX IF NOT EXISTS idx_contacts_owner_id
  ON public.contacts (owner_id);

CREATE INDEX IF NOT EXISTS idx_activities_owner_id
  ON public.activities (owner_id);

CREATE INDEX IF NOT EXISTS idx_crm_companies_owner_id
  ON public.crm_companies (owner_id);

-- Contatos de uma empresa: a tela da empresa lista os contatos dela.
CREATE INDEX IF NOT EXISTS idx_contacts_client_company_id
  ON public.contacts (client_company_id);
