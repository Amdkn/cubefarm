import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import express, { type NextFunction, type Request, type Response } from 'express';
import { WebSocketServer } from 'ws';
import { DEMO, PORT, STATE_FILE, WORKSPACE_ROOT } from './config.ts';
import { realBackend } from './backend.ts';
import { createDemoBackend } from './demo.ts';
import { HttpError, Swarm } from './swarm.ts';

const swarm = new Swarm(DEMO ? createDemoBackend() : realBackend);
await swarm.init();

const app = express();
app.use(express.json({ limit: '1mb' }));

type Handler = (req: Request, res: Response) => Promise<unknown> | unknown;
const route = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await fn(req, res);
    if (!res.headersSent) res.json(out ?? { ok: true });
  } catch (err) {
    next(err);
  }
};
const num = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Invalid number: ${v}`);
  return n;
};
const str = (v: unknown) => (typeof v === 'string' ? v : '');
// Repo ids contain a slash ("owner/name"), so they travel URL-encoded as a single segment.
const repoId = (req: Request) => decodeURIComponent(String(req.params.repo));

app.get('/api/state', route(() => swarm.snapshot()));

app.get('/api/github/repos', route((req) => swarm.listGithubRepos(str(req.query.owner) || undefined)));

app.post('/api/repos', route((req) => swarm.connectRepo(str(req.body.fullName).trim())));
app.post(
  '/api/repos/new',
  route((req) =>
    swarm.createRepo(str(req.body.name).trim(), {
      description: str(req.body.description),
      visibility: req.body.visibility === 'public' ? 'public' : 'private',
      owner: str(req.body.owner).trim() || undefined,
    }),
  ),
);
app.patch('/api/repos/:repo', route((req) => swarm.updateRepo(repoId(req), req.body ?? {})));
app.delete('/api/repos/:repo', route((req) => swarm.disconnectRepo(repoId(req))));
app.post('/api/repos/:repo/sync', route((req) => swarm.syncRepo(repoId(req))));
app.post(
  '/api/repos/:repo/issues',
  route(async (req) => ({ number: await swarm.createIssue(repoId(req), str(req.body.title), str(req.body.body), str(req.body.assignTo) || undefined) })),
);
app.post('/api/repos/:repo/pulls/:n/merge', route((req) => swarm.mergePull(repoId(req), num(req.params.n), req.body?.method ?? 'squash')));
app.post('/api/repos/:repo/pulls/:n/close', route((req) => swarm.closePull(repoId(req), num(req.params.n))));
app.post('/api/repos/:repo/pulls/:n/qa', route((req) => swarm.sendToQa(repoId(req), num(req.params.n))));
app.post('/api/repos/:repo/agents', route((req) => swarm.hireAgent(repoId(req), { name: str(req.body.name), model: str(req.body.model), effort: str(req.body.effort), role: str(req.body.role), look: str(req.body.look) })));

app.patch('/api/agents/:id', route((req) => swarm.updateAgent(String(req.params.id), req.body ?? {})));
app.delete('/api/agents/:id', route((req) => swarm.fireAgent(String(req.params.id))));
app.post('/api/agents/:id/assign', route((req) => swarm.assign(String(req.params.id), num(req.body.issueNumber), str(req.body.note) || undefined)));
app.post('/api/agents/:id/stop', route((req) => swarm.stopAgent(String(req.params.id))));
app.post('/api/agents/:id/reset', route((req) => swarm.resetAgent(String(req.params.id))));
app.post('/api/agents/:id/message', route((req) => swarm.message(String(req.params.id), str(req.body.text))));
app.get('/api/agents/:id/screen', (req, res) => {
  const shot = swarm.screenshot(String(req.params.id));
  if (!shot) return void res.status(404).end();
  res.setHeader('Content-Type', shot.mime);
  res.setHeader('Cache-Control', 'no-store');
  res.end(shot.data);
});

app.patch('/api/settings', route((req) => swarm.updateSettings(req.body ?? {})));

// Serve the built client when running `npm start` after `npm run build`.
const dist = path.resolve(import.meta.dirname, '../dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : 500;
  const message = err instanceof Error ? err.message : String(err);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: message });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => swarm.addClient(ws));

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  🏢 Office Swarm server on http://localhost:${PORT}${DEMO ? '  (DEMO MODE: fake GitHub + fake agents)' : ''}`);
  console.log(`     state: ${STATE_FILE}`);
  console.log(`     workspaces: ${WORKSPACE_ROOT}\n`);
});
