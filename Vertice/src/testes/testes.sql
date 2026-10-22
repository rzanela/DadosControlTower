-- Testes de qualidade: rodam DEPOIS do medalhão e quebram o job se algo estiver errado.
--
-- raise_error() dentro de CASE WHEN interrompe a tarefa.
--
-- Os testes mais importantes são os da integração (1 a 3): as três ferramentas
-- entraram inteiras, sem linha de TOTAL e sem tarefa-resumo somando duas vezes.

WITH testes AS (
  SELECT 1 AS n, 'os 60 projetos têm cronograma na silver.tarefas' AS teste,
         (SELECT COUNT(DISTINCT projeto_id) FROM lakehouse_vertice.silver.tarefas) = 60 AS passou
  UNION ALL
  SELECT 2, 'cada projeto veio de UMA ferramenta, a do cadastro do PMO',
         (SELECT COUNT(*) FROM (SELECT t.projeto_id FROM lakehouse_vertice.silver.tarefas t
                                JOIN lakehouse_vertice.silver.projetos p USING (projeto_id)
                                WHERE t.ferramenta <> p.ferramenta)) = 0
  UNION ALL
  SELECT 3, 'as horas da silver batem com a linha de TOTAL de cada planilha',
         (SELECT SUM(horas) FROM lakehouse_vertice.silver.tarefas WHERE ferramenta = 'excel')
       = (SELECT SUM(CAST(horas_previstas AS DOUBLE)) FROM lakehouse_vertice.bronze.excel_tarefas WHERE tarefa = 'TOTAL')
  UNION ALL
  SELECT 4, 'uma linha por pessoa na silver',
         (SELECT COUNT(*) FROM lakehouse_vertice.silver.colaboradores)
       = (SELECT COUNT(DISTINCT colaborador_id) FROM lakehouse_vertice.silver.colaboradores)
  UNION ALL
  SELECT 5, 'CodeForge virou um fornecedor só',
         (SELECT COUNT(DISTINCT fornecedor) FROM lakehouse_vertice.silver.entregas_fornecedor
          WHERE replace(lower(fornecedor), ' ', '') LIKE '%codeforge%') = 1
  UNION ALL
  SELECT 6, 'a limpeza não mudou o custo total (bronze = silver)',
         (SELECT SUM(CAST(replace(valor, ',', '.') AS DECIMAL(18,2))) FROM lakehouse_vertice.bronze.custos)
       = (SELECT SUM(valor) FROM lakehouse_vertice.silver.custos)
  UNION ALL
  SELECT 7, 'os 60 projetos têm fotografia de hoje',
         (SELECT COUNT(*) FROM lakehouse_vertice.gold.projeto_situacao_atual) = 60
  UNION ALL
  SELECT 8, 'todo projeto em andamento tem SPI e CPI',
         (SELECT COUNT(*) FROM lakehouse_vertice.gold.projeto_situacao_atual
          WHERE status = 'em_andamento' AND (spi IS NULL OR cpi IS NULL)) = 0
  UNION ALL
  SELECT 9, 'o EV de hoje do status semanal bate com o das ferramentas (diferença < 1%)',
         (SELECT abs(SUM(f.ev) - SUM(s.ev)) / SUM(s.ev)
          FROM lakehouse_vertice.gold.fato_projeto_semana f
          JOIN lakehouse_vertice.gold.projeto_situacao_atual s USING (projeto_id)
          WHERE f.semana = DATE'2026-10-16' AND s.status = 'em_andamento') < 0.01
  UNION ALL
  SELECT 10, 'custo acumulado de hoje = soma dos lançamentos',
         (SELECT SUM(ac) FROM lakehouse_vertice.gold.fato_projeto_semana WHERE semana = DATE'2026-10-16')
       = (SELECT SUM(valor) FROM lakehouse_vertice.silver.custos WHERE data <= DATE'2026-10-16')
)
SELECT n, teste,
       CASE WHEN passou THEN 'ok' ELSE raise_error(concat('Teste ', n, ' falhou: ', teste)) END AS status
FROM testes
ORDER BY n;
