#!/usr/bin/env python3
"""CLI para publicar e testar um Genie Agent no Databricks.

Subcomandos:
  publicar  <json_file> --titulo <titulo> --profile <perfil>
              Cria ou atualiza o Genie Agent com o serialized_space do JSON.

  benchmark <titulo> <benchmark_json> --profile <perfil>
              Faz as perguntas do benchmark via Conversation API e compara
              com o SQL esperado, imprimindo o placar final.

Uso:
  python3 scripts/genie.py publicar meu-agente/diretoria-contratos-genie.json \\
    --titulo "Farol · Diretoria + Contratos" --profile DEFAULT

  python3 scripts/genie.py benchmark "Farol · Diretoria + Contratos" \\
    aulas/aula-04-engenheiro-ia/prd/genie-benchmark.json --profile DEFAULT
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time


# ---------------------------------------------------------------------------
# Helpers de CLI
# ---------------------------------------------------------------------------

def cli(args: list[str], profile: str) -> dict:
    r = subprocess.run(
        ["databricks", *args, "--profile", profile, "-o", "json"],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip() or r.stdout.strip())
    try:
        return json.loads(r.stdout or "{}")
    except Exception:
        return {}


def cli_raw(args: list[str], profile: str) -> str:
    r = subprocess.run(
        ["databricks", *args, "--profile", profile],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip() or r.stdout.strip())
    return r.stdout


def get_warehouse_id(name: str, profile: str) -> str:
    warehouses = cli(["warehouses", "list"], profile)
    if isinstance(warehouses, dict):
        warehouses = warehouses.get("warehouses", [])
    for w in warehouses:
        if w.get("name", "").strip().lower() == name.strip().lower():
            return w["id"]
    raise RuntimeError(f"Warehouse '{name}' não encontrado.")


def find_space_by_title(title: str, profile: str) -> str | None:
    """Retorna o space_id se existir um Genie Agent com o título (ou correspondência normalizada)."""
    import re
    def norm(t: str) -> str:
        return re.sub(r"[^a-zA-Z0-9]", "", t.lower())

    try:
        spaces = cli(["genie", "list-spaces"], profile)
        if isinstance(spaces, dict):
            spaces = spaces.get("spaces", [])
        for s in spaces:
            st = s.get("title", "").strip()
            if st == title.strip() or norm(st) == norm(title):
                return s["space_id"]
    except Exception:
        pass
    return None


# ---------------------------------------------------------------------------
# Subcomando: publicar
# ---------------------------------------------------------------------------

def publicar(json_file: str, titulo: str, profile: str, warehouse_name: str) -> None:
    print(f"📖 Lendo: {json_file}")
    space_obj = json.loads(open(json_file, encoding="utf-8").read())

    # serialized_space deve ser uma STRING JSON
    serialized = json.dumps(space_obj, ensure_ascii=False)

    warehouse_id = get_warehouse_id(warehouse_name, profile)
    print(f"🏭 Warehouse: {warehouse_name} ({warehouse_id})")

    existing_id = find_space_by_title(titulo, profile)

    payload = {
        "warehouse_id": warehouse_id,
        "title": titulo,
        "serialized_space": serialized,
    }

    if existing_id:
        print(f"♻️  Atualizando space existente: {existing_id}")
        cli(["genie", "update-space", existing_id,
             "--json", json.dumps(payload)], profile)
        space_id = existing_id
    else:
        print("🆕 Criando novo Genie Agent...")
        result = cli(["genie", "create-space",
                      "--json", json.dumps(payload)], profile)
        space_id = result.get("space_id", result.get("id", ""))

    host = get_host(profile)
    url = f"{host}/genie/rooms/{space_id}"
    print(f"\n✅ Publicado com sucesso!")
    print(f"   Space ID: {space_id}")
    print(f"   Link:     {url}")
    print(f"\n⚠️  Em prod o space_id MUDA — atualize o JSON dos dashboards manualmente.")


def get_host(profile: str) -> str:
    r = subprocess.run(
        ["databricks", "auth", "describe", "--profile", profile, "-o", "json"],
        capture_output=True, text=True,
    )
    if r.returncode == 0:
        data = json.loads(r.stdout)
        host = data.get("details", {}).get("host", "")
        if host:
            return host.rstrip("/")
    # fallback
    return "https://dbc-86be5789-92c0.cloud.databricks.com"


# ---------------------------------------------------------------------------
# Subcomando: benchmark
# ---------------------------------------------------------------------------

def poll_message(space_id: str, conv_id: str, msg_id: str, profile: str,
                 timeout: int = 120) -> dict:
    """Aguarda o Genie terminar de processar e retorna o resultado."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        msg = cli(["genie", "get-message", space_id, conv_id, msg_id], profile)
        status = msg.get("status", "")
        if status == "COMPLETED":
            return msg
        if status in ("FAILED", "CANCELLED"):
            err = msg.get("error", {}).get("error") or msg.get("error", {}).get("message") or f"Genie status: {status}"
            raise RuntimeError(f"Genie falhou ({status}): {err}")
        time.sleep(4)
    raise TimeoutError(f"Genie não respondeu em {timeout}s")


def perguntar(space_id: str, pergunta: str, profile: str) -> dict:
    """Inicia uma conversa e aguarda a resposta."""
    return cli(
        ["genie", "start-conversation", space_id, pergunta],
        profile,
    )


