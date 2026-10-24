-- Contratos de Fornecedores — Pipeline de Extração com IA
-- Executar: python3 scripts/run_sql.py aulas/aula-04-engenheiro-ia/meu-agente/01-contratos.sql --profile DEFAULT
--
-- Este arquivo cria:
--   a) silver.documentos_elementos — elementos brutos extraídos dos PDFs
--   b) silver.contratos_clausulas  — cláusulas estruturadas, uma linha cada
--   c) SELECT de demonstração do ai_extract sem schema
--   d) gold.contratos              — ÚNICA tabela gold nova; campos tipados via ai_extract v2.0
--   e) Consultas de negócio: multa a cobrar e aviso prévio por fornecedor
--
-- Fonte: /Volumes/lakehouse_vertice/bronze/raw/documentos/contratos/ (8 PDFs)
-- Hoje (para cálculo de multa e aviso prévio): DATE'2026-10-16'

-- ============================================================
-- a) silver.documentos_elementos
--    Lê os 8 PDFs com read_files (binaryFile), chama ai_parse_document
--    e usa posexplode para desnormalizar cada elemento.
--    Tipos possíveis: title, section_header, text, page_header, page_footer, etc.
-- ============================================================

CREATE OR REPLACE TABLE lakehouse_vertice.silver.documentos_elementos
COMMENT 'Elementos extraídos dos PDFs de contrato de fornecedor via ai_parse_document (v2.0).
Cada linha é um bloco de conteúdo (title, section_header, text, etc.) de um contrato.
Coluna "documento" é o nome do arquivo sem extensão e sem o prefixo "contrato_".
Fonte: /Volumes/lakehouse_vertice/bronze/raw/documentos/contratos/'
AS
WITH pdfs AS (
  SELECT
    regexp_extract(path, '/([^/]+)\\.pdf$', 1) AS documento,
    ai_parse_document(content, map('version', '2.0'))  AS parsed
  FROM read_files(
    '/Volumes/lakehouse_vertice/bronze/raw/documentos/contratos/',
    format => 'binaryFile'
  )
)
SELECT
  documento,
  elem.pos AS ordem,
  elem.value:type::STRING    AS tipo,
  elem.value:content::STRING AS conteudo
FROM pdfs,
     LATERAL variant_explode(parsed:document:elements) AS elem
WHERE is_variant_null(parsed:error_status) OR parsed:error_status IS NULL;

-- ============================================================
-- b) silver.contratos_clausulas
--    Uma linha por cláusula: usa last_value(IGNORE NULLS) para propagar
--    o section_header "CLÁUSULA N - TÍTULO" a cada bloco de texto seguinte.
--    O fornecedor é extraído da linha que contém "CONTRATADA:".
-- ============================================================

CREATE OR REPLACE TABLE lakehouse_vertice.silver.contratos_clausulas
COMMENT 'Uma linha por cláusula de contrato de fornecedor.
clausula_numero (INT) e titulo vêm do section_header "CLÁUSULA N - TÍTULO".
texto é a concatenação de todos os blocos "text" dessa seção.
fornecedor é a empresa após "CONTRATADA:" no corpo do documento.
Fonte: silver.documentos_elementos.'
AS
WITH com_secao AS (
  SELECT
    documento,
    ordem,
    tipo,
    conteudo,
    -- propaga o último section_header que é uma cláusula
    last_value(
      CASE
        WHEN tipo = 'section_header'
         AND upper(conteudo) RLIKE '^CL.?USULA\\s+\\d+'
        THEN conteudo
      END,
      true
    ) OVER (
      PARTITION BY documento
      ORDER BY ordem
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS header_secao
  FROM lakehouse_vertice.silver.documentos_elementos
),
fornecedor_por_doc AS (
  SELECT DISTINCT
    documento,
    first_value(
      trim(regexp_replace(regexp_extract(conteudo, '(?s)CONTRATADA:\\s*(.+)', 1), '[\\r\\n]+', ' '))
    ) OVER (PARTITION BY documento ORDER BY ordem) AS fornecedor
  FROM lakehouse_vertice.silver.documentos_elementos
  WHERE conteudo LIKE '%CONTRATADA:%'
),
clausulas_agg AS (
  SELECT
    documento,
    header_secao,
    CAST(regexp_extract(header_secao, '(?i)CL.?USULA\\s+(\\d+)', 1) AS INT) AS clausula_numero,
    trim(regexp_extract(header_secao, '(?i)CL.?USULA\\s+\\d+\\s*[-–]\\s*(.+)', 1)) AS titulo,
    concat_ws(' ', collect_list(conteudo)) AS texto
  FROM com_secao
  WHERE tipo = 'text'
    AND header_secao IS NOT NULL
  GROUP BY documento, header_secao
)
SELECT
  c.documento,
  coalesce(f.fornecedor, c.documento) AS fornecedor,
  c.clausula_numero,
  c.titulo,
  c.texto
FROM clausulas_agg c
LEFT JOIN fornecedor_por_doc f USING (documento)
ORDER BY c.documento, c.clausula_numero;

-- ============================================================
-- c) DEMONSTRAÇÃO: ai_extract SEM JSON schema
--    Retorna texto livre (não campos tipados). A turma vê a diferença
--    em relação ao bloco (d) que usa schema tipado.
--    Executa em apenas 3 contratos para ser rápido.
-- ============================================================

