-- 01-projetos.sql — o cadastro do PMO.
-- É o de-para da integração: (ferramenta, codigo_ferramenta) diz em qual
-- planilha / lista do ClickUp / XML do Project mora cada projeto.

CREATE OR REFRESH MATERIALIZED VIEW projetos (
  CONSTRAINT data_inicio_valida EXPECT (data_inicio IS NOT NULL) ON VIOLATION FAIL UPDATE,
  CONSTRAINT ferramenta_valida  EXPECT (ferramenta IN ('excel', 'clickup', 'msproject')) ON VIOLATION FAIL UPDATE
)
COMMENT 'Cadastro dos 60 projetos do PMO (cliente, segmento, contrato, orçamento, prazos, gerente). É o de-para da integração: ferramenta + codigo_ferramenta apontam para a planilha Excel, a lista do ClickUp ou o XML do MS Project de cada projeto.'
AS
SELECT
  projeto_id,
  nome_projeto,
  cliente,
  segmento,
  tipo_projeto,
  -- sujeira 2: a ferramenta veio escrita de 8 jeitos
  CASE
    WHEN lower(ferramenta) LIKE '%excel%' OR lower(ferramenta) LIKE '%xls%' OR lower(ferramenta) LIKE '%planilha%' THEN 'excel'
    WHEN lower(ferramenta) LIKE '%click%' THEN 'clickup'
    WHEN lower(ferramenta) LIKE '%project%' OR lower(ferramenta) LIKE '%msp%' THEN 'msproject'
  END                                                   AS ferramenta,
  ferramenta                                            AS ferramenta_como_veio,
  -- sujeira 3: código vazio vira NULL (a tarefa casa pelo arquivo / nome da lista)
  nullif(trim(codigo_ferramenta), '')                   AS codigo_ferramenta,
  CAST(valor_contrato  AS DECIMAL(18, 2))               AS valor_contrato,
  CAST(orcamento_custo AS DECIMAL(18, 2))               AS orcamento_custo,
  -- sujeira 1: data em yyyy-MM-dd e em dd/MM/yyyy
  coalesce(try_to_date(data_inicio, 'yyyy-MM-dd'),
           try_to_date(data_inicio, 'dd/MM/yyyy'))       AS data_inicio,
  coalesce(try_to_date(data_fim_baseline, 'yyyy-MM-dd'),
           try_to_date(data_fim_baseline, 'dd/MM/yyyy')) AS data_fim_baseline,
  status,
  gerente_projeto
FROM lakehouse_vertice.bronze.projetos;