def extrair_sql(msg: dict) -> str:
    """Extrai o SQL gerado pelo Genie a partir da resposta."""
    for att in msg.get("attachments", []):
        sql = att.get("query", {}).get("query", "")
        if sql:
            return sql.strip()
    return ""


def executar_sql(sql: str, warehouse_id: str, profile: str) -> list[list]:
    """Executa um SQL no warehouse e retorna as linhas como lista de listas."""
    corpo = json.dumps({
        "warehouse_id": warehouse_id,
        "statement": sql,
        "wait_timeout": "50s",
        "on_wait_timeout": "CONTINUE",
    })
    r = cli(["api", "post", "/api/2.0/sql/statements", "--json", corpo], profile)
    while r.get("status", {}).get("state") in ("PENDING", "RUNNING"):
        time.sleep(3)
        r = cli(["api", "get",
                 f"/api/2.0/sql/statements/{r['statement_id']}"], profile)
    return r.get("result", {}).get("data_array") or []


def benchmark(titulo: str, benchmark_json: str, profile: str,
              warehouse_name: str) -> None:
    print(f"🔍 Buscando Genie Agent: {titulo!r}")
    space_id = find_space_by_title(titulo, profile)
    if not space_id:
        sys.exit(f"❌ Genie Agent '{titulo}' não encontrado. Execute 'publicar' primeiro.")

    warehouse_id = get_warehouse_id(warehouse_name, profile)
    perguntas = json.loads(open(benchmark_json, encoding="utf-8").read())

    acertos, total = 0, 0
    resultados = []

    for item in perguntas:
        pergunta    = item["pergunta"]
        esperado_sql = item.get("sql_esperado", "")
        esperado_res = item.get("resultado_esperado", "")
        total += 1

        print(f"\n[{total}] {pergunta}")
        print("     Perguntando ao Genie...")

        try:
            msg = perguntar(space_id, pergunta, profile)
            sql_genie = extrair_sql(msg)

            if not sql_genie:
                # Genie pode ter respondido em texto (sem SQL)
                texto = ""
                for att in msg.get("attachments", []):
                    texto = att.get("text", {}).get("content", "")
                    if texto:
                        break
                resultados.append({
                    "pergunta": pergunta,
                    "sql_genie": "(sem SQL — resposta em texto)",
                    "resposta_texto": texto[:300],
                    "acertou": "❓ sem SQL",
                })
                print(f"     ⚠️  Genie respondeu em texto: {texto[:100]}...")
                continue

            print(f"     SQL gerado: {sql_genie[:100]}...")

            # Executa o SQL do Genie para comparar com o esperado
            if esperado_sql:
                linhas_genie    = executar_sql(sql_genie,    warehouse_id, profile)
                linhas_esperado = executar_sql(esperado_sql, warehouse_id, profile)
                acertou = linhas_genie == linhas_esperado
            elif esperado_res:
                linhas_genie = executar_sql(sql_genie, warehouse_id, profile)
                acertou = esperado_res in str(linhas_genie)
            else:
                linhas_genie = executar_sql(sql_genie, warehouse_id, profile)
                acertou = len(linhas_genie) > 0

            if acertou:
                acertos += 1
                print("     ✅ Acertou!")
            else:
                print("     ❌ Errou.")

            resultados.append({
                "pergunta": pergunta,
                "sql_genie": sql_genie,
                "acertou": "✅" if acertou else "❌",
            })

        except Exception as e:
            print(f"     ❌ Erro: {e}")
            resultados.append({
                "pergunta": pergunta,
                "acertou": f"❌ erro: {e}",
            })

    # Placar
    print(f"\n{'='*60}")
    print(f"PLACAR: {acertos}/{total}")
    print(f"{'='*60}")
    for r in resultados:
        print(f"  {r['acertou']}  {r['pergunta']}")

    if acertos < total:
        print("\n💡 Dica: ajuste as instruções no gerar_genie.py e faça deploy novamente.")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    parent_parser = argparse.ArgumentParser(add_help=False)
    parent_parser.add_argument("--profile", default="DEFAULT")
    parent_parser.add_argument("--warehouse", default="Serverless Starter Warehouse",
                               help="Nome do SQL Warehouse")

    ap = argparse.ArgumentParser(description="CLI para publicar e testar Genie Agents.", parents=[parent_parser])
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_pub = sub.add_parser("publicar", help="Publica o Genie Agent", parents=[parent_parser])
    p_pub.add_argument("json_file", help="Caminho para o serialized_space JSON")
    p_pub.add_argument("--titulo", required=True, help="Título do Genie Agent")

    p_bmk = sub.add_parser("benchmark", help="Executa benchmark de perguntas", parents=[parent_parser])
    p_bmk.add_argument("titulo", help="Título do Genie Agent a testar")
    p_bmk.add_argument("benchmark_json", help="Caminho para o arquivo de benchmark")

    args = ap.parse_args()

    if args.cmd == "publicar":
        publicar(args.json_file, args.titulo, args.profile, args.warehouse)
    elif args.cmd == "benchmark":
        benchmark(args.titulo, args.benchmark_json, args.profile, args.warehouse)


if __name__ == "__main__":
    main()
