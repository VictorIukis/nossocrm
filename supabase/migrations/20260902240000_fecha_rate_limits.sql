-- Fecha a leitura da tabela de limitacao de uso.
--
-- `rate_limits` guarda quem chamou (identifier) qual endpoint e quando. A
-- politica deixava QUALQUER pessoa autenticada ler tudo -- ou seja, dava para
-- mapear o uso da API por outras pessoas e outras organizacoes.
--
-- Nenhuma tela le esta tabela: uma varredura no codigo nao encontrou uma
-- referencia sequer fora de comentario. Quem escreve e le de verdade e o
-- servidor, com a credencial de servico, que ignora RLS. Entao remover a
-- politica de leitura nao tira funcionalidade de ninguem.

DROP POLICY IF EXISTS rate_limits_readonly ON public.rate_limits;
