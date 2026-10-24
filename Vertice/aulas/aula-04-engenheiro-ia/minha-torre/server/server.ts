import { createApp, analytics, genie, lakebase, server } from '@databricks/appkit';
import { registerDecisoesRoutes } from './routes/decisoes.js';

createApp({
  plugins: [
    analytics(),
    genie(),
    lakebase(),
    server(),
  ],
  cache: {
    enabled: false,
  },
  onPluginsReady(appkit) {
    appkit.server.extend((app) => {
      // Endpoint score-estouro (Prompt 02)
      app.get('/api/score-estouro', async (_req, res) => {
        try {
          const rows: unknown = await appkit.analytics.query(
            'SELECT * FROM lakehouse_vertice.gold.score_estouro_30d'
          );
          const data = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
          res.json({ disponivel: true, linhas: data });
        } catch {
          res.json({ disponivel: false, linhas: [] });
        }
      });

      // Endpoints de Decisões Lakebase (Prompt 03)
      registerDecisoesRoutes(app, appkit);
    });
  },
}).catch(console.error);
