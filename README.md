This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

## Planos de Websites

`/planos/websites` e o catalogo de produtos proprios da Holding, sem acesso ao
banco do Glass ou do Barber. Permite cadastrar, editar e inativar confeccao de
websites, hospedagem, manutencao e alteracoes adicionais, com preco em reais,
descricao comercial e escopo obrigatorio. Confeccao e alteracoes sao cobrancas
unicas; hospedagem e manutencao possuem precos por ciclo mensal, trimestral,
semestral e anual no mesmo produto. Os precos sao os totais do periodo,
nao equivalentes mensais. Deixe em branco os ciclos nao oferecidos e escolha
um ciclo padrao preenchido. O catalogo inicia
vazio: nao ha precos comerciais presumidos.

Antes de usar, aplicar no banco da Holding a migration
`supabase/migrations/20261104180000_holding_website_plans.sql`.
Ela depende da migration de permissoes de 01/07/2026 e cria uma tabela com RLS,
sem acesso direto por anon/authenticated; a API usa service role somente apos
autenticacao administrativa e verificacao de `menu.planos` e
`submenu.planos.websites`. Administradores e o bootstrap sem perfis seguem a
convencao existente da Holding; outros perfis precisam das duas permissoes.

O catalogo nao cobra nem emite NFS-e ao salvar. A contratacao de projetos e
descrita abaixo. Edicoes e inativacoes nao propagam alteracoes a contratos ou
cobrancas. Nao ha exclusao de produtos.

Testes: `node --test scripts/tests/website-plans.test.mjs`.

## Clientes e contratacoes de Websites (Holding)

Aplicar **somente na Holding**, depois da migration do catalogo:
`supabase/migrations/20261104184500_holding_website_plan_fiscal.sql`, seguida de
`supabase/migrations/20261104190000_holding_website_contracts.sql` e
`supabase/migrations/20261104193000_holding_website_invoices.sql`.
Estas migrations nao foram aplicadas automaticamente e nao modificam Glass/Barber.
Ela cria `holding_customers`, `holding_website_contracts`,
`holding_website_installments` e a RPC transacional de contratacao. RLS e
revogacoes bloqueiam anon/authenticated; acesso somente via APIs administrativas.
Nao ha exclusao de contratos nem provisionamento de tenants/usuarios de outros sistemas.

Fluxo:

O acesso a plataforma fica em **791 Websites**, no sidebar, abaixo de **Cupons**,
separado de **Planos > Websites**. Aplicar somente na Holding a migration
`supabase/migrations/20261105170000_holding_websites_access.sql`.
Ela cadastra `menu.websites` e as permissoes de visualizar, criar e editar
websites/recursos da biblioteca. Os perfis ativos `Administrador` e `Dono`
(este somente quando `is_system`) recebem os recursos inicialmente, sem
sobrescrever revogacoes ja existentes.
Outros perfis devem recebe-los em **Configuracoes > Permissoes**, e ser
vinculados aos funcionarios em **Equipe**.

O menu e o endpoint `/api/admin/websites/access` exigem uma concessao explicita
de `menu.websites` em perfil ativo, com recurso ativo. Nao ha liberacao por
cargo, nome de perfil ou bootstrap sem perfis. O acesso abre nova aba e verifica
novamente a permissao antes de redirecionar. Falhas de consulta bloqueiam o acesso.
O login da equipe e centralizado na Holding. Aplicar tambem
`supabase/migrations/20261105180000_holding_websites_sso.sql` somente neste banco.
O menu abre diretamente a entrada na Websites em nova aba, evitando carregar
o painel da Holding antes de iniciar o login. A rota `/websites` e uma tela
isolada de autorizacao, sem sidebar nem carregamento do painel administrativo;
a API continua validando a sessao e as permissoes atuais antes de emitir o codigo.
O navegador inicia a entrada na Websites, que mantem state e verificador PKCE
em cookie HttpOnly host-only. A Holding valida a sessao autenticada e as
permissoes de menu/visualizacao e emite codigo de uso unico (90 segundos),
consumido atomicamente com S256. Senhas, access tokens e refresh tokens da
Holding nao sao enviados para a Websites. Nenhuma conta Auth e duplicada.

A Websites recebe uma sessao opaca de ate 8 horas e consulta a Holding no
servidor a cada operacao/imagem, sem cache de permissoes. Revogar menu,
visualizacao ou perfil ativo bloqueia o proximo acesso; criar/editar sao
independentes e controlam as respectivas operacoes. Funcionarios autorizados
trabalham nos projetos da agencia, nao nos bancos Glass/Barber. Clientes
continuam usando contas locais com RLS por projeto. A biblioteca ainda sera
implementada, usando essas mesmas permissoes.

Somente hashes de codigos/sessoes ficam nas tabelas internas. A sessao opaca
esta vinculada a `auth.sessions` da Holding: logout/revogacao dessa sessao
remove os acessos dependentes; usuario banido ou sessao expirada tambem e
recusado. Sair da Websites revoga apenas seu acesso opaco, sem sair da Holding.
Falhas de rede/banco nao liberam acesso. Registros expirados permanecem
inutilizaveis ate limpeza administrativa; nunca devem ser reutilizados.

A migration remove escrita direta anon/authenticated nas quatro tabelas
de permissoes. As APIs de alteracao exigem perfil ativo com
`action.permissions.manage_profiles` ou o perfil de sistema `Dono`;
nome de cargo e bootstrap nao concedem esse gerenciamento.
Na Railway da Websites, configurar `SUPABASE_SECRET_KEY` somente no servidor
com uma secret key do projeto exclusivo Websites. Nunca usar prefixo
`NEXT_PUBLIC_`, enviar essa chave a Holding ou usar a chave de outro projeto.
Validacao do menu e das permissoes:
`node --test scripts/tests/holding-websites-access.test.mjs scripts/tests/holding-commercial-ui.test.mjs`.
Testes do login: `node --test scripts/tests/holding-websites-sso.test.mjs`.

