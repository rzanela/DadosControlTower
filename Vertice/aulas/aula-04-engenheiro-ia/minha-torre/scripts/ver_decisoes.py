#!/usr/bin/env python3
"""
scripts/ver_decisoes.py - Consulta o banco Lakebase Postgres diretamente via psycopg.

Uso:
  uv run --no-project --with "psycopg[binary]" python scripts/ver_decisoes.py --profile DEFAULT
"""

import argparse
import json
import subprocess
import sys


def run_cmd(cmd: list[str]) -> str:
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"Comando falhou ({' '.join(cmd)}):\n{result.stderr.strip() or result.stdout.strip()}")
    return result.stdout.strip()


def get_endpoint_info(endpoint: str, profile: str) -> str:
    stdout = run_cmd(["databricks", "postgres", "get-endpoint", endpoint, "--profile", profile])
    data = json.loads(stdout)
    host = data.get("status", {}).get("hosts", {}).get("host")
    if not host:
        raise ValueError(f"Não foi possível obter o host do endpoint {endpoint}")
    return host


def get_db_token(endpoint: str, profile: str) -> str:
    stdout = run_cmd(["databricks", "postgres", "generate-database-credential", endpoint, "--profile", profile])
    data = json.loads(stdout)
    token = data.get("token")
    if not token:
        raise ValueError("Não foi possível gerar a credencial do banco de dados")
    return token


def get_current_user(profile: str) -> str:
    stdout = run_cmd(["databricks", "current-user", "me", "--profile", profile])
    data = json.loads(stdout)
    return data.get("userName") or "rafaelzanela@gmail.com"


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="Visualizar decisões registradas no Lakebase Postgres")
    parser.add_argument("--profile", default="DEFAULT", help="Databricks CLI profile")
    parser.add_argument(
        "--endpoint",
        default="projects/minha-torre/branches/production/endpoints/primary",
        help="Postgres endpoint resource name",
    )
    parser.add_argument(
        "--dbname",
        default="databricks_postgres",
        help="Nome do banco de dados (default: databricks_postgres)",
    )
    args = parser.parse_args()

    print(f"[*] Coletando informações do Lakebase Endpoint ({args.endpoint})...")
    try:
        host = get_endpoint_info(args.endpoint, args.profile)
        user = get_current_user(args.profile)
        token = get_db_token(args.endpoint, args.profile)
    except Exception as e:
        print(f"[!] Erro ao obter credenciais Databricks: {e}", file=sys.stderr)
        sys.exit(1)

    print(f"[*] Conectando a {host} (DB: {args.dbname}, Usuário: {user})...")

    try:
        import psycopg
    except ImportError:
        print("[!] psycopg não encontrado. Execute com: uv run --no-project --with 'psycopg[binary]' python scripts/ver_decisoes.py", file=sys.stderr)
        sys.exit(1)

    try:
        with psycopg.connect(
            host=host,
            port=5432,
            dbname=args.dbname,
            user=user,
            password=token,
            sslmode="require",
        ) as conn:
            with conn.cursor() as cur:
                # Verificar se a tabela existe
                cur.execute("""
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_schema = 'torre' AND table_name = 'decisoes'
                    );
                """)
                exists = cur.fetchone()[0]

                if not exists:
                    print("[!] A tabela torre.decisoes ainda não foi criada no banco.")
                    print("[*] Criando schema 'torre' e tabela 'torre.decisoes' agora...")
                    cur.execute("""
                        CREATE SCHEMA IF NOT EXISTS torre;
                        CREATE TABLE IF NOT EXISTS torre.decisoes (
                            id SERIAL PRIMARY KEY,
                            projeto_origem VARCHAR(50) NOT NULL,
                            projeto_destino VARCHAR(50) NOT NULL,
                            recurso_id VARCHAR(50) NOT NULL,
                            tipo VARCHAR(50) NOT NULL DEFAULT 'pessoa',
                            decisao VARCHAR(20) NOT NULL CHECK (decisao IN ('aprovada', 'recusada')),
                            justificativa TEXT NOT NULL,
                            horas_recuperadas_mes NUMERIC(10,2) NOT NULL,
                            economia_mes NUMERIC(15,2) NOT NULL,
                            dias_recuperados NUMERIC(10,2) NOT NULL,
                            usuario VARCHAR(255) NOT NULL,
                            criado_em TIMESTAMPTZ DEFAULT NOW()
                        );
                    """)
                    conn.commit()
                    print("[+] Schema e tabela 'torre.decisoes' criados com sucesso!")

                # Buscar as 20 decisões mais recentes
                cur.execute("""
                    SELECT
                        id,
                        projeto_origem,
                        projeto_destino,
                        recurso_id,
                        decisao,
                        horas_recuperadas_mes,
                        economia_mes,
                        dias_recuperados,
                        usuario,
                        criado_em,
                        justificativa
                    FROM torre.decisoes
                    ORDER BY id DESC
                    LIMIT 20;
                """)
                rows = cur.fetchall()

                print("\n" + "=" * 110)
                print(f"DECISÕES REGISTRADAS NO LAKEBASE POSTGRES ({len(rows)} encontradas)")
                print("=" * 110)

                if not rows:
                    print("Nenhuma decisão registrada até o momento.")
                    print("=" * 110)
                    return

                # Header formatado
                header = f"{'ID':<4} | {'STATUS':<9} | {'DE -> PARA':<19} | {'RECURSO':<9} | {'RECUP.':<10} | {'ECONOMIA':<12} | {'USUÁRIO':<24} | {'DATA/HORA'}"
                print(header)
                print("-" * 110)

                for r in rows:
                    id_val, orig, dest, rec, dec, hrs, econ, dias, usr, dt, just = r
                    fluxo = f"{orig} -> {dest}"
                    status = dec.upper()
                    hrs_str = f"{float(hrs):.1f}h"
                    econ_str = f"R$ {float(econ):,.2f}"
                    dt_str = dt.strftime("%d/%m/%Y %H:%M") if dt else "-"
                    print(f"{id_val:<4} | {status:<9} | {fluxo:<19} | {rec:<9} | {hrs_str:<10} | {econ_str:<12} | {usr[:24]:<24} | {dt_str}")
                    print(f"     -> Justificativa: {just}")
                    print("-" * 110)

    except Exception as e:
        print(f"[!] Erro ao consultar o banco PostgreSQL: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
