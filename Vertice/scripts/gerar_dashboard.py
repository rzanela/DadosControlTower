#!/usr/bin/env python3
"""Gera o dashboard de Portfólio da noite 3 (sobre a GOLD).

Uso:  python scripts/gerar_dashboard.py

Escreve resources/dashboard-portfolio.lvdash.json, que o bundle publica no
deploy (resources/dashboard.dashboard.yml). Compare o SQL dos datasets com o
da noite 1: sem CAST, sem replace, sem try_to_date. A limpeza mora na silver.
"""
from __future__ import annotations

import json
import pathlib

SAIDA = pathlib.Path(__file__).resolve().parents[1] / "resources" / "dashboard-portfolio.lvdash.json"

BRL = {"type": "number-currency", "currencyCode": "BRL", "abbreviation": "compact",
       "decimalPlaces": {"type": "max", "places": 1}}
BRL0 = {**BRL, "decimalPlaces": {"type": "max", "places": 0}}
PCT = {"type": "number-percent", "decimalPlaces": {"type": "max", "places": 1}}
NUM2 = {"type": "number-plain", "decimalPlaces": {"type": "max", "places": 2}}
CORES_SITUACAO = [{"value": "crítico", "color": "#FF5F46"}, {"value": "atenção", "color": "#F6C344"},
                  {"value": "ok", "color": "#22C2F4"}]

DATASETS = {
    "ds_kpis": ("KPIs da carteira em andamento", """
-- Razão não se soma: o SPI da carteira é SUM(ev) / SUM(pv), não a média dos SPIs.
-- Na noite 4 estas fórmulas mudam para a metric view mv_projetos (MEASURE(spi)).
SELECT SUM(valor_contrato) AS carteira,
       SUM(ev) / SUM(pv) AS spi,
       SUM(ev) / SUM(ac) AS cpi,
       SUM(estouro_previsto) AS estouro_previsto,
       (SUM(valor_contrato) - SUM(eac)) / SUM(valor_contrato) AS margem_projetada,
       COUNT_IF(situacao IN ('atenção', 'crítico')) AS projetos_em_risco,
       COUNT_IF(situacao = 'crítico') AS projetos_criticos,
       COUNT_IF(melancia) AS projetos_melancia
FROM projeto_situacao_atual
WHERE status = 'em_andamento'"""),
    "ds_projetos": ("Projetos em andamento hoje", """
SELECT projeto_id, projeto, cliente, segmento, ferramenta, situacao, spi, cpi, estouro_previsto, margem_projetada,
       atraso_projetado_dias, termino_projetado, farol_do_gerente, farol_calculado,
       CASE WHEN melancia THEN 'sim' ELSE '' END AS melancia, valor_contrato
FROM projeto_situacao_atual
WHERE status = 'em_andamento'"""),
    "ds_evolucao": ("Evolução semanal da carteira", """
-- PV, EV e AC já vêm acumulados por projeto: somar os projetos de UMA semana é válido.
SELECT semana, SUM(ev) / SUM(pv) AS spi, SUM(ev) / SUM(ac) AS cpi, SUM(horas_ociosas) AS horas_ociosas
FROM fato_projeto_semana
WHERE semana >= DATE'2025-03-07'
GROUP BY semana
ORDER BY semana"""),
    "ds_pessoas": ("Pessoas nas últimas 12 semanas", """
SELECT colaborador_id, nome, papel, senioridade, projeto_id, projeto,
       SUM(horas_apontadas) / SUM(horas_disponiveis) AS utilizacao,
       SUM(horas_ociosas) AS horas_ociosas, SUM(custo_ocioso) AS custo_ocioso, MIN(spi_do_projeto) AS spi_do_projeto
FROM utilizacao_pessoa_semana
WHERE semana > DATE'2026-07-24'
GROUP BY ALL
ORDER BY utilizacao"""),
    "ds_pessoas_top": ("Pessoas mais paradas (top 15)", """
SELECT concat(nome, ' · ', papel, ' · ', projeto_id) AS pessoa, SUM(custo_ocioso) AS custo_ocioso
FROM utilizacao_pessoa_semana
WHERE semana > DATE'2026-07-24'
GROUP BY 1
ORDER BY 2 DESC
LIMIT 15"""),
    "ds_bloqueios": ("Causas de bloqueio nos últimos 90 dias", """
SELECT s.projeto_id, p.projeto, s.causa_bloqueio, COUNT(*) AS semanas, SUM(coalesce(s.dias_impacto, 0)) AS dias_impacto
FROM status_estruturado s JOIN projeto_situacao_atual p USING (projeto_id)
WHERE s.data_status >= DATE'2026-07-18' AND s.causa_bloqueio NOT IN ('sem_bloqueio', 'nao_reportado')
  AND p.status = 'em_andamento'
GROUP BY ALL"""),
    "ds_fornecedores": ("Desempenho de fornecedor", """
-- Direto da silver: o nome da CodeForge já foi normalizado (4 grafias viraram 1).
SELECT fornecedor, COUNT(*) AS entregas, COUNT(DISTINCT fornecedor_como_veio) AS grafias_no_cadastro,
       AVG(prazo_real_dias / prazo_prometido_dias) AS fator_atraso,
       AVG(CASE WHEN data_entrega <= data_prometida THEN 1.0 ELSE 0.0 END) FILTER (WHERE data_entrega IS NOT NULL) AS pct_no_prazo,
       COUNT_IF(em_atraso) AS entregas_em_atraso
FROM lakehouse_vertice.silver.entregas_fornecedor
GROUP BY fornecedor
ORDER BY fator_atraso DESC"""),
    "ds_atrasadas": ("Entregas em atraso hoje", """
SELECT e.projeto_id, e.fornecedor, e.item, e.valor, e.data_prometida,
       datediff(DATE'2026-10-16', e.data_prometida) AS dias_de_atraso
FROM lakehouse_vertice.silver.entregas_fornecedor e
WHERE e.em_atraso
ORDER BY dias_de_atraso DESC"""),
}


