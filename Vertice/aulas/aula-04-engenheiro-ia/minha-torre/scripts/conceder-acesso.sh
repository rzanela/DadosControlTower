#!/usr/bin/env bash
set -euo pipefail

PROFILE="${1:-DEFAULT}"
APP_NAME="${2:-minha-torre}"

SP_CLIENT_ID=$(databricks apps get "$APP_NAME" --profile "$PROFILE" --output json | jq -r '.service_principal_client_id')
echo "Service Principal: $SP_CLIENT_ID"

WH_ID=$(databricks warehouses list --profile "$PROFILE" --output json | jq -r '.[] | select(.name | test("Serverless"; "i")) | .id' | head -n 1)
echo "SQL Warehouse: $WH_ID"

for STMT in \
  "GRANT USE CATALOG ON CATALOG lakehouse_vertice TO \`$SP_CLIENT_ID\`" \
  "GRANT USE SCHEMA, SELECT ON SCHEMA lakehouse_vertice.gold TO \`$SP_CLIENT_ID\`" \
  "GRANT USE SCHEMA, SELECT ON SCHEMA lakehouse_vertice.silver TO \`$SP_CLIENT_ID\`"; do
  echo "Executando: $STMT"
  databricks api post /api/2.0/sql/statements --profile "$PROFILE" --json "{\"warehouse_id\": \"$WH_ID\", \"statement\": \"$STMT\", \"wait_timeout\": \"30s\"}"
done

echo "Permissoes concedidas com sucesso!"
