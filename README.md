This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

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
