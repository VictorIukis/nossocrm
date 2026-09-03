# Clicksign — o CRM sabe quando o contrato foi assinado

Antes: alguém abria o Clicksign para conferir se o cliente assinou, porque o
projeto só começa depois disso. Quando o cliente não assinava, ninguém sabia até
alguém olhar.

Agora o Clicksign avisa o CRM. A assinatura entra no histórico do negócio,
aparece um selo no negócio e, se você escolher uma etapa, o negócio anda sozinho.

> Configurar é **admin**.

---

## Como ligar (5 minutos)

1. No CRM: `Configurações → Integrações → Clicksign`. Copie o endereço que
   aparece no passo 1.
2. No Clicksign: `Configurações → Webhooks → Novo webhook`. Cole o endereço.
3. O Clicksign mostra um **segredo**. Ele aparece **uma vez só**. Copie.
4. Volte ao CRM, cole o segredo no passo 2.
5. No passo 3, escolha para qual etapa o negócio deve ir quando o contrato for
   assinado. Pode deixar em "não mover" — aí a assinatura só fica registrada.
6. Salvar.

Pronto. O próximo contrato assinado aparece no CRM sem ninguém fazer nada.

### O segredo não é opcional

Enquanto não houver segredo salvo, o CRM aceita os avisos (é o que permite ligar
a integração antes de ter o segredo em mãos), mas quem descobrisse o endereço
poderia declarar um contrato assinado — e alguém começaria um projeto que não
foi vendido. Por isso a tela de Configurações mostra um aviso amarelo até o
segredo entrar.

---

## Como o CRM descobre de qual negócio é o contrato

Nesta ordem:

1. **Pela chave do documento**, se aquele documento já foi visto antes.
2. **Pelo e-mail de quem assina**: acha o contato e, dele, o negócio mais
   recente que não está perdido.

Quando não encontra ninguém, o aviso é **ignorado**, não adivinhado. Mover o
negócio errado faria alguém começar um projeto que não foi vendido — pior do que
não achar.

Se um contrato não caiu no negócio certo, o motivo quase sempre é o e-mail: o
signatário no Clicksign está com um e-mail que o contato do CRM não tem.

---

## O que cada evento do Clicksign faz aqui

| Evento no Clicksign | No CRM |
|---|---|
| `upload` | marca "aguardando" e guarda a data de envio |
| `sign` | registra a assinatura **daquela pessoa**, e segue aguardando |
| `auto_close` / `close` | **assinado** — move de etapa, se houver etapa escolhida |
| `refusal` | recusado |
| `cancel` / `deadline` | cancelado |

`sign` é assinatura de **uma** parte. Num contrato de duas, ele chega duas vezes
e o contrato ainda não está fechado. Quem fecha é `auto_close` (ou `close`).
Tratar `sign` como conclusão liberaria o projeto com o contrato assinado por um
lado só.

O CRM **não** marca o negócio como Ganho por conta própria: assinatura é fato,
"ganho" é decisão de quem vende. A etapa escolhida por você é o quanto de
automático existe aqui.

---

## Onde olhar depois

- **No negócio**: selo ao lado de GANHO/PERDIDO — "aguardando assinatura",
  "contrato assinado", "assinatura recusada". Passar o mouse mostra a data.
- **No histórico do negócio**: uma linha por evento, com o nome do arquivo.
- **Em Configurações → Integrações → Clicksign**: a lista "aguardando
  assinatura", em ordem de quem está esperando há mais tempo. É a resposta para
  "quem ainda não assinou?".
- **Último aviso recebido**: aparece no topo dessa mesma tela. Se a data está
  velha e você acabou de mandar um contrato, o webhook não está chegando.

---

## Quando não funciona

| O que você vê | O que é |
|---|---|
| Aviso amarelo "aceitos sem conferir a assinatura" | falta salvar o segredo |
| "Aviso do Clicksign recusado: assinatura não confere" | segredo errado ou colado com sobra. Gere outro webhook no Clicksign e cole o novo |
| Nada acontece, nem erro | o webhook não está chegando: confira o endereço no Clicksign |
| Chega, mas o negócio não muda | o e-mail do signatário não corresponde a nenhum contato |