**Editar contratacao** permite ajustar produto, preco, entrada, parcelas,
vencimentos e forma de pagamento, mantendo o mesmo cliente. Aplicar antes
`supabase/migrations/20261105020000_holding_website_contract_edit.sql`.
Contratos com operacao fiscal reservada/emitida ou em processamento sao
bloqueados. Quando ja houve envio ao Asaas, a edicao consulta o ambiente
original, as referencias de entrada/saldo e cada pagamento vinculado:
somente libera se nao houver cobrancas ativas e os pagamentos anteriores
estiverem explicitamente excluidos e sem indicio de pagamento/estorno.
404, indisponibilidade ou ambiente divergente nao comprovam exclusao.
Nao exclui cobranças no Asaas. A revisao anterior e suas parcelas ficam
na tabela administrativa `holding_website_contract_edits`; o novo cronograma
fica somente na Holding e usa referencias Asaas com revisao propria quando
o administrador gerar novamente. Cliente/produto atuais atualizam os snapshots
ao salvar; assinatura recorrente conjunta nao e alterada. O cliente Asaas
vinculado e revalidado por documento e exclusao antes de emitir novamente.

1. Em **Clientes**, cadastrar nome/razao social, CPF/CNPJ valido, e-mail,
   contato e endereco fiscal. Um cadastro por documento, reutilizavel em varios
   projetos. O CPF/CNPJ nao pode mudar depois de salvo. Endereco fiscal pode
   estar completo antes de contratar para permitir emissao nacional.
2. Em **Assinaturas > Websites**, selecionar cliente ativo e produto ativo de
   cobranca unica (confeccao/alteracoes), definir preco total negociado, forma
   de pagamento, entrada opcional e de 1 a 12 parcelas mensais do saldo.
   Produtos de hospedagem/manutencao usam a tela **Assinaturas recorrentes**,
   acessivel na mesma pagina Websites; ver instrucoes abaixo.
3. Conferir a previa e **Salvar sem cobrar**. A RPC grava contrato e parcelas
   atomicamente; a chave de tentativa impede duplicacao no reenvio da mesma
   solicitacao. O contrato preserva nome/documento/e-mail/endereco do cliente e
   nome/descricao/escopo do produto na contratacao. Edicoes futuras no cadastro
   nao mudam esse historico.
4. **Gerar no Asaas** exige confirmacao explicita e usa `asaasApiKey` e
   `asaasEnv` de `system_settings/finance_api`, somente no servidor. Em
   producao sao cobrancas reais, sujeitas a notificacoes e taxas do Asaas.
   O ambiente precisa estar definido explicitamente; contratos/clientes ja
   vinculados a um ambiente nao sao reutilizados silenciosamente em outro.
5. **Consultar Asaas** recupera as cobrancas existentes e seus estados atuais,
   sem criar novas cobrancas ou novos clientes. Nao ha baixa automatica no
   financeiro nem emissao fiscal na consulta. Cancelamento/estorno deve ser
   feito no painel Asaas e conferido por nova consulta; divergencias/exclusoes
   exigem revisao administrativa, sem recriar pagamentos.

Pix/boleto usam o parcelamento Asaas com vencimentos mensais. No cartao, o
saldo e **uma compra parcelada**, nao varias compras mensais: o POST envia
`installmentCount` e `totalValue`, sem dados do cartao. O cliente informa os
dados na fatura hospedada pelo Asaas. A interface exibe o link de pagamento
do primeiro item do saldo, evitando sugerir varios pagamentos do mesmo
parcelamento no cartao. Se houver entrada, ela e um pagamento separado,
tambem com seu proprio link. Taxas/minimos/regras do provedor continuam
aplicaveis; nao ha juros comerciais adicionais configuraveis nesta etapa.
Datas sao ancoradas ao dia inicial, limitadas ao ultimo dia de cada mes; os
centavos restantes ficam na ultima parcela. Qualquer divergencia do provedor
em valor, cliente, referencia, metodo ou data bloqueia conciliacao automatica.

As referencias sao `website|<contrato_uuid>|deposit` e
`website|<contrato_uuid>|balance`. Nao usam `glass|`, `barber|` ou
`finance_record|`. Clientes Asaas existentes sao localizados pelo documento,
sem sobrescrever dados ou assinaturas existentes. Duplicidade de documento no
Asaas interrompe a emissao. O fluxo de cobrancas nao chama APIs/bancos de Glass
ou Barber, `PaymentProcessor` ou emissores NFS-e. Os dois webhooks legados receberam apenas
uma barreira de referencia Websites para nao encaminhar esses pagamentos ao
processador SaaS; o despacho de referencias Glass/Barber permanece igual e
possui testes de regressao. Nao alteramos o cadastro de webhooks no Asaas.

Emissao usa compare-and-set no contrato e no cliente, sem repetir POSTs.
Timeout, resposta ambigua, emissao parcial ou falha ao persistir geram
`review`. A consulta pode recuperar pagamentos ja criados; se faltarem itens,
o contrato permanece em revisao, sem completar cobrancas presumidas.
Processo interrompido abruptamente permanece em `processing`, bloqueando novas
emissoes: um administrador deve conferir o Asaas e os vinculos antes de
alterar esse estado no banco. Nao ha desbloqueio por tempo nem botao que
permita reemitir cegamente. Consultas de contratos emitidos tambem usam o
mesmo bloqueio para nao conciliar estados concorrentes fora de ordem.

