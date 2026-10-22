-- Conferência da Bronze: Seed 42
-- Verifica se as contagens batem com o esperado após a ingestão do data lake.

WITH contagem_obtida AS (
    SELECT 'projetos' AS tabela, COUNT(*) AS obtido FROM lakehouse_vertice.bronze.projetos
    UNION ALL SELECT 'status_semanal', COUNT(*) FROM lakehouse_vertice.bronze.status_semanal
    UNION ALL SELECT 'excel_tarefas', COUNT(*) FROM lakehouse_vertice.bronze.excel_tarefas
    UNION ALL SELECT 'clickup_tarefas', COUNT(*) FROM lakehouse_vertice.bronze.clickup_tarefas
    UNION ALL SELECT 'msproject_tarefas', COUNT(*) FROM lakehouse_vertice.bronze.msproject_tarefas
    UNION ALL SELECT 'colaboradores', COUNT(*) FROM lakehouse_vertice.bronze.colaboradores
    UNION ALL SELECT 'apontamentos', COUNT(*) FROM lakehouse_vertice.bronze.apontamentos
    UNION ALL SELECT 'custos', COUNT(*) FROM lakehouse_vertice.bronze.custos
    UNION ALL SELECT 'entregas_fornecedor', COUNT(*) FROM lakehouse_vertice.bronze.entregas_fornecedor
),
contagem_esperada AS (
    SELECT 'projetos' AS tabela, 60 AS esperado
    UNION ALL SELECT 'status_semanal', 3911
    UNION ALL SELECT 'excel_tarefas', 1663
    UNION ALL SELECT 'clickup_tarefas', 2119
    UNION ALL SELECT 'msproject_tarefas', 1260
    UNION ALL SELECT 'colaboradores', 523
    UNION ALL SELECT 'apontamentos', 30883
    UNION ALL SELECT 'custos', 23640
    UNION ALL SELECT 'entregas_fornecedor', 640
),
conferencia AS (
    SELECT 
        e.tabela, 
        e.esperado, 
        coalesce(o.obtido, 0) AS obtido,
        (e.esperado = coalesce(o.obtido, 0)) AS ok
    FROM contagem_esperada e
    LEFT JOIN contagem_obtida o ON e.tabela = o.tabela
)
SELECT 
    *,
    CASE WHEN NOT ok THEN raise_error(concat('Divergência na tabela ', tabela, ': esperado ', esperado, ', obtido ', obtido, '. Confira a saída da tarefa ingestao_data_lake.')) END
FROM conferencia;
