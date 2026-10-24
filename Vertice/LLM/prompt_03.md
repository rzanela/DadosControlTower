Leia aulas/aula-04-engenheiro-ia/prd/CLAUDE.md. Use as skills databricks-apps e
databricks-lakebase. O app minha-torre já está no ar (prompt 2).

1. Lakebase:
   databricks postgres create-project minha-torre --profile <perfil>
   e descubra branch e database (list-branches, list-databases).
   Adicione ao databricks.yml as variáveis postgres_branch e postgres_database e o recurso
   do app `postgres` (CAN_CONNECT_AND_CREATE); no app.yaml a env LAKEBASE_ENDPOINT
   (valueFrom: postgres); no server o plugin lakebase().

2. server/routes/decisoes.ts, registrado em onPluginsReady:
   - cria o schema torre e a tabela torre.decisoes (id serial, projeto_origem, projeto_destino,
     recurso_id, tipo 'pessoa', decisao aprovada|recusada, justificativa,
     horas_recuperadas_mes, economia_mes, dias_recuperados, usuario,
     criado_em timestamptz default now()).
   - GET /api/quem-sou, GET /api/decisoes (200 mais recentes), POST /api/decisoes com zod
     (exporte o schema): projeto ^PRJ-\d{3}$, pessoa ^COL\d{4}$, origem ≠ destino,
     justificativa de 10 a 1000 caracteres, números com z.coerce. Grave o usuário do header
     x-forwarded-email.
   - server/decisoes.test.ts (vitest) testando o schema: aceita válida, recusa justificativa
     curta, projeto fora do padrão, pessoa fora do padrão e decisão inválida.

3. Cliente: no simulador, textarea de justificativa + botões Aprovar e Recusar (desabilitados
   com menos de 10 caracteres) que fazem POST e mostram "Decisão nº X aprovada e registrada
   por <e-mail>". Nova tela Decisões com o histórico (nº, quando, pessoa origem → destino,
   decisão, justificativa, ociosidade evitada no mês, por quem).

4. typecheck, lint, test, apps validate, apps deploy --profile <perfil>.
   Prove a gravação: crie scripts/ver_decisoes.py que lê torre.decisoes direto no Postgres
   (psycopg, senha = token de `databricks postgres generate-database-credential <endpoint>`)
   e rode com uv run --no-project --with "psycopg[binary]" python ... --profile <perfil>