SELECT
  documento,
  fornecedor,
  ai_extract(
    left(texto_contrato, 3000),
    '["objeto", "valor_anual", "data_fim_vigencia", "multa_atraso_pct_dia"]'
  ) AS extracao_sem_schema
FROM (
  SELECT
    documento,
    fornecedor,
    concat_ws('\n', collect_list(
      concat('CLÁUSULA ', clausula_numero, ' - ', titulo, ':\n', texto)
    )) AS texto_contrato
  FROM lakehouse_vertice.silver.contratos_clausulas
  GROUP BY documento, fornecedor
  LIMIT 3
);

-- ============================================================
-- d) gold.contratos — ÚNICA tabela nova na gold
--    ai_extract com JSON schema tipado (version 2.0).
--    Campos lidos com :response:campo::TIPO.
--    Guarda também "clausulas" = texto completo de todas as cláusulas,
--    com "CLÁUSULA N - TÍTULO:" na frente de cada uma.
-- ============================================================

DROP TABLE IF EXISTS lakehouse_vertice.gold.contratos;

CREATE TABLE lakehouse_vertice.gold.contratos
COMMENT 'Uma linha por contrato de fornecedor da Vértice Tecnologia.
Campos extraídos dos PDFs via ai_extract com JSON schema tipado (version 2.0).
Hoje = DATE''2026-10-16'' para cálculo de multa e aviso prévio.
A Vértice é a CONTRATANTE; multa é valor que a Vértice COBRA do fornecedor.
Coluna "clausulas" traz o texto integral de todas as cláusulas formatadas.
Fonte: silver.contratos_clausulas → /Volumes/lakehouse_vertice/bronze/raw/documentos/contratos/'
AS
WITH clausulas_ordenadas AS (
  SELECT *
  FROM lakehouse_vertice.silver.contratos_clausulas
  ORDER BY documento, clausula_numero
),
texto_completo AS (
  SELECT
    documento,
    fornecedor,
    -- clausulas: texto integral formatado, que o Genie pode citar
    concat_ws('\n\n', collect_list(
      concat('CLÁUSULA ', clausula_numero, ' - ', coalesce(titulo, ''), ':\n', texto)
    )) AS clausulas
  FROM clausulas_ordenadas
  GROUP BY documento, fornecedor
),
extraido AS (
  SELECT
    documento,
    fornecedor,
    clausulas,
    ai_extract(
      clausulas,
      '{
        "objeto":               {"type": "string",  "description": "Objeto do contrato em português"},
        "valor_anual":          {"type": "number",  "description": "Valor anual do contrato em reais brasileiros"},
        "data_fim_vigencia":    {"type": "string",  "description": "Data de término da vigência no formato AAAA-MM-DD"},
        "renovacao_automatica": {"type": "boolean", "description": "true se o contrato é renovado automaticamente"},
        "aviso_previo_dias":    {"type": "integer", "description": "Número de dias de aviso prévio para não renovação"},
        "multa_atraso_pct_dia": {"type": "number",  "description": "Percentual de multa por dia de atraso sobre o valor da entrega. Nulo se não há cláusula de multa por atraso."},
        "teto_multa_pct":       {"type": "number",  "description": "Teto máximo de multa acumulada em percentual do valor da entrega"},
        "sla":                  {"type": "string",  "description": "Descrição do SLA previsto no contrato em português"},
        "reajuste":             {"type": "string",  "description": "Cláusula de reajuste do contrato em português"}
      }',
      map('version', '2.0')
    ) AS extracao
  FROM texto_completo
)
SELECT
  documento,
  fornecedor,
  clausulas,
  extracao:response:objeto::STRING               AS objeto,
  extracao:response:valor_anual::DOUBLE          AS valor_anual,
  to_date(
    extracao:response:data_fim_vigencia::STRING,
    'yyyy-MM-dd'
  )                                              AS data_fim_vigencia,
  extracao:response:renovacao_automatica::BOOLEAN AS renovacao_automatica,
  extracao:response:aviso_previo_dias::INT        AS aviso_previo_dias,
  extracao:response:multa_atraso_pct_dia::DOUBLE  AS multa_atraso_pct_dia,
  extracao:response:teto_multa_pct::DOUBLE        AS teto_multa_pct,
  extracao:response:sla::STRING                  AS sla,
  extracao:response:reajuste::STRING             AS reajuste,
  extracao:error_message::STRING                 AS erro_extracao