Permissoes: `menu.clientes` para cadastro; `menu.assinaturas` e
`submenu.assinaturas.websites` para consultar contratos; criar/emitir/consultar
Asaas tambem exige `menu.clientes`. Administradores/bootstrap seguem a
convencao existente; demais perfis precisam receber os novos recursos.

Testes sem chamadas reais:
`node --test scripts/tests/website-plans.test.mjs scripts/tests/website-contracts.test.mjs scripts/tests/website-invoices.test.mjs scripts/tests/website-subscriptions.test.mjs scripts/tests/holding-commercial-ui.test.mjs`.
Banco PostgreSQL descartavel:
`PGLITE_MODULE=file:///caminho/node_modules/@electric-sql/pglite/dist/index.js node --test scripts/tests/website-contracts-db.integration.mjs`.
Esse teste cria somente tabelas ficticias em memoria; nao aponta para
producao. Fixtures visuais opcionais com markup React/CSS Tailwind reais:
definir `WEBSITE_UI_FIXTURE_DIR` para uma pasta temporaria existente ao executar
o teste de interface. Nenhuma cobranca real ou NFS-e e emitida pelos testes.

### Mascaras, consultas cadastrais e exclusao de clientes

Em **Clientes**, CPF/CNPJ, telefone (fixo/celular com DDD e opcional +55) e CEP
possuem mascaras de apresentacao; o banco continua recebendo os digitos
normalizados. E-mail usa campo `email` e validacao de formato no cliente e na
API (nao comprova a existencia da caixa postal).

Ao sair de **CPF / CNPJ** ou **CEP**, a consulta e automatica para numeros
completos e validos; nao consulta a cada tecla nem repete o mesmo numero ao
voltar ao campo. Funciona tambem ao usar TAB (inclusive quando o foco seguinte
e o botao de consulta) e ao editar um cadastro com CNPJ/CEP ja preenchidos.
Consultas automaticas preenchem somente campos vazios,
preservando edicoes feitas enquanto a resposta chega. Mudar documento/CEP,
cancelar ou fechar o formulario invalida respostas pendentes. Os botoes
continuam disponiveis para repetir explicitamente uma consulta.

**Consultar CPF / CNPJ** verifica os digitos localmente. Se ja existir cliente
na Holding, abre seu cadastro para edicao em vez de duplicar. Para CNPJ,
mediante confirmacao explicita, consulta a BrasilAPI e preenche razao social,
endereco e contatos disponiveis (a consulta automatica nao pede confirmacao;
a substituicao manual pelo botao continua pedindo). Se o CNPJ retornar CEP
valido e endereco incompleto, a API complementa os campos vazios pelo ViaCEP,
sem substituir os dados fornecidos pelo CNPJ. Falhas nessa complementacao e
campos ainda ausentes sao informados no formulario, mantendo os demais dados.
Numero do imovel e complemento nao podem ser deduzidos do CEP e devem ser
conferidos/preenchidos manualmente quando nao vierem no CNPJ.
**Consultar CEP** usa o ViaCEP e preenche
logradouro, bairro, municipio e UF, preservando numero/complemento. Confira
os dados antes de salvar; os campos continuam editaveis, e a consulta nao
comprova regularidade fiscal. CNPJ e CEP sao enviados apenas ao servico
respectivo por API administrativa autenticada (inclusive o CEP retornado pelo
CNPJ para completar o endereco); nao ha consultas durante a
digitacao nem alteracao de clientes/contratos/Asaas ao consultar. Os provedores
recebem `Accept: application/json` e `User-Agent` proprio da Holding, seguindo
o padrao do wizard Glass, sem chamar suas APIs nem alterar seu codigo.

CPF nunca e enviado a estes servicos. Apenas digitos verificadores sao
validados; nao existe integracao autorizada de consulta de nome/situacao
cadastral do CPF configurada. Para CPF novo, informar o nome manualmente.
Consultas indisponiveis/nao encontradas exibem erro e permitem preenchimento
manual; nunca retornam um cadastro ficticio ou silenciosamente valido.
Respostas HTML, vazias, JSON incompleto e falhas nativas do navegador sao
tratadas sem expor mensagens tecnicas do Safari. Sessao expirada, bloqueio
de acesso e limite de consultas recebem orientacoes especificas. A consulta
nao limpa campos manuais nem repete requisicoes automaticamente apos falhas.

Para habilitar **Excluir**, aplicar uma vez na Holding:
`supabase/migrations/20261104230000_holding_customer_delete.sql`.
Ela concede DELETE apenas ao service role. A API exige `menu.clientes`,
confirmacao ocorre na interface e as FKs NO ACTION de contratos/assinaturas
bloqueiam no banco qualquer cliente ja contratado, mesmo salvo sem cobrar,
inclusive sob concorrencia. Integracao de cliente em `processing` tambem
bloqueia a API. Pode-se inativar clientes contratados em vez de excluir.
Exclusao e somente local: nao apaga dados no Asaas, Glass ou Barber.

Testes:
`node --test scripts/tests/holding-customer-lookup.test.mjs scripts/tests/holding-commercial-ui.test.mjs scripts/tests/website-contracts.test.mjs`.

### Enquadramento fiscal por produto Websites

Cada produto tem tributacao nacional (6 digitos), municipal opcional (3
digitos), NBS (9 digitos), descricao fiscal, percentual aproximado de tributos
do Simples (`pTotTribSN`, entre 0 e 100) e confirmacao contabil. Os campos
comecam vazios, sem copiar os codigos de licenciamento Glass/Barber. Pode-se
salvar um rascunho fiscal incompleto; para confirmar exigem-se tributacao
nacional, NBS, descricao e percentual. Alterar um campo desmarca a confirmacao. Validar o
formato dos codigos nao comprova que o enquadramento e correto.

