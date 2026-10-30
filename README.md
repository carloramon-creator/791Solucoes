This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

## Extrato do Inter

A importacao do Inter permanece bloqueada enquanto o acesso e a conciliacao nao
forem validados com a conta real. Ela exige tanto `sync_enabled` na conta como
`BANK_INTER_IMPORT_ENABLED=true` no servidor. Nao habilite nenhum dos dois apenas
porque o token OAuth foi emitido; o extrato e o saldo ainda precisam responder.
O painel distingue o bloqueio no servidor da habilitacao da conta.

O cliente usa mTLS e o escopo `extrato.read`. Informe a conta completa, incluindo
o digito, tanto nas configuracoes financeiras quanto no cadastro bancario usado
para o cabecalho `x-conta-corrente`. Registrar o webhook usa os valores atuais
do formulario, mas nao salva suas alteracoes: use "Salvar Credenciais". A consulta
divide periodos superiores a 90 dias e verifica a paginacao; identificadores
ausentes ou repetidos, valores invalidos e respostas incompletas interrompem
a importacao em vez de gerar lancamentos presumidos. O identificador precisa ser
estavel na resposta real, e mudancas de data ou valor de um ID ja importado
interrompem a sincronizacao para conferencia.

O banco processa lotes atomicos e idempotentes. Se houver lancamentos pagos ou
pendentes nao vinculados de mesmo tipo e valor na conta (ou sem conta definida),
independentemente da data, a movimentacao fica em revisao sem alterar saldo.
Sem correspondencias, o lancamento pago e criado e fica para classificacao ou
recebe uma regra existente. Na revisao, o usuario pode vincular ao lancamento
ou confirmar a criacao de outro. Lancamentos de cartao e metadados com vinculo
inconsistente exigem ajuste antes do vinculo. Dados incompletos ou invalidos
de tipo, situacao ou valor tambem sao mantidos para conferencia. Ao vincular um
pendente, a baixa continua manual; ao vincular um pago sem conta, a atribuicao
a conta do Inter pode alterar os saldos. Alterar valor, conta, tipo ou excluir
um lancamento vinculado devolve a movimentacao a revisao. A baixa parcial de um
vinculo Inter e gravada junto com o saldo restante em uma unica transacao. A
comparacao conservadora reduz o risco de duplicidade, mas nao comprova que duas
movimentacoes sejam iguais. Lancamentos manuais criados depois ou ao mesmo tempo
da importacao ainda podem exigir conferencia.

Testes do cliente e sincronizacao: `node --test scripts/tests/inter-statement.test.mjs`.
Para testar tambem a migracao em PostgreSQL isolado, instale
`@electric-sql/pglite` fora do projeto e informe o caminho do modulo:
`PGLITE_MODULE=file:///caminho/node_modules/@electric-sql/pglite/dist/index.js node --test scripts/tests/inter-reconciliation.integration.mjs`.
Os testes de banco usam somente dados ficticios em memoria; nao apontam para producao.
Para testar concorrencia real, instale `embedded-postgres` 17 fora do projeto e use
`EMBEDDED_POSTGRES_MODULE=file:///caminho/node_modules/embedded-postgres/dist/index.js node --test scripts/tests/inter-reconciliation-concurrency.integration.mjs`.
Esse teste cria e encerra uma instancia local temporaria com dados ficticios.

## NFS-e da holding para os tenants

As visualizacoes da Holding e do Glass usam os campos textuais do XML oficial,
sem recalcular valores nem presumir retencoes, regime ou IBS/CBS. A impressao
e identificada como representacao do sistema; o link do documento original e
o download do XML ficam separados. Se um dado estiver apenas no PDF oficial,
ele nao e inventado na representacao. Sem XML completo, a nota nao e montada
a partir do cadastro ou dos dados enviados.

Na Holding, "Consultar documento oficial" consulta a IPM e preserva o XML em
`system_invoices.metadata.nfse_oficial_xml`, com a projecao de campos em
`documento_oficial`. A sincronizacao de situacao tambem preserva esses dados
quando a prefeitura retorna o documento completo; mesmo uma resposta resumida
continua atualizando cancelamentos e informa a indisponibilidade do XML completo.
O Glass le os dados salvos pela Holding, mantendo o isolamento do tenant.

### Homologacao nacional, sem mudanca automatica de producao

Em Configuracoes > NFS-e, o painel "Emissor Nacional" permite pre-visualizar
a DPS sem enviar, e enviar um teste somente apos confirmacao explicita.
A API exige administrador da Holding. O escopo e ME/EPP no Simples, ISS dentro
do regime unico, operacao tributavel sem retencao, em 2026. Outros regimes,
retencoes e a tributacao de 2027 exigem implementacao/parametrizacao posterior.
Nao se deduz CRT, percentual do Simples, NBS ou codigo nacional a partir do
codigo municipal antigo; confirmar com contador e parametros municipais.

DPS 1.01 segue o pacote de producao restrita publicado em 20/10/2026, com
`finNFSe`, identificador completo, assinatura, GZip/Base64, mTLS com validacao
de TLS e POST para Sefin Nacional (nao para o ADN). Resposta HTTP 200 so e
tratada como autorizacao se contiver chave e XML da mesma DPS, emitente e
ambiente. Os testes nao entram em `system_invoices` nem no financeiro.
Tentativas ficam em `system_settings` com prefixo `nfse_homologacao_DPS...`,
reservadas antes do envio para impedir duplicacao concorrente. Uma falha de
rede pode esconder autorizacao: consultar no portal antes de tentar novamente,
sem mudar numero apenas para repetir a mesma operacao. O resultado salvo
pode ser recuperado pelo painel com municipio, serie e numero.