def ds(nome):
    titulo, sql = DATASETS[nome]
    return {"name": nome, "displayName": titulo, "queryLines": [l + "\n" for l in sql.strip().split("\n")]}


def pos(x, y, w, h):
    return {"x": x, "y": y, "width": w, "height": h}


def texto(nome, md, p):
    return {"widget": {"name": nome, "textbox_spec": md}, "position": p}


def w(nome, dataset, campos, spec, p, desagregado=False):
    return {"widget": {"name": nome, "queries": [{"name": "main_query", "query": {
        "datasetName": dataset, "fields": [{"name": n, "expression": e} for n, e in campos],
        "disaggregated": desagregado}}], "spec": spec}, "position": p}


def kpi(nome, campo, titulo, fmt, p):
    return w(nome, "ds_kpis", [(campo, f"`{campo}`")],
             {"version": 2, "widgetType": "counter",
              "encodings": {"value": {"fieldName": campo, "displayName": titulo, "format": fmt}},
              "frame": {"showTitle": True, "title": titulo}}, p, desagregado=True)


def barra_h(nome, dataset, dim, med, expr, titulo, fmt, p, cor=None):
    enc = {"y": {"fieldName": dim, "scale": {"type": "categorical", "sort": {"by": "x-reversed"}}, "displayName": dim},
           "x": {"fieldName": med, "scale": {"type": "quantitative"}, "displayName": titulo, "format": fmt}}
    campos = [(dim, f"`{dim}`"), (med, expr)]
    if cor:
        campos.append((cor, f"`{cor}`"))
        enc["color"] = {"fieldName": cor, "scale": {"type": "categorical", "mappings": CORES_SITUACAO},
                        "displayName": cor}
    return w(nome, dataset, campos, {"version": 3, "widgetType": "bar", "encodings": enc,
                                     "frame": {"showTitle": True, "title": titulo}}, p)


def tabela(nome, dataset, colunas, titulo, p):
    return w(nome, dataset, [(c, f"`{c}`") for c, *_ in colunas],
             {"version": 2, "widgetType": "table",
              "encodings": {"columns": [dict(fieldName=c, displayName=d, **({"format": f[0]} if f else {}))
                                        for c, d, *f in colunas]},
              "frame": {"showTitle": True, "title": titulo}}, p, desagregado=True)