A contratacao preserva uma copia desses dados no `plan_snapshot`; editar o
produto nao reclassifica contratos existentes. A politica e manual
pelo valor total para projetos, independente de pagamento, e automatica apos
pagamento para servicos recorrentes. Entrada bancaria nao determina receita
tributavel: emprestimos, aportes e transferencias nao sao gatilhos de NFS-e.
Confirmar dados no catalogo nao emite nota. O emissor nacional existente de licenciamento
nao foi alterado; nao houve mudanca em `nfse_config`, `system_plans` ou Asaas fiscal.

### NFS-e manual de projetos Websites

Em **Assinaturas > Websites**, **Emitir NFS-e** exige competencia, validacao
previa e confirmacao explicita de producao. Emite **uma nota pelo total do
projeto**, mesmo antes do pagamento, sem usar o valor de parcelas ou entradas
bancarias. A API exige tambem `menu.notas_fiscais`. Usa o certificado/emitente
da Holding e os componentes genericos de XML, assinatura e envio nacional,
sem acessar tenants. Os codigos e o percentual informativo vem exclusivamente
do snapshot do produto no contrato, nunca dos codigos de licenciamento.
O percentual informado deve estar vigente na competencia e confirmado com a
contabilidade; nao calcula automaticamente anexos/fator R para estes servicos
e nao representa aliquota de ISS. O fluxo suporta o regime ME/EPP do Simples
ja parametrizado no XML nacional, com ISS nao retido e prestacao no municipio
do emitente. Nao use para operacoes com outro tratamento tributario. Esta
versao so aceita competencias/emissoes de 2026; 2027 requer revisao IBS/CBS.
Contratos com fiscal/endereco incompletos sao bloqueados, sem completar dados
silenciosamente a partir de cadastros alterados.

A reserva transacional `holding_reserve_website_invoice` usa uma chave unica
por contrato em `holding_website_invoices`, independentemente da competencia.
Compartilha atomicamente a sequencia da serie ja usada pelo mesmo emitente,
sem alterar o emissor Glass/Barber. Previa nao reserva numero nem envia DPS.
Resultado oficial e persistido antes do historico `system_invoices`;
`nfse_producao_website_<contrato>` permite que a receita fiscal da mesma
Holding seja contabilizada uma unica vez, inclusive se o historico visual
falhar. Isso nao cria lancamento bancario/receita financeira.

Timeouts, rejeicoes ou interrupcoes deixam a operacao reservada ou em revisao,
sem reenvio automatico. Conferir a DPS no portal nacional antes de qualquer
correcao administrativa; nao apagar reservas ou reiniciar a sequencia.
Autorizacao com falha local tambem bloqueia nova nota. Cancelamento, se
necessario, usa o historico fiscal/portal, nunca outra emissao pelo contrato.

O campo `cTribMun` **continua no XSD nacional como opcional** (`minOccurs=0`),
nao foi abolido: preencher o complemento de 3 digitos somente quando exigido.
Fonte oficial: [documentacao atual da NFS-e nacional](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual),
pacote `nfse-esquemas_xsd-v1-01-20260209.zip`.

### Nome fantasia dos clientes

Aplicar somente na Holding a migration
`supabase/migrations/20261105010000_holding_customer_trade_name.sql`
antes de publicar a atualizacao do cadastro. O nome fantasia e opcional,
editavel e preenchido pela consulta CNPJ quando a BrasilAPI o disponibiliza.
A consulta automatica preserva valores manuais; ausencia de nome fantasia
na fonte nao copia a razao social nem apaga um nome ja preenchido.
Razao social continua sendo o nome fiscal enviado ao Asaas e a NFS-e.
Contratos e assinaturas existentes nao sao alterados.

### Transicao de leiaute nacional e bloqueio de 2027

O gerador compartilhado seleciona o leiaute pelo **ambiente e instante de
emissao**, nao pela competencia: producao usa NT004 ate 30/11/2026 e NT009
release 1 a partir de 01/12/2026, 00:00 em Brasilia. Homologacao ja usa NT009.
Isso corrige tres diferencas do XML: posicao de `finNFSe`, ordem de
`xDescServ`/`cNBS` e classificacao `CST`/`cClassTrib` dentro ou fora de
`gIBSCBS`. Nao altera codigos fiscais, enquadramento, cobrancas, regras de
provisionamento ou calculo do Simples dos produtos existentes.

**2027 permanece bloqueado**, inclusive emissao em 2027 para competencia de
2026. A NT009 v1.01 preve `regApIBSCBSSN` (apuracao de IBS/CBS) e `cAtvSN`
(atividade no Simples), alem de outras alteracoes. Esses dois campos ainda
nao constam no XSD de homologacao de 20/10/2026 consultado nesta revisao.
Nao adicionar campos de minuta ao leiaute vigente nem presumir apuracao no
Simples ou regime regular. A liberacao depende de definicao da contabilidade
por atividade, revisao do pacote oficial efetivamente implantado e testes
em producao restrita, com autorizacao antes de usar certificado real.
Contratos ja salvos nao recebem novas regras fiscais silenciosamente.

Validacao local: o XML passa no XSD original de homologacao de 20/10/2026.
O pacote de producao de 09/02/2026 tem o pattern de serie
`^0{0,4}\d{1,5}$`, rejeitado pelo `xmllint` para a serie numerica `1`.
Essa limitacao do schema/validador nao e contornada alterando o XML ou o
XSD oficial; por isso, o teste estrutural local nao certifica autorizacao
em producao. Nenhuma nota ou cobranca real e necessaria para estes testes.

