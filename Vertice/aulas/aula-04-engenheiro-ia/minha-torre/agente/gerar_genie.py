#!/usr/bin/env python3
"""Gera meu-agente/diretoria-contratos-genie.json para o Genie Agent "Farol · Diretoria + Contratos".

Uso:
  python3 aulas/aula-04-engenheiro-ia/meu-agente/gerar_genie.py --profile DEFAULT

Escreve meu-agente/diretoria-contratos-genie.json (NÃO usa extensão .geniespace.json).
O JSON gerado é o serialized_space (objeto parseado, não string) pronto para ser
passado para scripts/genie.py publicar.

Tabelas incluídas:
  - lakehouse_vertice.gold.contratos             (sempre)
  - lakehouse_vertice.gold.projeto_situacao_atual (sempre)
  - lakehouse_vertice.gold.status_estruturado     (sempre)
  - lakehouse_vertice.gold.utilizacao_pessoa_semana (sempre)
  - lakehouse_vertice.silver.entregas_fornecedor  (sempre)
  - lakehouse_vertice.gold.mv_projetos            (só se existir)
  - lakehouse_vertice.gold.score_estouro_30d      (só se existir)
"""
from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys
import uuid

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
OUTPUT = SCRIPT_DIR / "diretoria-contratos-genie.json"
CATALOG = "lakehouse_vertice"
TODAY = "2026-10-16"
WAREHOUSE_NAME = "Serverless Starter Warehouse"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def newid() -> str:
    return uuid.uuid4().hex