def montar() -> dict:
    portfolio = [
        texto("titulo", "# Projeto Farol · Portfólio\n\n**Quais projetos estão atrasados, de quais clientes, e quanto isso custa?** "
              "Agora sobre a camada **gold**, com Excel, ClickUp e MS Project integrados numa tabela só, "
              "limpos e testados toda segunda às 6h. Hoje do dataset: 16/10/2026.", pos(0, 0, 12, 3)),
        kpi("kpi-carteira", "carteira", "Carteira em andamento", BRL0, pos(0, 3, 3, 4)),
        kpi("kpi-spi", "spi", "SPI da carteira", NUM2, pos(3, 3, 3, 4)),
        kpi("kpi-cpi", "cpi", "CPI da carteira", NUM2, pos(6, 3, 3, 4)),
        kpi("kpi-estouro", "estouro_previsto", "Estouro previsto", BRL0, pos(9, 3, 3, 4)),
        kpi("kpi-risco", "projetos_em_risco", "Projetos em risco (< 0,9)", {"type": "number-plain"}, pos(0, 7, 4, 4)),
        kpi("kpi-criticos", "projetos_criticos", "Projetos críticos (< 0,8)", {"type": "number-plain"}, pos(4, 7, 4, 4)),
        kpi("kpi-melancia", "projetos_melancia", "Farol verde com SPI < 0,9", {"type": "number-plain"}, pos(8, 7, 4, 4)),
        barra_h("estouro-projeto", "ds_projetos", "projeto", "sum(estouro_previsto)", "SUM(`estouro_previsto`)",
                "Estouro previsto por projeto", BRL, pos(0, 11, 7, 8), cor="situacao"),
        w("spi-cpi", "ds_projetos", [("spi", "`spi`"), ("cpi", "`cpi`"), ("situacao", "`situacao`"), ("projeto", "`projeto`")],
          {"version": 3, "widgetType": "scatter",
           "encodings": {"x": {"fieldName": "spi", "scale": {"type": "quantitative"}, "displayName": "SPI (prazo)"},
                         "y": {"fieldName": "cpi", "scale": {"type": "quantitative"}, "displayName": "CPI (custo)"},
                         "color": {"fieldName": "situacao", "scale": {"type": "categorical", "mappings": CORES_SITUACAO},
                                   "displayName": "Situação"}},
           "frame": {"showTitle": True, "title": "Prazo × custo: cada ponto é um projeto"}}, pos(7, 11, 5, 8), True),
        w("evolucao", "ds_evolucao", [("semana", "`semana`"), ("spi", "`spi`"), ("cpi", "`cpi`")],
          {"version": 3, "widgetType": "line",
           "encodings": {"x": {"fieldName": "semana", "scale": {"type": "temporal"}, "displayName": "Semana"},
                         "y": {"scale": {"type": "quantitative"}, "fields": [
                             {"fieldName": "spi", "displayName": "SPI"}, {"fieldName": "cpi", "displayName": "CPI"}]}},
           "frame": {"showTitle": True, "title": "SPI e CPI da carteira, semana a semana"}}, pos(0, 19, 12, 6), True),
        tabela("tabela-projetos", "ds_projetos", [
            ("projeto", "Projeto"), ("cliente", "Cliente"), ("ferramenta", "Ferramenta"), ("situacao", "Situação"),
            ("spi", "SPI", NUM2), ("cpi", "CPI", NUM2), ("farol_do_gerente", "Farol do gerente"),
            ("farol_calculado", "Farol pelo número"), ("melancia", "Melancia"),
            ("estouro_previsto", "Estouro previsto", BRL), ("margem_projetada", "Margem projetada", PCT),
            ("atraso_projetado_dias", "Atraso projetado (dias)"), ("termino_projetado", "Término projetado")],
               "Projetos em andamento", pos(0, 25, 12, 9)),
    ]
    pessoas = [
        texto("titulo-pessoas", "# Gente parada\n\n**Tenho gente parada enquanto outro projeto pede gente?** "
              "Utilização do timesheet nas últimas 12 semanas, e as causas de bloqueio que a IA tirou do status semanal.",
              pos(0, 0, 12, 2)),
        barra_h("pessoas-ociosas", "ds_pessoas_top", "pessoa", "sum(custo_ocioso)", "SUM(`custo_ocioso`)",
                "Custo da hora parada (top 15)", BRL, pos(0, 2, 6, 8)),
        tabela("tabela-pessoas", "ds_pessoas", [
            ("nome", "Pessoa"), ("papel", "Papel"), ("senioridade", "Senioridade"), ("projeto", "Projeto"),
            ("utilizacao", "Utilização", PCT), ("horas_ociosas", "Horas paradas"),
            ("custo_ocioso", "Custo parado", BRL)], "Pessoas: da mais parada à mais ocupada", pos(6, 2, 6, 8)),
        w("bloqueios", "ds_bloqueios", [("projeto", "`projeto`"), ("causa_bloqueio", "`causa_bloqueio`"),
                                        ("sum(semanas)", "SUM(`semanas`)")],
          {"version": 3, "widgetType": "bar",
           "encodings": {"y": {"fieldName": "projeto", "scale": {"type": "categorical", "sort": {"by": "x-reversed"}},
                               "displayName": "Projeto"},
                         "x": {"fieldName": "sum(semanas)", "scale": {"type": "quantitative"},
                               "displayName": "Semanas com bloqueio"},
                         "color": {"fieldName": "causa_bloqueio", "scale": {"type": "categorical"},
                                   "displayName": "Causa (IA)"}},
           "frame": {"showTitle": True, "title": "Por que travou: causas no status semanal (últimos 90 dias)"}},
          pos(0, 10, 12, 9)),
    ]
    fornecedores = [
        texto("titulo-forn", "# Fornecedores\n\n**Quem promete e não cumpre?** Prazo real ÷ prometido de cada consultoria. "
              "A CodeForge veio escrita de 4 jeitos no cadastro de compras: sem normalizar, ela sumia do ranking.",
              pos(0, 0, 12, 2)),
        tabela("fornecedores", "ds_fornecedores", [
            ("fornecedor", "Fornecedor"), ("grafias_no_cadastro", "Grafias"), ("entregas", "Entregas"),
            ("fator_atraso", "Real ÷ prometido", NUM2), ("pct_no_prazo", "No prazo", PCT),
            ("entregas_em_atraso", "Em atraso hoje")], "Fornecedores: do que mais atrasa ao que menos atrasa", pos(0, 2, 12, 6)),
        tabela("atrasadas", "ds_atrasadas", [
            ("projeto_id", "Projeto"), ("fornecedor", "Fornecedor"), ("item", "Item"), ("valor", "Valor", BRL),
            ("data_prometida", "Prometida para"), ("dias_de_atraso", "Dias de atraso")],
               "Entregas em atraso hoje", pos(0, 8, 12, 6)),
    ]
    pagina = lambda n, t, l: {"name": n, "displayName": t, "pageType": "PAGE_TYPE_CANVAS",
                              "layoutVersion": "GRID_V1", "layout": l}
    return {
        "datasets": [ds(n) for n in DATASETS],
        "pages": [pagina("portfolio", "Portfólio", portfolio), pagina("pessoas", "Pessoas", pessoas),
                  pagina("fornecedores", "Fornecedores", fornecedores)],
        "uiSettings": {"theme": {
            "canvasBackgroundColor": {"light": "#F5F6FC", "dark": "#14141A"},
            "widgetBackgroundColor": {"light": "#FFFFFF", "dark": "#1E1E24"},
            "fontColor": {"light": "#14141A", "dark": "#F5F6FC"},
            "selectionColor": {"light": "#0059DB", "dark": "#22C2F4"},
            "visualizationColors": ["#0059DB", "#22C2F4", "#F6C344", "#FF8A4C", "#9B6BDB", "#3ECF8E", "#6E7180"],
            "widgetHeaderAlignment": "LEFT", "widgetCornerRadius": 12}},
    }


if __name__ == "__main__":
    SAIDA.write_text(json.dumps(montar(), ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"ok: {SAIDA}")
