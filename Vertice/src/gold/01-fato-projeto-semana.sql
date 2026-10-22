-- 01-fato-projeto-semana.sql — lakehouse_vertice.gold.fato_projeto_semana: a EVOLUÇÃO de cada projeto.
-- Uma linha por projeto e semana (sexta-feira), da semana do início até 2026-10-16.
-- As três medidas do Earned Value, ACUMULADAS até a semana:
--   PV: valor planejado (quanto devia estar pronto, linear pelo baseline das tarefas)
--   EV: valor agregado (quanto está pronto: o último % do status semanal × orçamento)
--   AC: custo real acumulado (lançamentos de custos por semana, soma acumulada)

CREATE OR REFRESH MATERIALIZED VIEW lakehouse_vertice.gold.fato_projeto_semana (
  CONSTRAINT pv_nao_negativo EXPECT (pv >= 0) ON VIOLATION FAIL UPDATE,
  CONSTRAINT ev_nao_passa_orcamento EXPECT (ev <= orcamento * 1.0001) ON VIOLATION FAIL UPDATE
)
COMMENT 'Projeto × semana (sexta-feira): PV, EV, AC acumulados, SPI, CPI, EAC, farol do gerente e horas da equipe (disponíveis, apontadas, ociosas). Use para evolução e tendência. Hoje do dataset: 2026-10-16.'
AS
WITH semanas AS (
  SELECT
    projeto_id,
    orcamento,
    explode(sequence(date_add(date_trunc('WEEK', data_inicio), 4), DATE'2026-10-16', INTERVAL 1 WEEK)) AS semana
  FROM projetos
),
pv AS (
  SELECT
    s.projeto_id,
    s.semana,
    s.orcamento * SUM(t.horas * greatest(0, least(1,
      datediff(s.semana, t.inicio_baseline) / greatest(1, datediff(t.fim_baseline, t.inicio_baseline)))))
    / SUM(t.horas)                                                             AS pv
  FROM semanas s
  JOIN tarefas t ON t.projeto_id = s.projeto_id
  GROUP BY s.projeto_id, s.semana, s.orcamento
),
custo_semana AS (
  SELECT
    projeto_id,
    semana,
    SUM(valor) AS ac_semana
  FROM custos
  GROUP BY projeto_id, semana
),
horas_semana AS (
  SELECT
    projeto_id,
    semana,
    SUM(horas_disponiveis) AS horas_disponiveis,
    SUM(horas_apontadas)   AS horas_apontadas
  FROM apontamentos
  GROUP BY projeto_id, semana
),
juntos AS (
  SELECT
    s.projeto_id,
    s.semana,
    s.orcamento,
    pv.pv,
    st.pct_concluido,
    st.farol,
    SUM(coalesce(c.ac_semana, 0)) OVER w                       AS ac,
    coalesce(h.horas_disponiveis, 0)                           AS horas_disponiveis,
    coalesce(h.horas_apontadas, 0)                             AS horas_apontadas
  FROM semanas s
  JOIN pv USING (projeto_id, semana)
  LEFT JOIN status_semanal st ON st.projeto_id = s.projeto_id AND st.data_status = s.semana
  LEFT JOIN custo_semana c USING (projeto_id, semana)
  LEFT JOIN horas_semana h USING (projeto_id, semana)
  WINDOW w AS (PARTITION BY s.projeto_id ORDER BY s.semana)
),
acumulado AS (
  -- projeto concluído não publica mais status: o último % vale para as semanas seguintes
  SELECT
    *,
    coalesce(last_value(pct_concluido, true) OVER w, 0) AS pct_vigente,
    last_value(farol, true) OVER w                      AS farol_vigente
  FROM juntos
  WINDOW w AS (PARTITION BY projeto_id ORDER BY semana)
)
SELECT
  projeto_id,
  semana,
  year(semana)                                            AS ano,
  month(semana)                                           AS mes,
  CAST(orcamento AS DECIMAL(18, 2))                       AS orcamento,
  CAST(pv AS DECIMAL(18, 2))                              AS pv,
  CAST(orcamento * pct_vigente / 100 AS DECIMAL(18, 2))   AS ev,
  CAST(ac AS DECIMAL(18, 2))                              AS ac,
  pct_vigente                                             AS pct_concluido,
  ROUND(try_divide(orcamento * pct_vigente / 100, pv), 4) AS spi,
  ROUND(try_divide(orcamento * pct_vigente / 100, ac), 4) AS cpi,
  CAST(try_divide(orcamento, try_divide(orcamento * pct_vigente / 100, ac)) AS DECIMAL(18, 2)) AS eac,
  farol_vigente                                           AS farol_do_gerente,
  horas_disponiveis,
  horas_apontadas,
  greatest(horas_disponiveis - horas_apontadas, 0)        AS horas_ociosas
FROM acumulado;