def table_exists(full_name: str, profile: str) -> bool:
    """Verifica se a tabela existe no Unity Catalog via CLI."""
    r = subprocess.run(
        ["databricks", "tables", "get", full_name, "--profile", profile],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    return r.returncode == 0


def get_warehouse_id(name: str, profile: str) -> str:
    r = subprocess.run(
        ["databricks", "warehouses", "list", "--profile", profile, "-o", "json"],
        capture_output=True, text=True, check=True, encoding="utf-8", errors="replace",
    )
    warehouses = json.loads(r.stdout)
    if isinstance(warehouses, dict):
        warehouses = warehouses.get("warehouses", [])
    for w in warehouses:
        if w.get("name", "").strip().lower() == name.strip().lower():
            return w["id"]
    raise RuntimeError(f"Warehouse '{name}' não encontrado. Warehouses disponíveis: "
                       + ", ".join(w["name"] for w in warehouses))


# ---------------------------------------------------------------------------
# Conteúdo do serialized_space
# ---------------------------------------------------------------------------

ALWAYS_TABLES = [
    f"{CATALOG}.gold.contratos",
    f"{CATALOG}.gold.projeto_situacao_atual",
    f"{CATALOG}.gold.status_estruturado",
    f"{CATALOG}.gold.utilizacao_pessoa_semana",
    f"{CATALOG}.silver.entregas_fornecedor",
]

OPTIONAL_TABLES = [
    f"{CATALOG}.gold.mv_projetos",
    f"{CATALOG}.gold.score_estouro_30d",
]

TEXT_INSTRUCTIONS = [
    "A Vértice Tecnologia é a CONTRATANTE em todos os contratos. Multa é um valor que a "
    "Vértice COBRA do fornecedor por atraso ou descumprimento.",

    f"Hoje é {TODAY}. Para calcular dias de atraso ou prazo de aviso prévio, use "
    f"DATE'{TODAY}' — nunca current_date().",

    "Ao mencionar uma cláusula, cite o número: 'conforme a Cláusula 5 – Penalidades'.",

    "Fórmula de multa: valor_entrega × least(dias_atraso × multa_atraso_pct_dia, teto_multa_pct) / 100. "
    "dias_atraso = datediff(data_entrega, data_prometida) se entregue com atraso; "
    f"datediff(DATE'{TODAY}', data_prometida) se em aberto vencida. "
    "Filtre sempre entregas na vigência atual: data_prometida > add_months(data_fim_vigencia, -12).",

    "Aviso prévio: data_limite = date_sub(data_fim_vigencia, aviso_previo_dias). "
    f"dias_ate_prazo = datediff(data_limite, DATE'{TODAY}'). "
    "Para contratos vencendo nos próximos N dias, filtre data_fim_vigencia <= date_add(DATE'2026-10-16', N).",

    "Para calcular o SPI e CPI da carteira atual: use gold.projeto_situacao_atual com "
    "WHERE status = 'em_andamento', calculando SUM(ev) / SUM(pv) AS spi e SUM(ev) / SUM(ac) AS cpi.",

    "Para entregas em aberto e vencidas: use silver.entregas_fornecedor com "
    f"WHERE data_entrega IS NULL AND data_prometida < DATE'{TODAY}', calculando "
    f"datediff(DATE'{TODAY}', data_prometida) AS dias_em_atraso e ordenando por dias_em_atraso DESC.",

    "Para perguntas sobre atrasos de entrega ou multas, use silver.entregas_fornecedor "
    "joined com gold.contratos por lower(trim(fornecedor)).",

    "Para perguntas sobre projetos, SPI, CPI, estouro, situação ou farol, use "
    "gold.projeto_situacao_atual.",

    "Para causas de bloqueio, textos de status ou IA, use gold.status_estruturado.",

    "Para utilização de pessoas, horas ociosas ou alocação, use "
    "gold.utilizacao_pessoa_semana.",

    "Respostas sempre em português. Valores monetários em R$ com 2 casas decimais.",
]

EXAMPLE_SQLS = [
    (
        "Quanto cobrar da CodeForge por atrasos nas entregas?",
        f"""SELECT
  c.fornecedor,
  e.item,
  e.projeto_id,
  e.data_prometida,
  e.data_entrega,
  coalesce(
    datediff(e.data_entrega,   e.data_prometida),
    datediff(DATE'{TODAY}', e.data_prometida)
  ) AS dias_atraso,
  e.valor,
  round(
    e.valor
    * least(
        coalesce(
          datediff(e.data_entrega,   e.data_prometida),
          datediff(DATE'{TODAY}', e.data_prometida)
        ) * c.multa_atraso_pct_dia,
        c.teto_multa_pct
      )
    / 100, 2
  ) AS `multa_calculada_r$`
FROM {CATALOG}.silver.entregas_fornecedor e
JOIN {CATALOG}.gold.contratos c
  ON lower(trim(e.fornecedor)) = lower(trim(c.fornecedor))
WHERE lower(c.fornecedor) LIKE '%codeforge%'
  AND (e.em_atraso = true
       OR e.data_entrega > e.data_prometida
       OR (e.data_entrega IS NULL AND e.data_prometida < DATE'{TODAY}'))
  AND e.data_prometida > add_months(c.data_fim_vigencia, -12)
  AND c.multa_atraso_pct_dia IS NOT NULL
ORDER BY `multa_calculada_r$` DESC""",
    ),
    (
        "Quais contratos vencem nos próximos 90 dias e precisam de aviso prévio?",
        f"""SELECT
  fornecedor,
  data_fim_vigencia,
  aviso_previo_dias,
  date_sub(data_fim_vigencia, aviso_previo_dias) AS data_limite_aviso,
  datediff(
    date_sub(data_fim_vigencia, aviso_previo_dias),
    DATE'{TODAY}'
  ) AS dias_ate_prazo
FROM {CATALOG}.gold.contratos
WHERE data_fim_vigencia <= date_add(DATE'{TODAY}', 90)
ORDER BY data_limite_aviso""",
    ),
    (
        "Qual o SPI e CPI da carteira atual?",
        f"""SELECT
  SUM(ev) / SUM(pv) AS spi,
  SUM(ev) / SUM(ac) AS cpi
FROM {CATALOG}.gold.projeto_situacao_atual
WHERE status = 'em_andamento'""",
    ),
    (
        "Por que o PRJ-011 atrasou?",
        f"""SELECT
  s.data_status,
  s.causa_bloqueio,
  s.dias_impacto,
  s.texto_status
FROM {CATALOG}.gold.status_estruturado s
WHERE s.projeto_id = 'PRJ-011'
  AND s.causa_bloqueio NOT IN ('sem_bloqueio', 'nao_reportado')
ORDER BY s.data_status DESC
LIMIT 20""",
    ),
    (
        "Tenho SRE parado para o PRJ-011?",
        f"""SELECT
  u.colaborador_id,
  u.nome,
  u.papel,
  u.projeto_id,
  round(SUM(u.horas_apontadas) / SUM(u.horas_disponiveis) * 100, 1) AS utilizacao_pct,
  SUM(u.horas_ociosas)  AS horas_ociosas,
  SUM(u.custo_ocioso)   AS custo_ocioso_r$
FROM {CATALOG}.gold.utilizacao_pessoa_semana u
WHERE u.projeto_id = 'PRJ-011'
  AND u.papel ILIKE '%sre%'
  AND u.semana > date_sub(DATE'{TODAY}', 84)  -- 12 semanas
GROUP BY ALL
ORDER BY utilizacao_pct""",
    ),
    (
        "Quais entregas de fornecedores estão em aberto e vencidas?",
        f"""SELECT
  fornecedor,
  projeto_id,
  item,
  data_prometida,
  datediff(DATE'{TODAY}', data_prometida) AS dias_em_atraso,
  valor
FROM {CATALOG}.silver.entregas_fornecedor
WHERE data_entrega IS NULL
  AND data_prometida < DATE'{TODAY}'
ORDER BY dias_em_atraso DESC""",
    ),
]

SAMPLE_QUESTIONS = [
    "Quanto cobrar da CodeForge por atrasos nas entregas?",
    "Quais contratos vencem nos próximos 90 dias e precisam de aviso prévio?",
    "Qual o SPI e CPI da carteira atual?",
    "Por que o PRJ-011 está atrasado?",
    "Tenho pessoas paradas enquanto algum projeto pede mais gente?",
    "Quais entregas de fornecedores estão em aberto e vencidas?",
]

JOIN_SPECS = [
    {
        "left":  {"identifier": f"{CATALOG}.silver.entregas_fornecedor", "alias": "entregas_fornecedor"},
        "right": {"identifier": f"{CATALOG}.gold.contratos",              "alias": "contratos"},
        "sql":   [
            "lower(trim(entregas_fornecedor.fornecedor)) = lower(trim(contratos.fornecedor))",
            "--rt=FROM_RELATIONSHIP_TYPE_MANY_TO_ONE--",
        ],
    },
]


# ---------------------------------------------------------------------------
# Montagem do serialized_space
# ---------------------------------------------------------------------------

def build_space(tables: list[str]) -> dict:
    tables_sorted = sorted([{"identifier": t} for t in tables], key=lambda x: x["identifier"])

    sample_qs = sorted(
        [{"id": newid(), "question": [q]} for q in SAMPLE_QUESTIONS],
        key=lambda x: x["id"],
    )

    text_instr = [{
        "id": newid(),
        "content": TEXT_INSTRUCTIONS,
    }]

    example_sqls = sorted(
        [{"id": newid(), "question": [q], "sql": [s]} for q, s in EXAMPLE_SQLS],
        key=lambda x: x["id"],
    )

    join_specs_built = sorted(
        [{"id": newid(), **js} for js in JOIN_SPECS],
        key=lambda x: x["id"],
    )

    return {
        "version": 2,
        "config": {
            "sample_questions": sample_qs,
        },
        "data_sources": {
            "tables": tables_sorted,
        },
        "instructions": {
            "text_instructions":   text_instr,
            "example_question_sqls": example_sqls,
            "join_specs": join_specs_built,
        },
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", default="DEFAULT",
                    help="Perfil ~/.databrickscfg (sempre explícito)")
    args = ap.parse_args()

    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    print(f"Perfil: {args.profile}")

    # Verifica tabelas opcionais
    tables = list(ALWAYS_TABLES)
    for t in OPTIONAL_TABLES:
        exists = table_exists(t, args.profile)
        status = "[OK] existe" if exists else "[PULANDO] nao existe"
        print(f"  {t}: {status}")
        if exists:
            tables.append(t)

    print(f"\nTabelas incluídas: {len(tables)}")
    for t in sorted(tables):
        print(f"  • {t}")

    space = build_space(tables)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(space, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n✅ Arquivo gerado: {OUTPUT}")
    print("\nPróximo passo:")
    print(f"  python3 scripts/genie.py publicar {OUTPUT} "
          f'--titulo "Farol · Diretoria + Contratos" --profile {args.profile}')


if __name__ == "__main__":
    main()
