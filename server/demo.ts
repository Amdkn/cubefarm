import path from 'node:path';
import type { Backend } from './backend.ts';
import type { LogEntry, SessionCallbacks, SessionHandle, SessionOptions } from './agentRunner.ts';
import type { GhRepoSummary, IssueInfo, PullInfo } from '../shared/types.ts';

// `npm run demo`: a fake GitHub and fake Claude Code sessions, so the office (including the
// dev → QA → fix loop) can be explored without spending any usage or touching real repos.

interface FakeRepo {
  fullName: string;
  description: string;
  issues: IssueInfo[];
  pulls: PullInfo[];
  nextNumber: number;
}

const now = () => new Date().toISOString();

function issue(n: number, title: string, body: string, fullName: string, labels: string[] = []): IssueInfo {
  return { number: n, title, body, url: `https://github.com/${fullName}/issues/${n}`, labels, createdAt: now() };
}

const repos = new Map<string, FakeRepo>();

function seed(fullName: string, description: string, titles: [string, string][]) {
  const r: FakeRepo = { fullName, description, issues: [], pulls: [], nextNumber: 1 };
  for (const [title, body] of titles) r.issues.push(issue(r.nextNumber++, title, body, fullName));
  repos.set(fullName, r);
}

seed('demo-co/pixel-todo', 'A cheerful todo app', [
  ['Add dark mode toggle', 'Users want a dark theme. Persist the choice in localStorage.'],
  ['Todos should support due dates', 'Add an optional due date and highlight overdue items.'],
  ['Drag and drop to reorder', 'Let users reorder todos by dragging.'],
  ['Empty state illustration', 'Show a friendly illustration when the list is empty.'],
  ['Keyboard shortcuts', 'N for new todo, / to search, ? for help.'],
  ['Fix: completed count off by one', 'The footer shows one more completed item than there is.'],
]);
seed('demo-co/weather-api', 'Tiny weather REST API', [
  ['Add /forecast endpoint', 'Return a 5-day forecast for a city.'],
  ['Rate limit anonymous callers', '60 requests per minute per IP.'],
  ['OpenAPI spec', 'Publish an OpenAPI 3.1 document at /openapi.json.'],
]);

