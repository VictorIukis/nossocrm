# NossoCRM da Bright

Instancia do CRM para a operacao comercial da Bright (Glow Holding).

| item | valor |
|---|---|
| App | https://nossocrm-bn4u.vercel.app |
| Repo | https://github.com/VictorIukis/nossocrm (fork de thaleslaray/nossocrm) |
| Vercel | projeto `nossocrm-bn4u`, time `victors-projects-37efdfa6` (Hobby) |
| Supabase | projeto `Bright CRM`, ref `mwvluarcyolkldhtnoro`, regiao sa-east-1 |

O projeto do IncluiEdu (`hbgbarzckhzayyeqjtmj`) nao foi tocado.

## O que foi mudado em relacao ao upstream

### 1. Cron do `stage-evaluations` (vercel.json)

O upstream agenda `* * * * *` (a cada minuto). Conta Hobby so aceita cron
diario, e a Vercel recusa o deploy inteiro por causa disso. Ficou `0 7 * * *`.

A cadencia real de minutos deve ser disparada pelo n8n, que ja roda 24/7 e nao
tem esse limite:

    GET https://nossocrm-bn4u.vercel.app/api/cron/stage-evaluations
    Authorization: Bearer <CRON_SECRET>

### 2. O instalador aplicava so a primeira migration (lib/installer/migrations.ts)

Esta e a correcao que mais importa. O `runSchemaMigration` original lia
**um unico arquivo**, `20251201000000_schema_init.sql`, que esta congelado em
dezembro. As outras 45 migrations nunca rodavam. Um CRM instalado pelo wizard
nascia sem:

- todo o sistema de mensagens (`messaging_*`, conversas, canais)
- `ai_pending_evaluations` (a fila que o cron acima drena)
- `board_ai_config`, `hitl_pending_alerts`, `deal_activities`, chamadas de voz
- ~20 migrations de correcao de RLS, ou seja, o isolamento entre organizacoes
  ficava na versao antiga

Agora ele le a pasta inteira em ordem de versao e grava o que aplicou em
`supabase_migrations.schema_migrations`, a mesma tabela que o CLI do Supabase
usa. Duas consequencias praticas:

- a instalacao e **retomavel**: se a decima migration falhar, as nove primeiras
  ficam registradas e a reexecucao continua de onde parou, em vez de recomecar
  e morrer em "already exists"
- um `supabase db push` futuro enxerga o mesmo historico

Cada migration roda na propria transacao, e o erro diz qual arquivo quebrou.

### 3. Os .sql precisam ir junto na funcao (next.config.ts)

O instalador le a pasta em disco em tempo de execucao. O tracing do Next so
inclui arquivo que ele ve num import estatico, entao sem
`outputFileTracingIncludes` a funcao sobe sem os .sql e a instalacao morre em
ENOENT. Incluido `./supabase/migrations/**` na rota do instalador.

## Schema aplicado (01/set/2026)

As 46 migrations foram aplicadas em ordem no banco `Bright CRM`, mais uma 47a de
correcao de seguranca. Estado conferido: 56 tabelas, 109 politicas de RLS, 2 jobs
de pg_cron agendados, e `supabase_migrations.schema_migrations` com o historico
completo, que e a mesma tabela que o CLI do Supabase usa.

Consequencia pratica: o wizard vai PULAR o passo de migrations sozinho (o
health-check dele detecta o schema aplicado) e cuidar so das variaveis de
ambiente e do usuario administrador.

### Quatro bugs que so aparecem quando a cadeia roda inteira

Nenhum deles jamais foi exercitado no upstream, porque o instalador de la
aplicava so a migration inicial. Todos corrigidos e commitados:

| migration | o que quebrava |
|---|---|
| `20260223000002` | `CREATE OR REPLACE` nao troca coluna de OUT; `search_messages` renomeia uma. Falta `DROP` antes |
| `20260224000000` | cria indice em `ai_decisions.organization_id` e `messaging_webhook_events.organization_id`, colunas que a cadeia nunca cria e o codigo nao usa |
| `20260409120000` | mesmo caso do primeiro, em `expire_old_pending_advances` |
| `20260409120000` | o bloco do pg_cron captura `undefined_object`, mas schema ausente levanta `invalid_schema_name`, entao a migration morria em vez de seguir sem os jobs |

### Duas falhas de isolamento, achadas pelo auditor do Supabase

Corrigidas na migration `20260901180000`:

- **`vw_hitl_pending_by_age` vazava entre organizacoes.** Criada sem
  `security_invoker`, rodava com privilegio do dono e ignorava o RLS: qualquer
  usuario autenticado via a contagem de pendencias de todas as organizacoes.
- **O papel `anon` executava as funcoes SECURITY DEFINER.** Confirmado de fora:
  `trigger_hitl_alerts` respondia 200 com dados sem nenhum login. Pegadinha que
  quase passou: revogar de `anon` nao adianta, porque a concessao e para `PUBLIC`
  e `anon` herda dela. Tem que ser `REVOKE FROM PUBLIC` com `GRANT` de volta para
  `authenticated` e `service_role`.

## Falta fazer

1. Rodar o wizard em /install (token da Vercel, token do Supabase `sbp_...` e o
   e-mail/senha do admin — tudo do Victor)
2. Desligar o instalador depois: `INSTALLER_ENABLED=false` na Vercel
3. Ligar na Sofia (ver secao abaixo)

## Como a Sofia vai conversar com o CRM

A API publica autentica por header `X-Api-Key`, gerado em
Configuracoes -> Integracoes. O caminho mais curto para o n8n:

| momento na conversa | chamada |
|---|---|
| lead novo chega no WhatsApp | `POST /functions/v1/webhook-in/<source_id>` (cria contato + deal) |
| Sofia marca a reuniao | `POST /api/public/v1/deals/move-stage-by-identity` |
| lead some / recusa | mesma rota com `mark: "lost"` |
| registrar o que houve | `POST /api/public/v1/activities` |

`move-stage-by-identity` aceita **so o telefone** e resolve o deal sozinho.
Isso importa: o n8n nao precisa guardar id de deal em lugar nenhum, o que
elimina a classe de bug que ja custou caro na agenda (estado guardado em um
no e perdido no proximo).

## O wizard pede menos coisa do que o README diz

O README manda copiar service_role, anon key e a string do pooler na mao. O
codigo nao faz isso. Ele pede so:

1. **Token da Vercel** — vercel.com/account/tokens, "Create Token"
2. **Personal access token do Supabase** (`sbp_...`) —
   supabase.com/dashboard/account/tokens
3. **Nome, e-mail e senha** do administrador

Com o token do Supabase ele lista os projetos da conta (vai aparecer
`Bright CRM`), busca as chaves sozinho pela Management API, e — o detalhe que
resolve tudo — **cria um role de login temporario no banco** em vez de precisar
da senha do projeto. Por isso nao ha nada para copiar do painel do Supabase, e
nenhuma senha precisa passar por terceiros.

Depois ele grava as variaveis de ambiente na Vercel e dispara o redeploy.
