WITH status_90d AS (
  SELECT
    projeto_id,
    causa_bloqueio,
    dias_impacto,
    row_number() OVER (
      PARTITION BY projeto_id
      ORDER BY count(*) DESC, sum(dias_impacto) DESC
    ) AS rank_causa
  FROM lakehouse_vertice.gold.status_estruturado
  WHERE data_status >= date_sub(DATE'2026-10-16', 90)
    AND causa_bloqueio NOT IN ('sem_bloqueio', 'nao_reportado')
  GROUP BY projeto_id, causa_bloqueio, dias_impacto
),
causa_principal AS (
  SELECT projeto_id, causa_bloqueio AS causa_mais_frequente
  FROM status_90d
  WHERE rank_causa = 1
),
impacto_causas AS (
  SELECT
    projeto_id,
    coalesce(sum(CASE WHEN causa_bloqueio = 'falta_sre' THEN dias_impacto ELSE 0 END), 0.0) AS dias_impacto_falta_sre,
    coalesce(sum(CASE WHEN causa_bloqueio = 'rotatividade' THEN dias_impacto ELSE 0 END), 0.0) AS dias_impacto_rotatividade
  FROM lakehouse_vertice.gold.status_estruturado
  WHERE data_status >= date_sub(DATE'2026-10-16', 90)
  GROUP BY projeto_id
),
multa_por_projeto AS (
  SELECT
    e.projeto_id,
    coalesce(round(sum(
      e.valor * least(
        coalesce(datediff(e.data_entrega, e.data_prometida), datediff(DATE'2026-10-16', e.data_prometida)) * c.multa_atraso_pct_dia,
        c.teto_multa_pct
      ) / 100
    ), 2), 0.0) AS multa_a_cobrar
  FROM lakehouse_vertice.silver.entregas_fornecedor e
  JOIN lakehouse_vertice.gold.contratos c
    ON lower(trim(e.fornecedor)) = lower(trim(c.fornecedor))
  WHERE (e.em_atraso = true OR (e.data_entrega IS NULL AND e.data_prometida < DATE'2026-10-16'))
    AND e.data_prometida > add_months(c.data_fim_vigencia, -12)
    AND c.multa_atraso_pct_dia IS NOT NULL
  GROUP BY e.projeto_id
)
SELECT
  p.projeto_id,
  p.projeto,
  p.cliente,
  p.gerente_projeto,
  p.spi,
  p.cpi,
  p.estouro_previsto,
  p.atraso_projetado_dias,
  p.situacao,
  p.farol_do_gerente,
  p.farol_calculado,
  p.melancia,
  coalesce(cp.causa_mais_frequente, 'sem_bloqueio') AS causa_mais_frequente,
  coalesce(ic.dias_impacto_falta_sre, 0.0) AS dias_impacto_falta_sre,
  coalesce(ic.dias_impacto_rotatividade, 0.0) AS dias_impacto_rotatividade,
  coalesce(mp.multa_a_cobrar, 0.0) AS multa_a_cobrar
FROM lakehouse_vertice.gold.projeto_situacao_atual p
LEFT JOIN causa_principal cp ON p.projeto_id = cp.projeto_id
LEFT JOIN impacto_causas ic ON p.projeto_id = ic.projeto_id
LEFT JOIN multa_por_projeto mp ON p.projeto_id = mp.projeto_id
WHERE p.status = 'em_andamento'
ORDER BY p.spi ASC, p.estouro_previsto DESC;
