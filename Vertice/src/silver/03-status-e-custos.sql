-- 03-status-e-custos.sql — o status de toda sexta e o custo real.

CREATE OR REFRESH MATERIALIZED VIEW status_semanal (
  CONSTRAINT farol_valido EXPECT (farol IN ('verde', 'amarelo', 'vermelho')) ON VIOLATION FAIL UPDATE
)
COMMENT 'Status semanal (toda sexta) de cada projeto: % concluído e farol declarados pelo gerente e o texto livre com entregas e bloqueios. status_vazio marca os textos sem conteúdo (vazio, N/A, ver ata da reunião), que são mantidos.'
AS
SELECT
  projeto_id,
  to_date(data_status)                         AS data_status,
  gerente,
  lower(trim(farol))                           AS farol,           -- sujeira 17
  CAST(pct_concluido AS INT)                   AS pct_concluido,
  texto_status,
  -- sujeira 18: NÃO descartar; só sinalizar
  coalesce(trim(texto_status), '') IN ('', 'N/A', 'ver ata da reunião') AS status_vazio
FROM lakehouse_vertice.bronze.status_semanal;

CREATE OR REFRESH MATERIALIZED VIEW custos
COMMENT 'Lançamentos de custo real dos projetos (pessoal, consultoria, cloud, licenças, despesas). Valor líquido: os estornos (negativos) ficam e são sinalizados em estorno. semana = a sexta-feira da semana do lançamento.'
AS
WITH tipado AS (
  SELECT
    lancamento_id,
    projeto_id,
    to_date(data)                                      AS data,
    categoria,
    descricao,
    -- sujeira 13: vírgula decimal; replace ANTES do CAST (try_cast perderia R$ 5,4 mi)
    CAST(replace(valor, ',', '.') AS DECIMAL(18, 2))   AS valor,
    centro_custo
  FROM lakehouse_vertice.bronze.custos
)
SELECT
  lancamento_id,
  projeto_id,
  data,
  date_add(date_trunc('WEEK', data), 4)  AS semana,      -- sexta da semana
  categoria,
  descricao,
  valor,
  valor < 0                              AS estorno,     -- sujeira 14: fica
  centro_custo
FROM tipado;
