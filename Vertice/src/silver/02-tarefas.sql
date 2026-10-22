-- 02-tarefas.sql — AS TRÊS FERRAMENTAS VIRAM UMA.
-- Uma visão temporária por ferramenta, todas com as MESMAS colunas, e um
-- UNION ALL numa materialized view. É aqui que mora a integração.

-- ---------------------------------------------------------------------------
-- Excel: 20 planilhas, tudo texto.
-- ---------------------------------------------------------------------------
CREATE TEMPORARY VIEW tarefas_excel AS
WITH bruto AS (
  SELECT
    x.*,
    -- de-para pelo nome do arquivo; se não casar (código vazio ou arquivo sem
    -- acento), o PRJ-xxx do próprio nome do arquivo (sujeira 3)
    coalesce(p.projeto_id, regexp_extract(x.arquivo, 'PRJ-[0-9]{3}', 0)) AS projeto,
    nullif(trim(x.inicio_previsto), '')  AS ini_b,
    nullif(trim(x.termino_previsto), '') AS fim_b,
    nullif(trim(x.inicio_real), '')      AS ini_r,
    nullif(trim(x.termino_real), '')     AS fim_r,
    nullif(trim(x.pct_concluido), '')    AS pct
  FROM lakehouse_vertice.bronze.excel_tarefas x
  LEFT JOIN projetos p
    ON p.ferramenta = 'excel' AND p.codigo_ferramenta = x.arquivo
  WHERE x.tarefa <> 'TOTAL'          -- sujeira 6: a linha de TOTAL da planilha
)
SELECT
  projeto                                       AS projeto_id,
  'excel'                                       AS ferramenta,
  CAST(id AS STRING)                            AS id_na_ferramenta,
  fase,
  tarefa,
  responsavel,
  -- sujeira 4: com '/' é dd/MM/yyyy; senão é número de série do Excel
  CASE WHEN ini_b LIKE '%/%' THEN to_date(ini_b, 'dd/MM/yyyy')
       ELSE date_add(DATE'1899-12-30', CAST(CAST(ini_b AS DOUBLE) AS INT)) END AS inicio_baseline,
  CASE WHEN fim_b LIKE '%/%' THEN to_date(fim_b, 'dd/MM/yyyy')
       ELSE date_add(DATE'1899-12-30', CAST(CAST(fim_b AS DOUBLE) AS INT)) END AS fim_baseline,
  CASE WHEN ini_r LIKE '%/%' THEN to_date(ini_r, 'dd/MM/yyyy')
       ELSE date_add(DATE'1899-12-30', CAST(CAST(ini_r AS DOUBLE) AS INT)) END AS inicio_real,
  CASE WHEN fim_r LIKE '%/%' THEN to_date(fim_r, 'dd/MM/yyyy')
       ELSE date_add(DATE'1899-12-30', CAST(CAST(fim_r AS DOUBLE) AS INT)) END AS fim_real,
  -- sujeira 5: '45%' / '10,5%' (tira o % e troca a vírgula) ou 0.45 (fração × 100)
  CASE WHEN pct LIKE '%\%%' THEN CAST(replace(replace(pct, '%', ''), ',', '.') AS DOUBLE)
       ELSE CAST(replace(pct, ',', '.') AS DOUBLE) * 100 END              AS pct_como_veio,
  -- sujeira 7: horas '40h'
  CAST(replace(horas_previstas, 'h', '') AS DOUBLE)                      AS horas,
  CAST(NULL AS STRING)                                                   AS status_na_ferramenta
FROM bruto;

-- ---------------------------------------------------------------------------
-- ClickUp: 25 listas, datas em milissegundos, % e baseline em custom_fields.
-- ---------------------------------------------------------------------------
CREATE TEMPORARY VIEW tarefas_clickup AS
SELECT
  -- de-para pelo list_id; se o código faltar, pelo nome da lista (sujeira 3)
  coalesce(pc.projeto_id, pn.projeto_id)                                  AS projeto_id,
  'clickup'                                                               AS ferramenta,
  c.id                                                                    AS id_na_ferramenta,
  filter(c.custom_fields, f -> f.name = 'Fase')[0].value                  AS fase,
  c.name                                                                  AS tarefa,
  c.assignees[0].username                                                 AS responsavel,
  -- sujeira 8: datas em ms; % e baseline dentro de custom_fields
  to_date(timestamp_millis(CAST(nullif(filter(c.custom_fields, f -> f.name = 'Início baseline')[0].value, '') AS BIGINT))) AS inicio_baseline,
  to_date(timestamp_millis(CAST(nullif(filter(c.custom_fields, f -> f.name = 'Fim baseline')[0].value, '') AS BIGINT)))    AS fim_baseline,
  to_date(timestamp_millis(CAST(nullif(c.start_date, '') AS BIGINT)))     AS inicio_real,
  to_date(timestamp_millis(CAST(nullif(c.date_done, '') AS BIGINT)))      AS fim_real,
  CAST(filter(c.custom_fields, f -> f.name = 'Progresso (%)')[0].value AS DOUBLE) AS pct_como_veio,
  c.time_estimate / 3600000.0                                             AS horas,
  -- sujeira 9: status escrito de 12 jeitos
  CASE
    WHEN lower(trim(c.status.status)) IN ('done', 'concluído', 'concluido', 'closed', 'complete', 'completed') THEN 'concluida'
    WHEN lower(trim(c.status.status)) IN ('to do', 'todo', 'backlog', 'a fazer', 'open') THEN 'a_fazer'
    ELSE 'em_andamento'   -- in progress, em andamento, review, doing
  END                                                                     AS status_na_ferramenta
