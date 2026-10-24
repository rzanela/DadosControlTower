import { describe, expect, it } from 'vitest';
import { decisaoSchema } from './routes/decisoes.js';

describe('decisaoSchema (Zod Validation)', () => {
  const validPayload = {
    projeto_origem: 'PRJ-001',
    projeto_destino: 'PRJ-011',
    recurso_id: 'COL0017',
    tipo: 'pessoa',
    decisao: 'aprovada',
    justificativa: 'Alocação de especialista SRE para mitigar atraso crítico no cronograma.',
    horas_recuperadas_mes: 150.8,
    economia_mes: 30160.0,
    dias_recuperados: 15.0,
  };

  it('aceita payload de decisão válido com dados completos', () => {
    const result = decisaoSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.decisao).toBe('aprovada');
      expect(result.data.projeto_origem).toBe('PRJ-001');
      expect(result.data.projeto_destino).toBe('PRJ-011');
      expect(result.data.recurso_id).toBe('COL0017');
    }
  });

  it('aceita payload de decisão com decisão "recusada"', () => {
    const result = decisaoSchema.safeParse({
      ...validPayload,
      decisao: 'recusada',
      justificativa: 'Recusado devido à incompatibilidade de cronograma e custos.',
    });
    expect(result.success).toBe(true);
  });

  it('faz coerce de números passados como string', () => {
    const result = decisaoSchema.safeParse({
      ...validPayload,
      horas_recuperadas_mes: '120.5',
      economia_mes: '24100',
      dias_recuperados: '10',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.horas_recuperadas_mes).toBe(120.5);
      expect(result.data.economia_mes).toBe(24100);
      expect(result.data.dias_recuperados).toBe(10);
    }
  });

  it('recusa justificativa curta (menos de 10 caracteres)', () => {
    const result = decisaoSchema.safeParse({
      ...validPayload,
      justificativa: 'Curto',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('no mínimo 10 caracteres');
    }
  });

  it('recusa justificativa com mais de 1000 caracteres', () => {
    const result = decisaoSchema.safeParse({
      ...validPayload,
      justificativa: 'a'.repeat(1001),
    });
    expect(result.success).toBe(false);
  });

  it('recusa projeto_origem ou projeto_destino fora do padrão ^PRJ-\\d{3}$', () => {
    // Código fora do padrão
    const resultOrigem = decisaoSchema.safeParse({
      ...validPayload,
      projeto_origem: 'PRJ-1',
    });
    expect(resultOrigem.success).toBe(false);

    const resultDestino = decisaoSchema.safeParse({
      ...validPayload,
      projeto_destino: 'PROJETO-011',
    });
    expect(resultDestino.success).toBe(false);
  });

  it('recusa pessoa/recurso fora do padrão ^COL\\d{4}$', () => {
    const resultPessoaInvalida1 = decisaoSchema.safeParse({
      ...validPayload,
      recurso_id: 'COL01',
    });
    expect(resultPessoaInvalida1.success).toBe(false);

    const resultPessoaInvalida2 = decisaoSchema.safeParse({
      ...validPayload,
      recurso_id: 'USER1234',
    });
    expect(resultPessoaInvalida2.success).toBe(false);
  });

  it('recusa quando projeto_origem é igual a projeto_destino', () => {
    const result = decisaoSchema.safeParse({
      ...validPayload,
      projeto_origem: 'PRJ-011',
      projeto_destino: 'PRJ-011',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('devem ser diferentes');
    }
  });

  it('recusa decisão inválida que não seja aprovada ou recusada', () => {
    const result = decisaoSchema.safeParse({
      ...validPayload,
      decisao: 'pendente',
    });
    expect(result.success).toBe(false);

    const resultRejeitada = decisaoSchema.safeParse({
      ...validPayload,
      decisao: 'rejeitada',
    });
    expect(resultRejeitada.success).toBe(false);
  });
});
