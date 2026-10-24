import { z } from 'zod';
import type { Application, Request, Response } from 'express';

export const decisaoSchema = z
  .object({
    projeto_origem: z
      .string()
      .regex(/^PRJ-\d{3}$/, 'Projeto de origem inválido. Formato esperado: PRJ-XXX'),
    projeto_destino: z
      .string()
      .regex(/^PRJ-\d{3}$/, 'Projeto de destino inválido. Formato esperado: PRJ-XXX'),
    recurso_id: z
      .string()
      .regex(/^COL\d{4}$/, 'ID de colaborador inválido. Formato esperado: COLXXXX'),
    tipo: z.string().default('pessoa'),
    decisao: z.enum(['aprovada', 'recusada'], {
      message: "Decisão deve ser 'aprovada' ou 'recusada'",
    }),
    justificativa: z
      .string()
      .min(10, 'A justificativa deve conter no mínimo 10 caracteres')
      .max(1000, 'A justificativa deve conter no máximo 1000 caracteres'),
    horas_recuperadas_mes: z.coerce.number().min(0, 'Horas devem ser maior ou igual a 0'),
    economia_mes: z.coerce.number().min(0, 'Economia deve ser maior ou igual a 0'),
    dias_recuperados: z.coerce.number().min(0, 'Dias devem ser maior ou igual a 0'),
  })
  .refine((data) => data.projeto_origem !== data.projeto_destino, {
    message: 'Projeto de origem e projeto de destino devem ser diferentes',
    path: ['projeto_destino'],
  });

export type DecisaoInput = z.infer<typeof decisaoSchema>;

export interface LakebaseQueryClient {
  lakebase: {
    query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
  };
}

let schemaInitialized = false;

export async function ensureDecisoesSchema(appkit: LakebaseQueryClient): Promise<void> {
  if (schemaInitialized) return;
  await appkit.lakebase.query(`
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
  `);
  schemaInitialized = true;
}

export function registerDecisoesRoutes(app: Application, appkit: LakebaseQueryClient): void {
  // GET /api/quem-sou
  app.get('/api/quem-sou', (req: Request, res: Response) => {
    const rawHeader = req.headers['x-forwarded-email'];
    const email = (Array.isArray(rawHeader) ? rawHeader[0] : rawHeader) || 'usuario.local@vertice.com';
    res.json({ email });
  });

  // GET /api/decisoes (200 mais recentes)
  app.get('/api/decisoes', async (_req: Request, res: Response) => {
    try {
      await ensureDecisoesSchema(appkit);
      const result = await appkit.lakebase.query(`
        SELECT
          id,
          projeto_origem,
          projeto_destino,
          recurso_id,
          tipo,
          decisao,
          justificativa,
          horas_recuperadas_mes,
          economia_mes,
          dias_recuperados,
          usuario,
          criado_em
        FROM torre.decisoes
        ORDER BY id DESC
        LIMIT 200;
      `);
      res.json(result.rows ?? []);
    } catch (err: unknown) {
      console.error('Erro ao listar decisões:', err);
      res.status(500).json({ error: 'Erro ao consultar decisões no banco Lakebase' });
    }
  });

  // POST /api/decisoes
  app.post('/api/decisoes', async (req: Request, res: Response) => {
    try {
      const parsed = decisaoSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Dados de decisão inválidos',
          issues: parsed.error.issues,
        });
        return;
      }

      const data = parsed.data;
      const rawHeader = req.headers['x-forwarded-email'];
      const usuario = (Array.isArray(rawHeader) ? rawHeader[0] : rawHeader) || 'usuario.local@vertice.com';

      await ensureDecisoesSchema(appkit);

      const insertSql = `
        INSERT INTO torre.decisoes (
          projeto_origem,
          projeto_destino,
          recurso_id,
          tipo,
          decisao,
          justificativa,
          horas_recuperadas_mes,
          economia_mes,
          dias_recuperados,
          usuario
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *;
      `;

      const values = [
        data.projeto_origem,
        data.projeto_destino,
        data.recurso_id,
        data.tipo,
        data.decisao,
        data.justificativa,
        data.horas_recuperadas_mes,
        data.economia_mes,
        data.dias_recuperados,
        usuario,
      ];

      const result = await appkit.lakebase.query(insertSql, values);
      res.status(201).json(result.rows[0]);
    } catch (err: unknown) {
      console.error('Erro ao registrar decisão:', err);
      res.status(500).json({ error: 'Erro ao registrar decisão no banco Lakebase' });
    }
  });
}