FROM lakehouse_vertice.bronze.clickup_tarefas c
LEFT JOIN projetos pc
  ON pc.ferramenta = 'clickup' AND pc.codigo_ferramenta = c.list_id
LEFT JOIN projetos pn
  ON pn.ferramenta = 'clickup' AND pn.codigo_ferramenta IS NULL AND pn.nome_projeto = c.list_name;

-- ---------------------------------------------------------------------------
-- MS Project: 15 XML. As tarefas-resumo somam as de baixo; a fase é a última
-- tarefa-resumo de OutlineLevel 1 antes da tarefa.
-- ---------------------------------------------------------------------------
CREATE TEMPORARY VIEW tarefas_msproject AS
WITH com_fase AS (
  -- sujeira 11: a janela roda em TODAS as linhas (inclusive resumos), antes do filtro
  SELECT
    m.*,
    last_value(CASE WHEN m.OutlineLevel = 1 THEN m.Name END, true)
      OVER (PARTITION BY m.arquivo ORDER BY m.UID) AS fase_calc
  FROM lakehouse_vertice.bronze.msproject_tarefas m
)
SELECT
  p.projeto_id,
  'msproject'                                                AS ferramenta,
  CAST(t.UID AS STRING)                                      AS id_na_ferramenta,
  t.fase_calc                                                AS fase,
  t.Name                                                     AS tarefa,
  CAST(NULL AS STRING)                                       AS responsavel,
  to_date(t.Baseline.Start)                                  AS inicio_baseline,
  to_date(t.Baseline.Finish)                                 AS fim_baseline,
  to_date(t.ActualStart)                                     AS inicio_real,
  to_date(t.ActualFinish)                                    AS fim_real,
  CAST(t.PercentComplete AS DOUBLE)                          AS pct_como_veio,
  -- sujeira 12: horas em 'PT40H0M0S'
  CAST(regexp_extract(t.Work, 'PT([0-9]+)H', 1) AS DOUBLE)   AS horas,
  CAST(NULL AS STRING)                                       AS status_na_ferramenta
FROM com_fase t
LEFT JOIN projetos p
  ON p.ferramenta = 'msproject' AND p.codigo_ferramenta = t.arquivo
WHERE t.Summary = 0;                 -- sujeira 10: fora as tarefas-resumo

-- ---------------------------------------------------------------------------
-- A tabela única.
-- ---------------------------------------------------------------------------
CREATE OR REFRESH MATERIALIZED VIEW tarefas (
  CONSTRAINT achou_o_projeto   EXPECT (projeto_id IS NOT NULL)            ON VIOLATION FAIL UPDATE,
  CONSTRAINT pct_entre_0_e_100 EXPECT (pct_concluido BETWEEN 0 AND 100)   ON VIOLATION FAIL UPDATE,
  CONSTRAINT horas_positivas   EXPECT (horas > 0)                         ON VIOLATION FAIL UPDATE
)
COMMENT 'Todas as tarefas dos 60 projetos num modelo só: as planilhas Excel, as listas do ClickUp e os XML do MS Project integrados pelo de-para de silver.projetos. Uma linha por tarefa (sem linhas de TOTAL nem tarefas-resumo), com baseline, real, % concluído (limitado a 100, com flag de quando veio acima) e horas previstas.'
AS
WITH unidas AS (
  SELECT * FROM tarefas_excel
  UNION ALL
  SELECT * FROM tarefas_clickup
  UNION ALL
  SELECT * FROM tarefas_msproject
)
SELECT
  concat_ws('-', projeto_id, ferramenta, id_na_ferramenta) AS tarefa_id,
  projeto_id,
  ferramenta,
  id_na_ferramenta,
  fase,
  tarefa,
  responsavel,
  inicio_baseline,
  fim_baseline,
  inicio_real,
  fim_real,
  pct_como_veio,
  least(pct_como_veio, 100)                                AS pct_concluido,
  coalesce(pct_como_veio > 100, false)                     AS pct_veio_acima_de_100,
  horas,
  status_na_ferramenta
FROM unidas;
