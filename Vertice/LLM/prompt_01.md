Leia aulas/aula-04-engenheiro-ia/prd/CLAUDE.md antes de começar. Use a skill
databricks-ai-functions.

Crie a pasta aulas/aula-04-engenheiro-ia/meu-agente/ com o agente que lê os 8
contratos de fornecedor da Vértice. Perfil: <perfil> (sempre --profile).
Objetivo: gold enxuta. Só UMA tabela nova na gold; nada de views.

1. meu-agente/01-contratos.sql, executável com
   python3 scripts/run_sql.py meu-agente/01-contratos.sql --profile <perfil>
   (API de statements, não o aitools query). COMMENT em toda tabela (é o que o Genie lê).
   a) silver.documentos_elementos: read_files (binaryFile) dos PDFs em
      /Volumes/lakehouse_vertice/bronze/raw/documentos/contratos/,
      ai_parse_document(content, map('version','2.0')), posexplode dos elementos:
      documento, ordem, tipo (title/section_header/text), conteudo.
   b) silver.contratos_clausulas: uma linha por cláusula (fornecedor, clausula_numero INT,
      titulo, texto). Cada texto pertence à última section_header "CLÁUSULA N - TÍTULO"
      antes dele (last_value ignorando nulos). O fornecedor sai da linha "CONTRATADA: ...".
   c) Um SELECT de demonstração com ai_extract SEM schema (lista de nomes de campo) em 3
      contratos, para a turma ver que volta texto.
   d) gold.contratos, uma linha por contrato: ai_extract(texto do contrato, JSON schema,
      map('version','2.0')) com objeto, valor_anual (number), data_fim_vigencia (string
      AAAA-MM-DD), renovacao_automatica (boolean), aviso_previo_dias (integer),
      multa_atraso_pct_dia (number, nulo se não há), teto_multa_pct (number), sla e
      reajuste (string). Descrição em cada campo; "em português" nos campos de texto.
      Leia com :response:campo::TIPO. Guarde também clausulas = o texto de todas as
      cláusulas, cada uma com "CLÁUSULA N - TÍTULO:" na frente.
   e) No fim, duas CONSULTAS (não views) sobre gold.contratos, com hoje = 16/10/2026:
      - multa a cobrar por fornecedor: silver.entregas_fornecedor entregue com atraso ou
        em aberto vencida; dias de atraso até a entrega (ou até hoje); multa = valor ×
        least(dias × multa % ao dia, teto) / 100; só o prometido na vigência atual
        (data_prometida > add_months(data_fim_vigencia, -12));
      - aviso prévio: data limite = data_fim_vigencia − aviso_previo_dias e dias até ela.

2. meu-agente/gerar_genie.py: escreve meu-agente/diretoria-contratos-genie.json (NÃO use a
   extensão .geniespace.json) com gold.contratos, gold.projeto_situacao_atual,
   gold.status_estruturado, gold.utilizacao_pessoa_semana, silver.entregas_fornecedor e a
   metric view gold.mv_projetos. Inclua gold.score_estouro_30d SÓ se existir (databricks
   tables exists). Instruções: a Vértice é a CONTRATANTE (multa é dinheiro que ela cobra);
   hoje = 16/10/2026; cite o número da cláusula; a conta da multa e do aviso prévio acima.
   Exemplos de SQL para "quanto cobrar da CodeForge", "aviso prévio", "por que o PRJ-011
   atrasou" e "tenho SRE parado para o PRJ-011".

3. Publique e teste:
   python3 scripts/genie.py publicar meu-agente/diretoria-contratos-genie.json \
     --titulo "Farol · Diretoria + Contratos" --profile <perfil>
   python3 scripts/genie.py benchmark "Farol · Diretoria + Contratos" \
     aulas/aula-04-engenheiro-ia/prd/genie-benchmark.json --profile <perfil>
   Se errar, ajuste as instruções (não as perguntas) e publique de novo.