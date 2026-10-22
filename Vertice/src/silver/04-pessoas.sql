-- 04-pessoas.sql — o cadastro das pessoas e o timesheet semanal.

CREATE OR REFRESH MATERIALIZED VIEW colaboradores
COMMENT 'As 520 pessoas da Vértice: papel, senioridade, custo/hora, admissão e desligamento. Os 3 cadastros duplicados (COL0102, COL0257, COL0433, repetidos em CAIXA ALTA) foram resolvidos mantendo o cadastro com papel em minúsculas.'
AS
WITH ordenado AS (
  SELECT
    *,
    -- sujeira 16: o cadastro bom é o que tem o papel em minúsculas
    row_number() OVER (
      PARTITION BY colaborador_id
      ORDER BY CASE WHEN papel = lower(papel) THEN 0 ELSE 1 END
    ) AS n
  FROM lakehouse_vertice.bronze.colaboradores
)
SELECT
  colaborador_id,
  nome,
  papel,
  senioridade,
  CAST(custo_hora AS DECIMAL(10, 2))           AS custo_hora,
  to_date(nullif(trim(data_admissao), ''))     AS data_admissao,
  to_date(nullif(trim(data_desligamento), '')) AS data_desligamento
FROM ordenado
WHERE n = 1;

CREATE OR REFRESH MATERIALIZED VIEW apontamentos
COMMENT 'Timesheet semanal: horas disponíveis × horas apontadas por pessoa e projeto. semana = a sexta-feira da semana (semana_inicio + 4).'
AS
SELECT
  colaborador_id,
  projeto_id,
  to_date(semana_inicio)                     AS semana_inicio,
  date_add(to_date(semana_inicio), 4)        AS semana,
  CAST(horas_disponiveis AS DECIMAL(10, 2))  AS horas_disponiveis,
  CAST(horas_apontadas   AS DECIMAL(10, 2))  AS horas_apontadas
FROM lakehouse_vertice.bronze.apontamentos;
