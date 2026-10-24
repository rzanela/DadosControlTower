import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Projeto Farol - Simulador & Regras de Negócio', () => {
  it('calcula corretamente os indicadores do simulador para especialista SRE', () => {
    // Exemplo: Karina Ferraz (SRE)
    const horasParadasMediaSemana = 37.7;
    const custoOciosoMedioSemana = 7540.0;
    const custoHora = 200.0;
    const onboardingHours = 40;

    // Projeto com 45 dias de impacto por falta de SRE nos últimos 90 dias
    const diasImpactoFaltaSre = 45.0;

    const horasMes = horasParadasMediaSemana * 4;
    const economiaMes = custoOciosoMedioSemana * 4;
    const diasRecuperadosMes = (diasImpactoFaltaSre / 90) * 30;
    const custoMobilizacao = onboardingHours * custoHora;
    const saldoLiquido = economiaMes - custoMobilizacao;

    expect(horasMes).toBeCloseTo(150.8, 1);
    expect(economiaMes).toBe(30160.0);
    expect(diasRecuperadosMes).toBeCloseTo(15.0, 1);
    expect(custoMobilizacao).toBe(8000.0);
    expect(saldoLiquido).toBe(22160.0);
    expect(saldoLiquido).toBeGreaterThan(0);
  });

  it('valida existência e integridade dos arquivos de queries SQL', () => {
    const queriesDir = path.resolve(__dirname, '../config/queries');
    const requiredQueries = ['kpis.sql', 'projetos_risco.sql', 'pessoas_ociosas.sql'];

    for (const file of requiredQueries) {
      const fullPath = path.join(queriesDir, file);
      expect(fs.existsSync(fullPath)).toBe(true);
      const content = fs.readFileSync(fullPath, 'utf-8');
      expect(content.length).toBeGreaterThan(50);
      expect(content.toUpperCase()).toContain('SELECT');
    }
  });
});
