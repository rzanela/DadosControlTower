SELECT
  colaborador_id,
  nome,
  papel,
  senioridade,
  projeto_id,
  round(avg(horas_ociosas), 1) AS horas_paradas_media_semana,
  round(avg(custo_ocioso), 2)  AS custo_ocioso_medio_semana,
  max(custo_hora)              AS custo_hora,
  round(avg(utilizacao) * 100, 1) AS utilizacao_media_pct
FROM lakehouse_vertice.gold.utilizacao_pessoa_semana
WHERE semana > date_sub(DATE'2026-10-16', 84)
GROUP BY colaborador_id, nome, papel, senioridade, projeto_id
HAVING avg(utilizacao) < 0.20
ORDER BY custo_ocioso_medio_semana DESC;
