/**
 * Dev bridge: serves the same handler modules Vercel runs in production on :8787.
 * `npm run dev` proxies /api here, so local development exercises the real routes.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import parseIntake from '../api/parse-intake';
import suggestIdeas from '../api/suggest-ideas';
import reviewPlan from '../api/review-plan';
import askPlanner from '../api/ask-planner';
import extractQuote from '../api/extract-quote';
import proposePatch from '../api/propose-patch';

const routes: Record<string, (req: IncomingMessage, res: ServerResponse) => Promise<void>> = {
  '/api/parse-intake': parseIntake,
  '/api/suggest-ideas': suggestIdeas,
  '/api/review-plan': reviewPlan,
  '/api/ask-planner': askPlanner,
  '/api/extract-quote': extractQuote,
  '/api/propose-patch': proposePatch,
};

const port = Number(process.env.API_PORT ?? 8787);

createServer((req, res) => {
  const path = req.url?.split('?')[0] ?? '';
  const handler = routes[path];
  if (handler === undefined) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'NOT_FOUND' }));
    return;
  }
  handler(req, res).catch(() => {
    if (!res.writableEnded) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'INTERNAL_ERROR' }));
    }
  });
}).listen(port, () => {
  console.log(`Utsav API bridge on http://localhost:${port}`);
});