FROM extraido;

-- ============================================================
-- e1) Consulta de negócio: multa a cobrar por fornecedor
--     Regras:
--       - entrega em atraso: em_atraso = true OU entregue tarde (data_entrega > data_prometida)
--         OU em aberto vencida (data_entrega IS NULL E data_prometida < hoje)
--       - dias de atraso: até data_entrega (se entregue) ou até hoje
--       - multa = valor × least(dias × multa% ao dia, teto%) / 100
--       - só entregas dentro da vigência atual:
--         data_prometida > add_months(data_fim_vigencia, -12)
-- ============================================================

SELECT
  c.fornecedor,
  e.item,
  e.projeto_id,
  e.data_prometida,
  e.data_entrega,
  coalesce(
    datediff(e.data_entrega,    e.data_prometida),
    datediff(DATE'2026-10-16',  e.data_prometida)
  )                                              AS dias_atraso,
  e.valor,
  c.multa_atraso_pct_dia                        AS multa_pct_dia,
  c.teto_multa_pct                              AS teto_pct,
  round(
    e.valor
    * least(
        coalesce(
          datediff(e.data_entrega,   e.data_prometida),
          datediff(DATE'2026-10-16', e.data_prometida)
        ) * c.multa_atraso_pct_dia,
        c.teto_multa_pct
      )
    / 100,
    2
  )                                              AS `multa_calculada_r$`
FROM lakehouse_vertice.silver.entregas_fornecedor e
JOIN lakehouse_vertice.gold.contratos c
  ON lower(trim(e.fornecedor)) = lower(trim(c.fornecedor))
WHERE
  -- entregue com atraso ou em aberto vencida
  (e.em_atraso = true
   OR e.data_entrega > e.data_prometida
   OR (e.data_entrega IS NULL AND e.data_prometida < DATE'2026-10-16'))
  -- só entregas na vigência atual (últimos 12 meses do contrato)
  AND e.data_prometida > add_months(c.data_fim_vigencia, -12)
  -- só contratos com cláusula de multa
  AND c.multa_atraso_pct_dia IS NOT NULL
ORDER BY `multa_calculada_r$` DESC;

-- ============================================================
-- e2) Consulta de negócio: aviso prévio por fornecedor
--     Mostra a data limite para notificar o fornecedor de não renovação.
--     Dias negativos = prazo já passou.
-- ============================================================

SELECT
  fornecedor,
  data_fim_vigencia,
  renovacao_automatica,
  aviso_previo_dias,
  date_sub(data_fim_vigencia, aviso_previo_dias) AS data_limite_aviso,
  datediff(
    date_sub(data_fim_vigencia, aviso_previo_dias),
    DATE'2026-10-16'
  )                                              AS dias_ate_prazo
FROM lakehouse_vertice.gold.contratos
ORDER BY data_limite_aviso;