function screenshotSvg(title: string, url: string, hue: number) {
  const safe = (s: string) => s.replace(/[<>&"]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">
  <rect width="640" height="400" fill="hsl(${hue},60%,97%)"/>
  <rect width="640" height="56" fill="hsl(${hue},70%,55%)"/>
  <text x="24" y="37" font-family="Segoe UI, Arial" font-size="22" font-weight="700" fill="#fff">${safe(title)}</text>
  <text x="620" y="36" text-anchor="end" font-family="Segoe UI, Arial" font-size="13" fill="#fff">${safe(url)}</text>
  ${[0, 1, 2, 3]
    .map(
      (i) => `<rect x="24" y="${84 + i * 70}" width="592" height="56" rx="10" fill="#fff" stroke="hsl(${hue},40%,85%)"/>
  <circle cx="54" cy="${112 + i * 70}" r="11" fill="none" stroke="hsl(${hue},60%,55%)" stroke-width="3"/>
  <rect x="80" y="${104 + i * 70}" width="${180 + ((i * 97) % 220)}" height="14" rx="7" fill="hsl(${hue},25%,80%)"/>`,
    )
    .join('\n')}
</svg>`;
}

type Step = LogEntry[] | (() => void);

function devScript(opts: SessionOptions, cb: SessionCallbacks, issueNumber: number, issueTitle: string): Step[] {
  const branch = path.basename(opts.cwd);
  const hue = (issueNumber * 67) % 360;
  const file = ['src/App.tsx', 'src/components/TodoList.tsx', 'src/api/routes.ts', 'src/styles.css'][issueNumber % 4];
  const port = 5200 + (issueNumber % 50);
  return [
    [{ kind: 'text', text: `● I'll start by getting familiar with the codebase for "${issueTitle}".` }],
    [{ kind: 'tool', tool: 'Glob', text: '⏺ Glob src/**/*.{ts,tsx}' }, { kind: 'result', text: '  ⎿ Found 23 files' }],
    [{ kind: 'tool', tool: 'Read', text: `⏺ Read ${file}` }, { kind: 'result', text: '  ⎿ Read 184 lines' }],
    [{ kind: 'thinking', text: '✻ Thinking…' }],
    [
      { kind: 'tool', tool: 'TodoWrite', text: '⏺ Update todo list' },
      { kind: 'result', text: '  ◐ Understand current behaviour' },
      { kind: 'result', text: '  ☐ Implement the change' },
      { kind: 'result', text: '  ☐ Add tests' },
      { kind: 'result', text: '  ☐ Verify in the browser' },
    ],
    [{ kind: 'tool', tool: 'Grep', text: '⏺ Grep "useTodos"' }, { kind: 'result', text: '  ⎿ Found 6 matches in 4 files' }],
    [{ kind: 'text', text: "● The state lives in a single hook. I'll extend it and keep the API backwards compatible." }],
    [{ kind: 'tool', tool: 'Edit', text: `⏺ Edit ${file}` }, { kind: 'result', text: '  ⎿ Updated' }],
    [{ kind: 'tool', tool: 'Write', text: '⏺ Write src/__tests__/feature.test.ts' }, { kind: 'result', text: '  ⎿ Saved' }],
    [{ kind: 'tool', tool: 'Bash', text: '⏺ $ npm test -- --run' }],
    [
      { kind: 'result', text: '  ⎿ ✓ src/__tests__/feature.test.ts (4 tests) 38ms' },
      { kind: 'result', text: '    Test Files  7 passed (7)' },
    ],
    [{ kind: 'tool', tool: 'Bash', text: `⏺ $ npm run dev -- --port ${port} &` }, { kind: 'result', text: '  ⎿ VITE ready in 412 ms' }],
    () => cb.browserUrl(`http://localhost:${port}/`),
    [{ kind: 'tool', tool: 'mcp__playwright__browser_navigate', text: `⏺ 🌐 navigate http://localhost:${port}/` }, { kind: 'result', text: `  ⎿ Page URL: http://localhost:${port}/` }],
    () => cb.screenshot(Buffer.from(screenshotSvg(issueTitle, `localhost:${port}`, hue)), 'image/svg+xml'),
    [{ kind: 'tool', tool: 'mcp__playwright__browser_take_screenshot', text: '⏺ 🌐 take_screenshot' }, { kind: 'result', text: '  ⎿ Took a screenshot of the current page' }],
    [{ kind: 'text', text: '● Looks right in the browser. Committing and opening a PR.' }],
    [{ kind: 'tool', tool: 'Bash', text: `⏺ $ git commit -am "feat: ${issueTitle.toLowerCase()}"` }, { kind: 'result', text: `  ⎿ [${branch} 3f2a91c] feat: ${issueTitle.toLowerCase()}` }],
    [{ kind: 'tool', tool: 'Bash', text: '⏺ $ git push -u origin HEAD' }, { kind: 'result', text: '  ⎿ branch set up to track origin' }],
    [{ kind: 'tool', tool: 'Bash', text: `⏺ $ gh pr create --title "${issueTitle}" --body "Closes #${issueNumber}"` }],
  ];
}

function qaScript(cb: SessionCallbacks, pr: number, title: string, round: number): Step[] {
  const port = 5600 + (pr % 50);
  const hue = (pr * 41) % 360;
  return [
    [{ kind: 'text', text: `● Testing PR #${pr} "${title}" (round ${round}). First, the acceptance criteria from the issue.` }],
    [{ kind: 'tool', tool: 'Bash', text: '⏺ $ git diff origin/main...HEAD --stat' }, { kind: 'result', text: '  ⎿  3 files changed, 82 insertions(+), 9 deletions(-)' }],
    [{ kind: 'tool', tool: 'Bash', text: '⏺ $ npm ci && npm test -- --run' }],
    [
      { kind: 'result', text: '  ⎿ Test Files  8 passed (8)' },
      { kind: 'result', text: '    Tests  41 passed (41)' },
    ],
    [{ kind: 'tool', tool: 'Bash', text: '⏺ $ npm run lint && npm run build' }, { kind: 'result', text: '  ⎿ ✓ built in 1.84s' }],
    [{ kind: 'tool', tool: 'Bash', text: `⏺ $ npm run preview -- --port ${port} &` }, { kind: 'result', text: `  ⎿ Local: http://localhost:${port}/` }],
    () => cb.browserUrl(`http://localhost:${port}/`),
    [{ kind: 'tool', tool: 'mcp__playwright__browser_navigate', text: `⏺ 🌐 navigate http://localhost:${port}/` }, { kind: 'result', text: `  ⎿ Page URL: http://localhost:${port}/` }],
    () => cb.screenshot(Buffer.from(screenshotSvg(`QA · ${title}`, `localhost:${port}`, hue)), 'image/svg+xml'),
    [{ kind: 'tool', tool: 'mcp__playwright__browser_take_screenshot', text: '⏺ 🌐 take_screenshot' }, { kind: 'result', text: '  ⎿ Took a screenshot of the current page' }],
    [{ kind: 'tool', tool: 'mcp__playwright__browser_click', text: '⏺ 🌐 click "Add todo" button' }, { kind: 'result', text: '  ⎿ Clicked' }],
    [{ kind: 'tool', tool: 'mcp__playwright__browser_resize', text: '⏺ 🌐 resize 375x740' }, { kind: 'result', text: '  ⎿ Resized' }],
    () => cb.screenshot(Buffer.from(screenshotSvg(`QA · mobile · ${title}`, `localhost:${port}`, (hue + 40) % 360)), 'image/svg+xml'),
    [{ kind: 'tool', tool: 'mcp__playwright__browser_take_screenshot', text: '⏺ 🌐 take_screenshot' }, { kind: 'result', text: '  ⎿ Took a screenshot of the current page' }],
    [{ kind: 'tool', tool: 'mcp__playwright__browser_console_messages', text: '⏺ 🌐 console_messages' }, { kind: 'result', text: '  ⎿ No errors' }],
  ];
}

function fixScript(pr: number): Step[] {
  return [
    [{ kind: 'text', text: `● Reading the QA report for PR #${pr}. The toolbar overflows on phones; I'll let it wrap.` }],
    [{ kind: 'tool', tool: 'Read', text: '⏺ Read src/styles.css' }, { kind: 'result', text: '  ⎿ Read 212 lines' }],
    [{ kind: 'tool', tool: 'Edit', text: '⏺ Edit src/styles.css' }, { kind: 'result', text: '  ⎿ Updated' }],
    [{ kind: 'tool', tool: 'Bash', text: '⏺ $ npm test -- --run' }, { kind: 'result', text: '  ⎿ Test Files  8 passed (8)' }],
    [{ kind: 'tool', tool: 'Bash', text: '⏺ $ git commit -am "fix: wrap toolbar on narrow screens" && git push origin HEAD' }, { kind: 'result', text: '  ⎿ pushed' }],
  ];
}

function fakeSession(opts: SessionOptions, cb: SessionCallbacks, fullName: string): SessionHandle {
  const timers: NodeJS.Timeout[] = [];
  let stopped = false;
  const kind = opts.role === 'qa' ? 'qa' : /FAILED|taking over pull request/.test(opts.prompt) ? 'fix' : 'issue';
  const prMatch = opts.prompt.match(/pull request #(\d+)(?::\s*(.+))?/);
  const issueMatch = opts.prompt.match(/#(\d+):\s*(.+)/);
  const number = Number((kind === 'issue' ? issueMatch?.[1] : prMatch?.[1]) ?? 0);
  const title = (kind === 'issue' ? issueMatch?.[2] : prMatch?.[2])?.trim() ?? 'follow-up';
  const round = Number(opts.prompt.match(/QA round (\d+)/)?.[1] ?? 1);

  const header: Step = [
    { kind: 'system', text: `✻ Claude Code (demo) · ${opts.model} · ${opts.effort} effort · ${opts.permissionMode}` },
    { kind: 'system', text: `  cwd ${opts.cwd}` },
  ];
  const body = kind === 'qa' ? qaScript(cb, number, title, round) : kind === 'fix' ? fixScript(number) : devScript(opts, cb, number, title);
  const script = [header, ...body];

  const finish = () => {
    const costUsd = 0.3 + Math.random();
    const turns = 15 + Math.floor(Math.random() * 20);
    cb.tool(null);
    if (kind === 'qa') {
      // Most first rounds pass; some fail so the fix loop can be seen in action.
      const pass = round > 1 || Math.random() > 0.35;
      cb.log([{ kind: 'text', text: pass ? '● Everything checks out. Writing up the report.' : '● The toolbar overflows on a 375px screen. Failing this round.' }]);
      cb.finished({
        ok: true,
        text: '',
        costUsd,
        turns,
        errors: [],
        structured: {
          verdict: pass ? 'pass' : 'fail',
          summary: pass
            ? 'The change does what the issue asks: the feature works on desktop and mobile, all 41 tests pass, and lint and build are clean.'
            : 'The feature works on desktop, but on a 375px-wide screen the toolbar overflows and the new button is cut off.',
          checks: [
            { name: 'Unit tests', result: 'pass', details: '41 passed, 0 failed' },
            { name: 'Lint + build', result: 'pass', details: 'No lint errors; production build succeeds' },
            { name: 'Feature works on desktop', result: 'pass', details: 'Clicked through the new flow at 1280x800' },
            { name: 'Mobile layout (375px)', result: pass ? 'pass' : 'fail', details: pass ? 'Layout wraps correctly' : 'Toolbar overflows horizontally; button unreachable' },
            { name: 'Console errors', result: 'pass', details: 'None' },
          ],
          commands: [
            { command: 'npm test -- --run', result: '41 passed' },
            { command: 'npm run lint && npm run build', result: 'clean, built in 1.84s' },
          ],
          screenshots: ['Desktop view after the change', 'Mobile view at 375px'],
          fixInstructions: pass ? undefined : 'Make the toolbar wrap (flex-wrap: wrap) below 480px so every button stays visible.',
        },
      });
      return;
    }
    if (kind === 'fix') {
      cb.log([{ kind: 'text', text: `● Fixed the mobile overflow on PR #${number} and pushed. Ready for another QA round.` }]);
      cb.finished({ ok: true, text: '', costUsd, turns, errors: [] });
      return;
    }
    const repo = repos.get(fullName);
    let url = '';
    if (repo && number) {
      const n = repo.nextNumber++;
      url = `https://github.com/${fullName}/pull/${n}`;
      repo.pulls.unshift({
        number: n,
        title,
        url,
        headRefName: `swarm/issue-${number}-${path.basename(opts.cwd).replace(/-[0-9a-f]{4}$/, '')}`,
        state: 'OPEN',
        isDraft: false,
        mergeable: 'MERGEABLE',
        reviewDecision: null,
        closesIssues: [number],
        createdAt: now(),
        mergedAt: null,
        additions: 40 + ((number * 13) % 200),
        deletions: (number * 7) % 40,
        checks: 'passing',
      });
      cb.log([{ kind: 'result', text: `  ⎿ ${url}` }]);
    }
    cb.log([{ kind: 'text', text: `● Opened ${url || 'the pull request'}. It closes #${number} and includes tests.` }]);
    cb.finished({ ok: true, text: url, costUsd, turns, errors: [] });
  };

  let i = 0;
  const step = () => {
    if (stopped) return;
    if (i >= script.length) return finish();
    const s = script[i++];
    if (typeof s === 'function') s();
    else {
      const tool = s.find((e) => e.kind === 'tool');
      cb.tool(tool?.tool ?? null);
      cb.log(s);
    }
    timers.push(setTimeout(step, 1600 + Math.random() * 3800));
  };
  timers.push(setTimeout(step, 600));

  return {
    send(text) {
      timers.push(
        setTimeout(() => {
          if (stopped) return;
          cb.log([{ kind: 'text', text: `● Got it — "${text.slice(0, 60)}". Adjusting my approach.` }]);
        }, 1500),
      );
    },
    stop() {
      stopped = true;
      timers.forEach(clearTimeout);
      cb.finished({ ok: false, text: '', costUsd: 0.1, turns: i, errors: ['Stopped by manager'] });
    },
  };
}

export function createDemoBackend(): Backend {
  // Tie each fake session back to its repo via the desk directory name.
  const deskRepo = new Map<string, string>();
  return {
    demo: true,
    user: async () => 'demo-manager',
    listMyRepos: async (): Promise<GhRepoSummary[]> =>
      [...repos.values()].map((r) => ({ nameWithOwner: r.fullName, description: r.description, visibility: 'PUBLIC', updatedAt: now() })),
    repoMeta: async (fullName) => {
      const r = repos.get(fullName);
      if (!r) throw new Error(`Unknown demo repo ${fullName}`);
      return { nameWithOwner: fullName, description: r.description, url: `https://github.com/${fullName}`, defaultBranch: 'main' };
    },
    createRepo: async (name, opts) => {
      const fullName = `${opts.owner ?? 'demo-co'}/${name}`;
      repos.set(fullName, { fullName, description: opts.description ?? '', issues: [], pulls: [], nextNumber: 1 });
      return fullName;
    },
    listIssues: async (fullName) => [...(repos.get(fullName)?.issues ?? [])],
    listPulls: async (fullName) => [...(repos.get(fullName)?.pulls ?? [])],
    createIssue: async (fullName, title, body) => {
      const r = repos.get(fullName);
      if (!r) throw new Error('Unknown repo');
      const n = r.nextNumber++;
      r.issues.push(issue(n, title, body, fullName));
      return n;
    },
    mergePull: async (fullName, number) => {
      const r = repos.get(fullName);
      const pr = r?.pulls.find((p) => p.number === number);
      if (!r || !pr) throw new Error('Unknown PR');
      pr.state = 'MERGED';
      pr.mergedAt = now();
      r.issues = r.issues.filter((i) => !pr.closesIssues.includes(i.number));
    },
    closePull: async (fullName, number) => {
      const pr = repos.get(fullName)?.pulls.find((p) => p.number === number);
      if (pr) pr.state = 'CLOSED';
    },
    prForBranch: async () => null,
    prDetails: async (fullName, number) => {
      const pr = repos.get(fullName)?.pulls.find((p) => p.number === number);
      if (!pr) throw new Error(`Unknown PR #${number}`);
      return {
        number,
        title: pr.title,
        body: `Implements the change.\n\nCloses #${pr.closesIssues[0] ?? '?'}`,
        url: pr.url,
        headRefName: pr.headRefName,
        headSha: '3f2a91c',
        isCrossRepository: false,
        closesIssues: pr.closesIssues,
        state: pr.state,
      };
    },
    issueDetails: async (fullName, number) => {
      const i = repos.get(fullName)?.issues.find((x) => x.number === number);
      return { title: i?.title ?? `Issue #${number}`, body: i?.body ?? '' };
    },
    commentPull: async (fullName, number) => `https://github.com/${fullName}/pull/${number}#issuecomment-${Date.now()}`,
    uploadEvidence: async (fullName, filePath) => `https://github.com/${fullName}/raw/swarm-qa-evidence/${filePath}`,
    ensureClone: async () => new Promise((r) => setTimeout(r, 400)),
    mainDir: (fullName) => `/demo/${fullName}/main`,
    deskDir: (fullName, slug) => `/demo/${fullName}/desks/${slug}`,
    prepareDesk: async (fullName, _base, slug) => {
      await new Promise((r) => setTimeout(r, 900));
      const dir = `/demo/${fullName}/desks/${slug}`;
      deskRepo.set(dir, fullName);
      return dir;
    },
    removeDesk: async () => undefined,
    startSession: (opts, cb) => fakeSession(opts, cb, deskRepo.get(opts.cwd) ?? [...repos.keys()][0]),
  };
}