Fontes oficiais:
- [Implantacao gradual da NT009 e data de producao](https://www.gov.br/nfse/pt-br/noticias/cgnfs-e-informa-disponibilizadas-no-ambiente-de-testes-o-release-1-das-evolucoes-da-nota-tecnica-009).
- [NT009 v1.01, secao 2.4: evolucoes para o Simples](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc/nota-tecnica-009-se-cgnfs-e-v-1-01.pdf).
- [Pacotes oficiais de producao restrita](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/producao-restrita).

### Assinaturas recorrentes Websites e precos personalizados

Aplicar **uma vez, somente na Holding**, depois das tres migrations acima:
`supabase/migrations/20261104220000_holding_website_subscriptions.sql`.
Ela preserva os precos existentes, convertendo cada produto recorrente para
uma tabela inicialmente com apenas o seu ciclo/preco atual, sem presumir
descontos ou inventar valores dos outros ciclos. Nao reaplicar o SQL anterior.
Nao modifica planos, tabelas ou configuracoes Glass/Barber.

1. Em **Planos > Websites**, preencher os precos totais dos ciclos oferecidos
   (mensal, trimestral, semestral, anual) e o enquadramento fiscal confirmado.
2. Em **Assinaturas > Websites > Assinaturas recorrentes**, selecionar cliente,
   produto e ciclo. O preco do catalogo e sugerido, mas **Valor personalizado
   por periodo** pode ser editado livremente na contratacao. Isso nao edita o
   catalogo nem contratos de outros clientes. O ciclo, preco sugerido, preco
   negociado, endereco e fiscal ficam preservados no contrato.
3. Confirmar as condicoes tributarias e salvar sem cobrar. A RPC e atomica e
   impede repetir a mesma chave de tentativa com outros dados.
4. **Ativar no Asaas** exige confirmacao e gera uma assinatura independente
   (`MONTHLY`, `QUARTERLY`, `SEMIANNUALLY`, `YEARLY`). Pix/boleto geram cobrancas
   que o cliente paga a cada periodo; nao sao debito automatico nem Pix
   Automatico. Cartao e informado na fatura hospedada do Asaas; a Holding nao
   coleta nem armazena cartao/token. O comportamento de renovacao do cartao e
   sujeito a autorizacao do Asaas/cliente.
5. Os webhooks existentes `/api/webhooks/asaas` e `/api/webhooks/payments`
   encaminham estas assinaturas para um processador Websites proprio, nunca
   para `PaymentProcessor`. E necessario manter o webhook da Holding ativo
   no Asaas com eventos `PAYMENT_CONFIRMED` e `PAYMENT_RECEIVED`.
   Nao ha registro/alteracao automatica do webhook compartilhado nesta entrega.
6. Cada pagamento e reconsultado com a chave da Holding. Exigem-se assinatura
   vinculada, ambiente, cliente, referencia (quando presente), ciclo e valor
   compativeis. Nao sao aceitos parcelamentos ou valores alterados no Asaas.
   Quando a referencia nao vem na cobranca, identifica-se pelo ID da assinatura;
   assinaturas Websites ainda sem vinculo local nao caem no fluxo SaaS.
7. Apenas `CONFIRMED`/`RECEIVED`, nao excluidos e em producao, geram NFS-e
   nacional automaticamente. `RECEIVED_IN_CASH` nao dispara este fluxo.
   Competencia: primeira `confirmedDate` valida (ou `paymentDate` quando
   ausente), preservada no banco mesmo se houver aviso posterior de recebimento.
   Valor: **total negociado do periodo**, inclusive anual, sem deduzir taxas
   Asaas e sem emitir notas mensais fracionadas de uma anuidade.
8. **Consultar Asaas** nunca cria outra assinatura, mas reconsulta cobrancas e
   pode emitir notas de pagamentos confirmados ainda sem reserva fiscal.
   A interface avisa isso antes da consulta. Notas reservadas/em revisao jamais
   sao reenviadas automaticamente; alertas fiscais ficam visiveis por cobranca.
   Esta consulta tambem recupera pagamentos quando uma notificacao foi perdida.

`holding_website_subscriptions` e `holding_website_subscription_payments` tem
RLS e acesso somente por service role; APIs exigem as permissoes Websites,
Clientes e, para criar/ativar/conciliar com emissao, Notas Fiscais.
Referencia isolada: `website-subscription|<uuid>`. Clientes Asaas existentes
nao sao sobrescritos. Locks compare-and-set e estados `processing`/`review`
impedem repetir POST apos timeout; recuperacao e por leitura, nunca por nova
criacao presumida. Interrupcao abrupta exige revisao administrativa.

O mesmo emissor/certificado e sequencia da Holding sao usados com origem fiscal
exclusiva por pagamento em `holding_website_invoices`. A chave unica impede
notas duplicadas entre webhooks, consultas e competencias diferentes.
Outra cobranca para o mesmo vencimento da assinatura exige revisao, evitando
emitir duas notas do mesmo periodo. Historico/controlador fiscal continuam
deduplicados na receita da Holding, sem lancamento bancario automatico.
Sandbox nao emite nota real. Pagamentos de 2027 ficam com erro fiscal visivel,
sem reserva/envio, ate a revisao IBS/CBS do emissor compartilhado.

Pausa, reativacao e encerramento sao feitos na Holding, conforme abaixo.
Estornos/chargebacks recebidos pelo webhook (se cadastrados nos eventos) ou
detectados pela consulta geram alerta para revisar eventual nota autorizada,
sem cancelamento/reemissao automatica.

Documentacao Asaas:
[criacao de assinatura](https://docs.asaas.com/docs/creating-a-subscription),
[eventos de pagamento](https://docs.asaas.com/docs/payment-events),
[FAQ de assinaturas](https://docs.asaas.com/docs/subscriptions-faq).

### Criacao com assinatura opcional e interrupcao Websites

Aplicar **uma vez, somente na Holding**, depois da migracao de recorrencias:
`supabase/migrations/20261105000000_holding_website_bundle_lifecycle.sql`.
Ela adiciona o vinculo entre projeto e assinatura, os estados de interrupcao
e uma RPC de contratacao conjunta. Nao reaplicar as migracoes anteriores.

Em **Assinaturas > Websites > Nova contratacao**, a criacao continua
obrigatoria. Marcar **Incluir hospedagem / manutencao nesta contratacao**
adiciona um produto recorrente opcional para o mesmo cliente. Escolher
mensal/trimestral/semestral/anual dentre os ciclos oferecidos, personalizar o
total por periodo, informar primeiro vencimento e forma de pagamento da
assinatura e confirmar o fiscal. Ambos sao salvos na mesma transacao:
falha na assinatura desfaz o projeto/parcelas, e repetir a mesma tentativa
nao duplica nem permite trocar os termos. Retirar/adicionar a assinatura a uma
tentativa ja salva tambem exige abrir uma nova contratacao.

Salvar nao envia nada ao Asaas. O projeto continua com **Gerar no Asaas** e
NFS-e manual no valor total. A assinatura aparece em **Assinaturas recorrentes**,
com link ao projeto, ativacao explicita e NFS-e por pagamento confirmado.
Valores, periodicidade e fiscal ficam preservados separadamente. Assinaturas
avulsas continuam disponiveis na tela de recorrencias.

Na assinatura, com confirmacao explicita e permissoes Websites/Clientes/Notas:

- **Pausar**: envia somente `status: INACTIVE` ao Asaas (PUT), interrompendo
  novas cobrancas sem cancelar pendentes/vencidas. Pode reativar depois.
- **Reativar**: exige novo proximo vencimento atual/futuro e envia
  `status: ACTIVE`, `nextDueDate` e `updatePendingPayments: false`.
  Nao altera vencimentos/valores das cobrancas existentes.
- **Encerrar assinatura**: inativa no Asaas e marca como encerrada na Holding.
  Bloqueia reativacao pela Holding e preserva todas as cobrancas, inclusive
  pendentes/vencidas. **Nao usa DELETE Asaas**, pois este excluiria pendencias.
  Reativacao externa de uma assinatura encerrada e sinalizada na consulta;
  exige inativar no painel antes de conciliar.

Para assinatura ainda local, esses controles nao acessam o Asaas. Pausada ou
encerrada nao pode ser ativada; reativar uma local apenas atualiza o primeiro
vencimento e permite ativacao explicita posterior.
Esses controles gerenciam a recorrencia financeira: nao desligam o site,
dominio ou hospedagem automaticamente, nem alteram Glass/Barber.

A alteracao remota e exclusiva por compare-and-set. Intencao e data de
reativacao ficam persistidas antes do PUT. Timeout/falha deixa revisao com
acao pendente, sem repeticao automatica. **Consultar Asaas** confirma
status/proximo vencimento e conclui a intencao; se o remoto nao corresponder,
permanece em revisao para acerto no painel. Interrupcao abrupta em
`processing` exige revisao administrativa, como na geracao de cobrancas.
Cobrancas anteriores que sejam pagas depois de pausar/encerrar continuam
recebendo NFS-e conforme as regras fiscais existentes.

Referencia de comportamento:
[suspensao/reativacao Asaas](https://docs.asaas.com/reference/update-existing-subscription)
e [diferenca para exclusao definitiva](https://docs.asaas.com/reference/remove-subscription).

## Comprovante REP-P centralizado (somente homologacao)

O servidor precisa de Node.js 22 ou superior (dependencias de assinatura).

O A1 existente em `system_settings/nfse_config` (`pfxBase64`, `passphrase`,
`prestador_cnpj`) e reutilizado **somente no servidor da holding** para
assinar os novos PDFs. Nao e duplicado no Glass, nos tenants ou na tabela
de comprovantes. O cadastro fiscal e seu formato de armazenamento nao foram
alterados nesta entrega. A substituicao do certificado nesse cadastro passa
a valer nas novas emissoes; PDFs ja persistidos sao devolvidos sem reemitir
ou substituir sua assinatura. Os A1 fiscais dos tenants sao independentes.

`GET /api/rep-p/homologacao/[id]` aceita o JWT do proprio trabalhador no
Glass, valida a sessao e chama `rh_ponto_comprovante_snapshot` **com esse JWT**.
O banco do Glass resolve empresa, pessoa, usuario e permissao; a holding nao
aceita PDF, CPF, empregador ou hash fornecidos pelo chamador. Suporte e
outros trabalhadores/tenants nao recebem o original. GPS nao integra o PDF.

O PDF contem os campos do art. 79, inclusive INPI, NSR e hash original,
e a faixa **HOMOLOGACAO - SEM VALIDADE COMO PONTO OFICIAL**. A assinatura
CMS usa SHA-256, atributo SigningCertificateV2 e subfilter
`ETSI.CAdES.detached`; os testes verificam ByteRange, integridade e assinatura
com OpenSSL, usando A1 sintetico. Valida-se senha, correspondencia entre
chave/certificado, titular CNPJ, validade e uso digitalSignature.
**Isso nao comprova cadeia ICP-Brasil, revogacao ou conformidade integral
PAdES/politica brasileira.** Essas verificacoes independentes, politica de
assinatura e requisitos de preservacao a longo prazo continuam pendentes.
O A1 real foi usado em 03/11/2026, com autorizacao, exclusivamente pelo
servidor da holding em um teste integrado do tenant de homologacao.
PFX, senha e chave privada nao foram exportados para testar. Somente o PDF
assinado foi verificado independentemente com Node e OpenSSL: assinatura,
digest e vinculo ao certificado validos; adulteracao rejeitada. O proxy
Glass recuperou os mesmos bytes persistidos. Isso nao valida a cadeia
ICP-Brasil nem substitui verificacao de revogacao/politica PAdES.

Requisitos antes de um teste controlado:

- Aplicar com autorizacao a migration
  `20261103173000_rep_p_comprovantes_homologacao.sql` na holding e as migrations
  do ponto, incluindo `20261103173000_rh_ponto_comprovante_snapshot.sql`, no Glass.
- Definir `REP_P_INPI` no formato original `BR51XXXXXXXXXX-X`, conferido
  contra o registro do software. O PDF preserva esse identificador; o campo
  numerico de 17 posicoes do AFD nao define o formato do comprovante PDF.
- Definir `REP_P_HOMOLOGACAO_ENABLED=true` **em ambos** os servidores e
  `REP_P_HOLDING_URL=https://dominio-da-holding` no Glass.
- Manter `finance_api` apontando para o projeto Glass correto; o helper existente
  preserva suas chamadas administrativas sem JWT, mas a rota de comprovante
  fornece explicitamente o JWT do trabalhador (nunca cai para service role).

Por padrao a rota retorna 503; nao existe flag de operacao oficial. Os
comprovantes de homologacao sao gravados atomicamente com chave unica por
marcacao na tabela privada `rep_p_comprovantes_homologacao`. Falha ao persistir
nao entrega um PDF como se tivesse sido emitido. Emissao concorrente recupera
o primeiro original persistido. Leitura e insercao sao somente service role
da holding, apos autorizacao da marcacao no Glass; alteracao/exclusao/truncate
sao bloqueados. Nenhuma alteracao em emissao NFS-e, financeiro ou A1 dos tenants.

As migrations acima foram aplicadas com autorizacao em 03/11/2026.
As variaveis de homologacao foram configuradas nos dois servidores em
03/11/2026 e o teste integrado com A1 real passou. O registro de teste no Glass
continua restrito a uma allowlist administrativa e a operacao oficial segue
bloqueada; nao ha autoliberacao de outros tenants.

Testes: `node --test scripts/tests/rep-p.test.mjs`.
Banco nativo descartavel, com cluster `791glass-rh-isolated`, usuario
`ponto_test`, banco vazio `holding_repp_test` e socket Unix privado:
`RH_TEST_PG_SOCKET=/caminho/socket node scripts/tests/rep-p-db.integration.mjs /caminho/node_modules/pg`.
Nao apontar esses testes para producao.

## Extrato do Inter

A importacao do Inter permanece bloqueada enquanto o acesso e a conciliacao nao
forem validados com a conta real. Ela exige tanto `sync_enabled` na conta como
`BANK_INTER_IMPORT_ENABLED=true` no servidor. Nao habilite nenhum dos dois apenas
porque o token OAuth foi emitido; o extrato e o saldo ainda precisam responder.
O painel distingue o bloqueio no servidor da habilitacao da conta.

No extrato, a opcao "+ Nova classe / subclasse" abre um popup sem perder os
rascunhos. A lista mostra cada classe uma vez, com suas subclasses recuadas
como filhas, sem repetir o nome da classe em cada opcao.
E possivel criar uma classe, uma subclasse de classe existente ou
as duas juntas (em uma unica insercao atomica). O tipo acompanha o lancamento.
O cadastro fica selecionado na linha; a classificacao so ocorre ao clicar em
Salvar. Essa criacao nao habilita uso em webhook.
As regras aprendidas ficam recolhidas ao abrir o extrato; clique no titulo
"Regras aprendidas" para expandir ou ocultar a lista. Os campos e botoes de
"A classificar" ficam centralizados verticalmente em cada linha.

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
O horario de emissao usa Brasilia (`-03:00`, holding em Sao Jose/SC em 2026),
como os eventos de cancelamento, preservando o instante com uma folga de
30 segundos para pequenas diferencas de relogio com o Sefin, independentemente
do fuso do servidor. Nao altera a competencia. O XML e a data de emissao
enviados sao preservados tambem nas falhas, para comparar com o horario
de processamento devolvido pelo Sefin. A rejeicao explicita E0008 da mesma
DPS em homologacao fica como `rejeitada` e permite um novo envio manual com
o mesmo numero/serie, protegido por reserva atomica. O registro antigo
`verificar_no_portal` so e liberado quando contem a resposta estruturada
E0008 ou E0239 correspondente. A DPS inclui o endereco nacional do tomador
do cadastro Glass (rua, numero, complemento, bairro e CEP). O municipio e
identificado na lista local oficial do IBGE da UF cadastrada, sem consulta
externa durante a emissao nem presumir o municipio da prestacao.
Atualizar a lista: `node scripts/atualizar-municipios-nfse.mjs`.
Cadastro
incompleto ou municipio nao identificado bloqueia o envio antes da reserva.
A rejeicao E0239 tambem permite corrigir o cadastro e repetir a mesma DPS.
Timeout, retorno incerto e nota autorizada continuam
bloqueando reenvios; nao ha repeticao automatica.
O painel identifica a etapa da falha e o HTTP quando a resposta nao e JSON,
sem exibir HTML do servidor como documento fiscal. Consultar o resultado salvo
preserva a mensagem da tentativa atual e identifica o registro como historico,
para nao confundir uma rejeicao antiga com uma nova tentativa.

### Producao nacional e Simples nas assinaturas

Competencias desde 01/11/2026 sao encaminhadas ao Emissor Nacional de producao
pela emissao automatica do pagamento Asaas e pela emissao manual. Se a configuracao
nacional estiver desativada ou o enquadramento nao confirmado, a operacao falha
explicitamente, fica visivel no historico e NAO retorna a IPM. A assinatura paga
continua sendo ativada. Competencias anteriores conservam a IPM.
Em Configuracoes > NFS-e, "Emissao nacional de producao" permite confirmar
o enquadramento, habilitar o emissor e editar receitas externas e folha por mes.
O painel principal mostra o calculo, a fonte de folha e os dados de emissao.
Declaracoes e ajustes mensais ficam recolhidos; a declaracao manual sem folha
so aparece quando nao ha fonte financeira selecionada. IPM fica em "Legado
municipal", sem apagar credenciais nem alterar notas antigas; homologacao fica
em "Ferramentas tecnicas" e so e montada ao expandir. Certificado A1, dados do
prestador e controles gerais de ambiente/emissao continuam disponiveis.
Nao ativar enquanto houver divergencia fiscal (por exemplo, Anexo III versus V).

O escopo automatico e licenciamento (010501/111032200), Simples ME/EPP,
ISS dentro do regime, sem retencao, em 2026, com pelo menos 12 meses de atividade.
O local da prestacao e o estabelecimento do emissor configurado; o endereco
nacional do tomador e informado separadamente para a tributacao IBS/CBS.
Excedentes ConsultFlex, receita proporcionalizada de inicio de atividade,
regime de caixa, outros enquadramentos, sublimite superior a R$ 3.600.000
e competencias de 2027 sao bloqueados para parametrizacao especifica.

O percentual aproximado usa a aliquota efetiva dos Anexos III/V:
`(RBT12 * aliquota nominal - parcela a deduzir) / RBT12`.
O fator R usa receita dos 12 meses anteriores e folha/encargos efetivamente pagos;
Em NFS-e, a fonte opcional de folha financeira seleciona uma classe principal
de despesa e inclui suas subclasses automaticamente. Apenas lancamentos pagos
entram, pela `metadata.fator_r_data_pagamento` (campo "Pagamento real da folha"
no Financeiro) ou `metadata.settlement.settled_at` na baixa. Nao se presume a
data de criacao/vencimento como pagamento. Datas ausentes, valores invalidos e
duplicidade de transacao bancaria bloqueiam a apuracao. Registre remuneracoes
BRUTAS e encargos patronais/FGTS elegiveis separados; nao duplique retencoes
ja incluidas no bruto nem inclua beneficios, lucros ou despesas nao elegiveis.
O sistema nao verifica a elegibilidade contabil da subclasse pelo nome.
A fonte automatica substitui a folha manual (nao soma ambas), atualiza o fator R
antes de cada previa/emissao e congela os IDs/valores da folha na nota.
Receita permanece nas notas fiscais mais os ajustes externos declarados,
sem somar novamente recebimentos bancarios. Atualize/reconcilie receitas sem
nota: faturamento fiscal nao e necessariamente toda a receita contabil.
sem folha a simulacao de licenciamento segue o Anexo V, nao presume 6%.
Notas reais autorizadas do sistema entram por competencia; homologacao,
canceladas e duplicatas nao entram. Resultados nacionais persistidos fora do
historico visual tambem entram sem dupla contagem. Receitas sem nota/externas
e folha precisam ser declaradas no historico; aportes/emprestimos nao sao receita.
Se forem declaradas ausencia de folha e de receitas externas, a janela avanca
mensalmente sem preenchimento manual de zeros; a declaracao deve ser atualizada
se a realidade mudar. Caso contrario, o historico exige valores completos e
confirmacao ate o ultimo mes da janela, sem presumir receita/folha zero.
Cancelamento que nao extinguiu receita exige ajuste fiscal no historico.
Os dados e o calculo usados ficam congelados em cada emissao.
Isso NAO apura/transmite PGDAS-D, DAS, folha nem substitui a apuracao fiscal.

Sequencia de DPS por serie e ambiente de producao usa reserva atomica em
`system_settings/nfse_sequencia_producao_*`. Cada operacao tem reserva unica
`nfse_producao_*`, alem da reserva Asaas existente. Resultado incerto bloqueia
reenvio; numero nunca e inventado para repetir uma operacao. A previa nao reserva
numero, nao envia nem grava receita. Emissao manual exige referencia unica.
As telas Holding/Glass recebem `nfse_oficial_xml` e `documento_oficial`,
mantendo a representacao interna e o download do XML; o original e o nacional.
Notas antigas nao sao convertidas ou reemitidas. A consulta IPM ignora notas
nacionais; o botao oficial informa quando usa XML ja salvo, sem alegar nova consulta.

Validacao: `node --test scripts/tests/nfse-producao.test.mjs scripts/tests/nfse-nacional.test.mjs scripts/tests/nfse-cancelamento.test.mjs scripts/tests/nfse-homologacao-form.test.mjs`.
Referencias fiscais: [diretriz do emissor nacional](https://www.gov.br/nfse/pt-br/noticias/nfs-e-informa-diretrizes-sobre-a-obrigatoriedade-da-emissao-da-nfs-e-nacional-para-optantes-do-simples-nacional)
e [Portal do Simples Nacional](https://www8.receita.fazenda.gov.br/SimplesNacional/).

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
