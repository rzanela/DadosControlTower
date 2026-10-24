param(
    [string]$Profile = "DEFAULT",
    [string]$AppName = "minha-torre"
)

Write-Host "Obtendo dados do app '$AppName'..."
$appJson = databricks apps get $AppName --profile $Profile --output json | ConvertFrom-Json
$spClientId = $appJson.service_principal_client_id

if (-not $spClientId) {
    Write-Error "service_principal_client_id nao encontrado para o app '$AppName'."
    exit 1
}

Write-Host "Service Principal Client ID: $spClientId"

$warehouseJson = databricks warehouses list --profile $Profile --output json | ConvertFrom-Json
$wh = $warehouseJson | Where-Object { $_.name -like "*Serverless*" } | Select-Object -First 1
if (-not $wh) { $wh = $warehouseJson | Select-Object -First 1 }
$whId = $wh.id

Write-Host "Usando SQL Warehouse ID: $whId"

$statements = @(
    "GRANT USE CATALOG ON CATALOG lakehouse_vertice TO \`$spClientId\`",
    "GRANT USE SCHEMA, SELECT ON SCHEMA lakehouse_vertice.gold TO \`$spClientId\`",
    "GRANT USE SCHEMA, SELECT ON SCHEMA lakehouse_vertice.silver TO \`$spClientId\`"
)

python -c "import sys, os; sys.path.insert(0, os.getcwd()); from scripts.run_sql import executar, warehouse_padrao; wh = '$whId'; sp = chr(96) + '$spClientId' + chr(96); [print('Executado:', s, executar(s, wh, '$Profile').get('status', {}).get('state')) for s in [f'GRANT USE CATALOG ON CATALOG lakehouse_vertice TO {sp}', f'GRANT USE SCHEMA, SELECT ON SCHEMA lakehouse_vertice.gold TO {sp}', f'GRANT USE SCHEMA, SELECT ON SCHEMA lakehouse_vertice.silver TO {sp}']]"

Write-Host "Permissoes concedidas com sucesso ao Service Principal $spClientId!"