O fluxo IPM atual, inclusive emissao automatica, NAO foi migrado para producao
nacional nesta etapa. A ativacao antes de 01/11/2026 depende de homologacao
real com A1 e de tratar separadamente as notas historicas IPM. Passar no XSD
e nos testes locais nao comprova autorizacao pelo fisco.

### Cancelamento de NFS-e (evento nacional e101101)

Decisao manual do administrador, apos avaliar pedido de estorno ou cancelamento
de assinatura. Nao aciona estorno no Asaas. Em Notas Fiscais, o botao de
cancelar (notas autorizadas) pede motivo (1 erro na emissao, 2 servico nao
prestado, 9 outros) e justificativa de 15 a 255 caracteres, que vai ao fisco.
`POST /api/system/invoices/{id}/cancelar` monta `pedRegEvento` 1.01
(`Id = PRE + chave + 101101`), assina com o A1, envia GZip/Base64 com mTLS para
`{Sefin}/nfse/{chave}/eventos` e so marca `cancelled` se o evento devolvido
for desta chave. Grava em `metadata.cancelamento` quem, quando, motivo,
justificativa e XML do evento; recusa do fisco fica em
`metadata.cancelamento_ultima_falha` e a nota continua autorizada. Erro E0840
(evento ja vinculado) marca a nota como cancelada.

Notas IPM (sem chave nacional) nao sao enviadas: a tela orienta cancelar no
portal da prefeitura (ate 7 dias da emissao) e sincronizar. Fora do prazo o
cancelamento e por processo na prefeitura
(https://saojose.sc.gov.br/cancelamento-nota-fiscal/). No Emissor Nacional o
prazo e parametrizado pelo municipio; se recusado, seguir o mesmo processo.
Testes de homologacao podem ser cancelados no painel nacional
(`POST /api/notas-fiscais/homologacao-nacional/cancelar?id=DPS...`).

Fontes oficiais:
- https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/apis-prod-restrita-e-producao
- https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/producao-restrita
- https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/producao-restrita/esquemas_prod_restrita_20261020.zip

Testes: `node --test scripts/tests/nfse-nacional.test.mjs`.
Para validar tambem o XSD, baixe e extraia o pacote oficial sem altera-lo e
execute `NFSE_XSD_DIR=/caminho/extraido node --test scripts/tests/nfse-nacional.test.mjs`.
Esse teste usa certificado ficticio gerado localmente, verifica a assinatura
e executa `xmllint`; nao usa certificado real nem envia notas.

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
# 791Solucoes
## Consumo de IA por tenant

Em Assinaturas, **Consumo de IA** abre `/assinaturas/consumo-ia`.
Filtros por periodo (dias de Brasilia, ate 366 dias), tenant e funcao.
O resumo soma todo o periodo; detalhes tem paginas de 50 chamadas,
com data/hora, modelo, tentativa, status e tokens de entrada/saida/total.
Validacao de credito OpenAI tambem consome tokens e aparece separadamente.
Custos/DRE esta previsto como funcao, mas ainda nao possui chamadas no Glass.

Dados sao gravados pelo servidor do 791glass em `ai_usage_events`, no
banco da Holding. Nao armazena chaves, prompts, respostas ou dados de
clientes. Tokens nao informados aparecem como desconhecidos; nao ha
reconstrucao de consumo anterior a implantacao.
Custos estimados em US$ aparecem por chamada, tenant, funcao e mes,
com media por chamada e por operacao e custo das tentativas extras.
Uma operacao agrupa tentativas da mesma analise; validacoes sao separadas.
Media por operacao usa somente operacoes inteiramente precificadas.
Meses respeitam Brasilia e o periodo filtrado, sem extrapolar meses parciais.
Tarifas sao salvas no evento no inicio da chamada e nao mudam com novas
versoes de preco. Entrada em cache e cobrada separadamente, sem duplicacao.
Sem tarifa ou contagens suficientes, custo permanece nulo e e identificado
como nao calculado. A soma mostra apenas custos conhecidos, nao o saldo
oficial da OpenAI, impostos ou a cobranca do cartao.
Tarifa inicial GPT-4o mini e snapshot 2024-07-18 (por milhao de tokens):
entrada US$0.15, cache US$0.075, saida US$0.60, conferida em 13/10/2026:
https://developers.openai.com/api/docs/models/gpt-4o-mini
Outros modelos/providers ficam sem custo ate terem tarifa cadastrada.
Novas tarifas usam novas linhas com `vigente_desde` em `ai_model_prices`;
nao atualizar linhas antigas nem reprecificar eventos historicos.
Tabela e RPC sao restritas ao service role; a API exige autenticacao
administrativa seguindo o guard existente da Holding.
Migration: `supabase/migrations/20261013_ai_usage_events.sql` (aplicar
individualmente, sem push de migrations nao relacionadas).
Migration de custos: `supabase/migrations/20261013_ai_usage_costs.sql`,
aplicada depois da migration de eventos.
Testes: `node --test scripts/tests/ai-usage.test.mjs`.
SQL transacional de validacao: `scripts/tests/ai-usage.rollback.sql`.
Custos: `scripts/tests/ai-usage-costs.rollback.sql` (tambem com rollback).
