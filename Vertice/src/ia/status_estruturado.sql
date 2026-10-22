-- gold.status_estruturado: o status semanal em texto livre vira coluna.
--
-- "Por que o projeto atrasou?" A resposta está escrita no status de sexta, em
-- português livre, pelo gerente. Aqui ela vira dado: causa_bloqueio, o bloqueio
-- em poucas palavras, quem precisa agir para destravar e os dias de impacto.
--
-- Três ferramentas, cada uma onde ela é a certa:
--   • REGRA          para o que é padrão fixo: a semana sem bloqueio (mais da metade dos status)
--                    e o status vazio. Custo zero, resposta exata.
--   • IA             ai_classify() escolhe a causa numa lista fechada e ai_extract() tira
--                    três campos tipados do texto (bloqueio, quem_destrava, dias_impacto).
--                    Só nos status COM bloqueio dos últimos 90 dias.
--   • PALAVRA-CHAVE  para o histórico antigo, onde a IA custaria caro e não muda decisão.
--
-- O MERGE só processa status que ainda não está na tabela: rodar de novo na
-- semana que vem custa só os status da semana que vem.

CREATE TABLE IF NOT EXISTS lakehouse_vertice.gold.status_estruturado (
  projeto_id       STRING    COMMENT 'Projeto',
  data_status      DATE      COMMENT 'Sexta-feira do status',
  farol            STRING    COMMENT 'Farol que o gerente publicou: verde, amarelo ou vermelho',
  causa_bloqueio   STRING    COMMENT 'Causa do bloqueio: change_freeze, falta_sre, dependencia_fornecedor, rotatividade, mudanca_escopo, bug_retrabalho, aprovacao_cliente, sem_bloqueio ou nao_reportado',
  bloqueio         STRING    COMMENT 'O que está travando o projeto, em poucas palavras (extraído por IA; só nos últimos 90 dias)',
  quem_destrava    STRING    COMMENT 'Time, papel ou fornecedor que precisa agir para destravar (extraído por IA; só nos últimos 90 dias)',
  dias_impacto     DOUBLE    COMMENT 'Impacto declarado em dias no cronograma (1 semana = 7). Nulo quando o status não diz.',
  metodo           STRING    COMMENT 'Como a causa foi obtida: regra, ia ou palavra_chave',
  texto_status     STRING    COMMENT 'Texto original do status',
  _classificado_em TIMESTAMP COMMENT 'Quando esta linha foi classificada'
)
COMMENT 'Status semanal estruturado: causa do bloqueio, bloqueio, quem destrava e dias de impacto extraídos do texto livre (regra + ai_classify + ai_extract + palavra-chave). Use para responder POR QUE um projeto atrasou.';

MERGE INTO lakehouse_vertice.gold.status_estruturado AS alvo
USING (
  WITH novos AS (
    SELECT s.*, lower(coalesce(s.texto_status, '')) AS t
    FROM lakehouse_vertice.silver.status_semanal s
    LEFT ANTI JOIN lakehouse_vertice.gold.status_estruturado e
      ON e.projeto_id = s.projeto_id AND e.data_status = s.data_status
  ),
  marcado AS (
    SELECT *,
           CASE WHEN status_vazio THEN 'regra'
                WHEN t RLIKE 'bloqueios: nenhum|sem bloqueios|nada relevante' THEN 'regra'
                WHEN data_status >= DATE'2026-07-18' THEN 'ia'          -- últimos 90 dias até 16/10/2026
                ELSE 'palavra_chave' END AS metodo
    FROM novos
  ),
  com_ia AS (
    SELECT projeto_id, data_status,
           ai_classify(texto_status,
             '["change_freeze","falta_sre","dependencia_fornecedor","rotatividade","mudanca_escopo","bug_retrabalho","aprovacao_cliente","sem_bloqueio"]',
             map('version', '2.0')):response[0]::STRING AS causa_ia,
           ai_extract(texto_status,
             '{"bloqueio":      {"type": "string", "description": "o que está travando o projeto, em poucas palavras"},
               "quem_destrava": {"type": "string", "description": "time, papel ou fornecedor que precisa agir para destravar"},
               "dias_impacto":  {"type": "number", "description": "impacto declarado em dias no cronograma; 1 semana = 7"}}',
             map('version', '2.0')) AS extraido
    FROM marcado WHERE metodo = 'ia'
  )
  SELECT m.projeto_id, m.data_status, m.farol,
         CASE WHEN m.status_vazio THEN 'nao_reportado'
              WHEN m.metodo = 'regra' THEN 'sem_bloqueio'
              WHEN m.metodo = 'ia' THEN i.causa_ia
              WHEN m.t RLIKE 'freeze|congelamento|janela de mudança|janela de deploy' THEN 'change_freeze'
              WHEN m.t RLIKE '\\bsre\\b|infraestrutura|ambiente de homologação' THEN 'falta_sre'
              WHEN m.t RLIKE 'forge|consultoria|fornecedor' THEN 'dependencia_fornecedor'
              WHEN m.t RLIKE 'saída de|rotatividade|onboarding' THEN 'rotatividade'
              WHEN m.t RLIKE 'escopo|change request|regra de negócio' THEN 'mudanca_escopo'
              WHEN m.t RLIKE 'bugs|regressão|refazendo' THEN 'bug_retrabalho'
              WHEN m.t RLIKE 'aprovação do cliente|homologação do cliente' THEN 'aprovacao_cliente'
              ELSE 'sem_bloqueio' END                                                  AS causa_bloqueio,
         i.extraido:response:bloqueio::STRING                                        AS bloqueio,
         i.extraido:response:quem_destrava::STRING                                   AS quem_destrava,
         coalesce(i.extraido:response:dias_impacto::DOUBLE,
                  CASE WHEN m.t RLIKE 'impacto estimado de [0-9]+ dias'
                            THEN CAST(regexp_extract(m.t, 'impacto estimado de ([0-9]+) dias', 1) AS DOUBLE)
                       WHEN m.t LIKE '%impacto estimado: 1 semana%' THEN 7.0
                       WHEN m.t LIKE '%sem impacto%' THEN 0.0 END)                   AS dias_impacto,
         m.metodo,
         m.texto_status,
         current_timestamp()                                                         AS _classificado_em
  FROM marcado m
  LEFT JOIN com_ia i USING (projeto_id, data_status)
) AS novo
ON alvo.projeto_id = novo.projeto_id AND alvo.data_status = novo.data_status
WHEN NOT MATCHED THEN INSERT *;

-- Quanto cada método classificou, e em quê (só leitura: aparece na saída da tarefa)
SELECT metodo, causa_bloqueio, COUNT(*) AS status
FROM lakehouse_vertice.gold.status_estruturado
GROUP BY metodo, causa_bloqueio
ORDER BY metodo, status DESC;
