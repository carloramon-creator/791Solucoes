-- Amplia o CHECK de funcao do consumo de IA para incluir a análise financeira do 791glass.
alter table ai_usage_events drop constraint if exists ai_usage_events_funcao_check;
alter table ai_usage_events add constraint ai_usage_events_funcao_check
    check (funcao = any (array['credito.validacao', 'credito.analise', 'estoque.analise', 'financeiro.custos', 'financeiro.analise']));
