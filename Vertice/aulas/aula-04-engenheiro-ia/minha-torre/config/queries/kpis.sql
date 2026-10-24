WITH multa AS (
  SELECT
    coalesce(round(sum(
      e.valor * least(
        coalesce(datediff(e.data_entrega, e.data_prometida), datediff(DATE'2026-10-16', e.data_prometida)) * c.multa_atraso_pct_dia,
        c.teto_multa_pct
      ) / 100
    ), 2), 0.0) AS multa_total
  FROM lakehouse_vertice.silver.entregas_fornecedor e
  JOIN lakehouse_vertice.gold.contratos c
    ON lower(trim(e.fornecedor)) = lower(trim(c.fornecedor))
  WHERE (e.em_atraso = true OR (e.data_entrega IS NULL AND e.data_prometida < DATE'2026-10-16'))
    AND e.data_prometida > add_months(c.data_fim_vigencia, -12)
    AND c.multa_atraso_pct_dia IS NOT NULL
)
SELECT
  count_if(status = 'em_andamento') AS projetos_em_andamento,
  count_if(status = 'em_andamento' AND situacao IN ('atenção', 'crítico')) AS projetos_em_risco,
  count_if(status = 'em_andamento' AND situacao = 'crítico') AS projetos_criticos,
  count_if(status = 'em_andamento' AND melancia = true) AS projetos_melancias,
  coalesce(sum(CASE WHEN status = 'em_andamento' THEN estouro_previsto ELSE 0 END), 0.0) AS estouro_previsto,
  coalesce(sum(CASE WHEN status = 'em_andamento' THEN valor_contrato ELSE 0 END), 0.0) AS carteira,
  0 AS alto_risco_30d,
  max(m.multa_total) AS multa_fornecedores
FROM lakehouse_vertice.gold.projeto_situacao_atual
CROSS JOIN multa m;
