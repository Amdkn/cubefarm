import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import type { Request, Response } from 'express';
import type { IPty } from '@lydell/node-pty';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { HOME_DIR } from './config.ts';
import { cliLabel, commandFor, launchArgs, NOTIFY_SOURCE, OPENCODE_PLUGIN_SOURCE, STATUSLINE_SOURCE, trustKey } from './clis.ts';
import {
  clip,
  describeTool,
  newScreenshots,
  resultText,
  screenshotFile,
  summariseResult,
  tidyPaths,
  todoLines,
  type LogEntry,
  type SessionCallbacks,
  type SessionHandle,
  type SessionOptions,
  type SessionResult,
} from './agentRunner.ts';
import type { OfficeTools } from './ceo.ts';
import type { AgentTerminal } from './terminal.ts';
import type { AgentCli } from '../shared/types.ts';

// One agent session as the real CLI in a pseudo-terminal: the same contract as the Agent SDK runner (log lines, the
// current tool, the final text, finished), so the rest of the office doesn't care which runtime an agent uses.
//
// Claude Code reports through HTTP hooks passed with --settings: every tool call (PreToolUse also approves it, so the
// CLI never stops to ask), each finished turn (Stop, with the final text), failures (StopFailure) and, through its
// status line, cost and usage limits. Codex (notify) and OpenCode (a plugin) only say when a turn ends.

const pty = await import('@lydell/node-pty').catch((err: unknown) => {
  console.warn(`  terminals unavailable: ${(err as Error).message}`);
  return null;
});

/** The native terminal module loaded, so the terminal runtime can run. */
export const terminalsAvailable = pty !== null;

const SESSIONS_DIR = path.join(HOME_DIR, 'sessions');
const BIN_DIR = path.join(HOME_DIR, 'bin');
/** After a turn ends the CLI may still pick up a queued message: only an idle prompt this long means it's done. */
const FINISH_GRACE_MS = 3000;
/** Starting up: how long before the office says the CLI seems to be waiting on something. */
const BOOT_MS = 60_000;
/** Claude's usage warning, the way the SDK's allowed_warning is used: pace new work from here. */
const USAGE_WARN_PCT = 90;
/** Prompts longer than this go in a file: Windows caps a command line at 32K characters. */
const INLINE_PROMPT_MAX = 8000;

// ---------- routing the CLIs' calls back to their sessions ----------

let officeUrl = '';

/** The office's own address, for the hook and MCP endpoints the CLIs call back on. Set once the server listens. */
export function setOfficeUrl(url: string) {
  officeUrl = url;
}

interface Route {
  hook(body: Record<string, unknown>): Record<string, unknown>;
  office?: OfficeTools;
}
const routes = new Map<string, Route>();

/** A hook, status line or notify call from a CLI (POST /api/hooks/:token). The answer is the hook's output. */
export function handleHook(token: string, body: unknown): Record<string, unknown> {
  const route = routes.get(token);
  if (!route || !body || typeof body !== 'object' || Array.isArray(body)) return {};
  try {
    return route.hook(body as Record<string, unknown>);
  } catch (err) {
    console.warn('hook failed', err);
    return {};
  }
}

/** The CEO's office tools over MCP (Streamable HTTP, stateless: a fresh server per request). */
export async function handleMcp(token: string, req: Request, res: Response) {
  const office = routes.get(token)?.office;
  if (!office) {
    res.status(404).json({ jsonrpc: '2.0', error: { code: -32001, message: 'This session has ended.' }, id: null });
    return;
  }
  const server = office.serve();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

// ---------- helper scripts ----------

let helpersWritten = false;

/** The status line, notify and plugin scripts the CLIs run. Rewritten once per office start, so updates reach them. */
function writeHelpers() {
  if (helpersWritten) return;
  fs.mkdirSync(BIN_DIR, { recursive: true });
  fs.writeFileSync(path.join(BIN_DIR, 'statusline.cjs'), STATUSLINE_SOURCE);
  fs.writeFileSync(path.join(BIN_DIR, 'notify.cjs'), NOTIFY_SOURCE);
  fs.writeFileSync(path.join(BIN_DIR, 'opencode-plugin.mjs'), OPENCODE_PLUGIN_SOURCE);
  helpersWritten = true;
}

/** A command line for Claude Code's shell (Git Bash on Windows): forward slashes, quoted. */
const shellArg = (p: string) => `"${p.replaceAll('\\', '/')}"`;

// ---------- plumbing ----------

const HOOK_EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'StopFailure', 'Notification'];

/** The browser for a session. Its snapshots and unnamed screenshots go to the session's folder, not the worktree. */
function playwrightServer(outputDir: string) {
  const args = ['-y', '@playwright/mcp@latest', '--headless', '--isolated', '--output-dir', outputDir, '--init-script', path.join(import.meta.dirname, 'browser-init.js')];
  return process.platform === 'win32' ? { command: 'cmd', args: ['/c', 'npx', ...args] } : { command: 'npx', args };
}

/** What a tool call returned, as text, and any images in it (Playwright screenshots). */
function toolOutput(response: unknown): { text: string; images: { data: string; mime: string }[] } {
  const images: { data: string; mime: string }[] = [];
  const blocks = Array.isArray(response) ? response : Array.isArray((response as { content?: unknown })?.content) ? (response as { content: unknown[] }).content : null;
  if (blocks) {
    for (const b of blocks as Record<string, unknown>[]) {
      const source = b?.source as { type?: string; data?: string; media_type?: string } | undefined;
      if (b?.type === 'image' && source?.type === 'base64' && source.data) images.push({ data: source.data, mime: source.media_type ?? 'image/png' });
      else if (b?.type === 'image' && typeof b.data === 'string') images.push({ data: b.data, mime: String(b.mimeType ?? 'image/png') });
    }
    return { text: resultText(blocks), images };
  }
  if (typeof response === 'string') return { text: response, images };
  const r = response as { stdout?: unknown; stderr?: unknown; file?: { content?: unknown }; filenames?: unknown } | null;
  if (r && typeof r === 'object') {
    if (typeof r.stdout === 'string' || typeof r.stderr === 'string') return { text: [r.stdout, r.stderr].filter((s) => typeof s === 'string' && s).join('\n'), images };
    if (typeof r.file?.content === 'string') return { text: r.file.content, images };
    if (Array.isArray(r.filenames)) return { text: r.filenames.join('\n'), images };
  }
  return { text: '', images };
}

/** A pseudo-terminal whose CLI just died throws on writes and resizes before it reports the exit: ignore that. */
function quietly(fn: () => void) {
  try {
    fn();
  } catch {
    // the CLI is gone; its exit is on the way
  }
}

function killTree(proc: IPty) {
  if (process.platform === 'win32') {
    const tk = spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    tk.once('error', () => undefined);
    return;
  }
  try {
    process.kill(-proc.pid, 'SIGTERM'); // the CLI leads its own session: take its MCP servers and tools with it
  } catch {
    proc.kill();
  }
}

// ---------- CLIs that outlive their session ----------

/**
 * A CLI running in an agent's terminal. It can outlive the office session that started it: when a developer's task
 * is done their CLI waits at its prompt, so the manager can keep using it, and a follow-up picks it up again.
 */
interface LiveCli {
  cli: AgentCli;
  term: AgentTerminal;
  proc: IPty | null;
  token: string;
  dir: string;
  resumeId: string | null; // the session a follow-up resumes
  statusLine: string;
  /** Browser screenshots already passed on (Codex and OpenCode: collected from the browser's output folder). */
  shots: Set<string>;
  /** The office session driving it; null while it waits at its prompt. */
  session: { hook(b: Record<string, unknown>): Record<string, unknown>; exited(code: number): void } | null;
  idleTimer?: NodeJS.Timeout;
}
const lives = new Map<AgentTerminal, LiveCli>();
/** A CLI left at its prompt this long is closed; its session can still be resumed. */
const IDLE_MS = 30 * 60_000;

/** PreToolUse's answer: nobody may be watching to answer a permission question, so every tool call is approved. */
const ALLOW = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: 'Approved by cubefarm' } };

const toolInput = (b: Record<string, unknown>) => (b.tool_input && typeof b.tool_input === 'object' ? b.tool_input : {}) as Record<string, unknown>;

/** Close a CLI for good. */
function endLive(live: LiveCli) {
  if (lives.get(live.term) !== live) return;
  lives.delete(live.term);
  clearTimeout(live.idleTimer);
  routes.delete(live.token);
  live.term.releaseIdle = null;
  live.term.bind(null);
  if (live.proc) killTree(live.proc);
  live.proc = null;
  live.term.note(`── ${cliLabel(live.cli)} session ended ──`);
  fs.rm(live.dir, { recursive: true, force: true, maxRetries: 5 }, () => undefined);
}

/** A CLI waiting at its prompt: what the manager types there becomes a follow-up. */
function idleHook(live: LiveCli, b: Record<string, unknown>): Record<string, unknown> {
  switch (String(b.hook_event_name ?? '')) {
    case 'PreToolUse':
      return ALLOW;
    case 'UserPromptSubmit': {
      const text = String(b.prompt ?? '').trim();
      if (!text || live.term.onIdlePrompt?.(text)) return {};
      return { decision: 'block', reason: "The office couldn't take that on as a follow-up right now (see the agent's panel). Nothing was sent." };
    }
    case 'StatusLine':
      return { statusLine: live.statusLine };
  }
  return {};
}

// ---------- the session ----------

export function startCliSession(opts: SessionOptions, callbacks: SessionCallbacks): SessionHandle {
  const term = opts.terminal!;
  const cli = opts.cli ?? 'claude';
  const label = cliLabel(cli);
  // A follow-up to the session a CLI is still waiting in picks that CLI up again; anything else replaces it.
  const prev = lives.get(term);
  const adopt = !!prev?.proc && !prev.session && prev.cli === cli && !!opts.resumeSessionId && prev.resumeId === opts.resumeSessionId;
  if (prev && !adopt) endLive(prev);
  let live: LiveCli | null = adopt ? prev! : null;

  const token = crypto.randomUUID();
  const sessionId = opts.resumeSessionId ?? crypto.randomUUID();
  const dir = path.join(SESSIONS_DIR, token);
  const started = Date.now();
  const statusLine = `🏢 cubefarm${opts.label ? ` · ${opts.label}` : ''}`;
  const toolNames = new Map<string, string>();
  const officePrompts: string[] = []; // prompts the office typed, so the ones the manager typed are told apart
  const launched: string[] = []; // every prompt the CLI was given, as given (Codex: finds its main thread)
  let mainThread: string | null = opts.resumeSessionId ?? null;
  const usageResets = new Map<string, number | null>();
  const warned = new Set<string>();
  let done = false;
  let costUsd = 0;
  let turns = 0;
  let lastText = '';
  let turnError: string | null = null; // the turn failed (OpenCode reports errors separately from going idle)
  let begun = false; // the CLI took its first prompt
  let finishTimer: NodeJS.Timeout | undefined;
  let bootTimer: NodeJS.Timeout | undefined;
  let screenTimer: NodeJS.Timeout | undefined;
  let shotTimer: NodeJS.Timeout | undefined;
  const nudged = new Set<string>();
  let trustKeys = 0; // keys pressed on a folder-trust question (a few at most)
  let trustedAt = 0;

  const cb: SessionCallbacks = { ...callbacks };
  const log = (entries: LogEntry[]) => entries.length && cb.log(entries);

  /** Codex and OpenCode don't report tool results: pass on the screenshots their browser saved instead. all: the last look. */
  const collectShots = (all = false) => {
    const l = live;
    if (!l || cli === 'claude' || !opts.browserTesting) return;
    for (const shot of newScreenshots(path.join(l.dir, 'browser'), l.shots, all ? Infinity : Date.now())) {
      l.shots.add(shot.name);
      try {
        cb.screenshot(fs.readFileSync(shot.file), shot.mime);
      } catch {
        // removed before we got to it
      }
    }
  };

  /** The session is over. A developer's CLI that ended its turn normally stays at its prompt (keep); others close. */
  const finish = (r: Omit<SessionResult, 'costUsd' | 'turns'>, keep = false) => {
    if (done) return;
    done = true;
    for (const t of [finishTimer, bootTimer]) clearTimeout(t);
    clearInterval(screenTimer);
    clearInterval(shotTimer);
    collectShots(true);
    const l = live;
    if (l && lives.get(term) === l) {
      l.session = null;
      if (keep && opts.keepAlive && l.proc) {
        l.idleTimer = setTimeout(() => endLive(l), IDLE_MS);
        term.releaseIdle = () => endLive(l);
      } else endLive(l);
    }
    cb.tool(null);
    cb.finished({ ...r, costUsd, turns });
  };

  /** A turn ended: finished, unless the CLI picks up another prompt within the grace period. */
  const turnEnded = (text: string) => {
    lastText = text;
    cb.tool(null);
    clearTimeout(finishTimer);
    finishTimer = setTimeout(() => finish({ ok: !turnError, text: lastText, errors: turnError ? [turnError] : [] }, true), FINISH_GRACE_MS);
  };
  const busy = () => {
    begun = true;
    clearTimeout(finishTimer);
  };

  const assistantLines = (text: string): LogEntry[] => {
    const lines = text.split('\n');
    const out: LogEntry[] = lines.slice(0, 30).map((l, i) => ({ kind: 'text', text: `${i === 0 ? '● ' : '  '}${l}` }));
    if (lines.length > 30) out.push({ kind: 'text', text: `  … (${lines.length - 30} more lines)` });
    return out;
  };

  const onStatus = (b: Record<string, unknown>) => {
    const cost = Number((b.cost as { total_cost_usd?: unknown } | undefined)?.total_cost_usd);
    if (Number.isFinite(cost)) costUsd = cost;
    const limits = (b.rate_limits ?? {}) as Record<string, { used_percentage?: unknown; resets_at?: unknown } | null>;
    for (const [type, l] of Object.entries(limits)) {
      const used = Number(l?.used_percentage);
      if (!Number.isFinite(used)) continue;
      const resetsAt = Number(l?.resets_at) > 0 ? Number(l?.resets_at) * 1000 : null;
      usageResets.set(type, used >= 100 ? resetsAt : null);
      if (used >= USAGE_WARN_PCT && used < 100 && !warned.has(type)) {
        warned.add(type);
        cb.usageWarning?.({ resetsAt, rateLimitType: type, utilization: used / 100 });
      }
    }
    return { statusLine };
  };

  const hook = (b: Record<string, unknown>): Record<string, unknown> => {
    const event = String(b.hook_event_name ?? '');
    const sub = typeof b.agent_id === 'string' && b.agent_id !== ''; // a subagent's call: kept off the log
    switch (event) {
      case 'PreToolUse': {
        const name = String(b.tool_name ?? '');
        const input = toolInput(b);
        if (!sub) {
          busy();
          turns += 1;
          toolNames.set(String(b.tool_use_id ?? ''), name);
          log([{ kind: 'tool', tool: name, text: `⏺ ${describeTool(opts.cwd, name, input)}` }, ...(name === 'TodoWrite' ? todoLines(input) : [])]);
          cb.tool(name);
          if (name === 'mcp__playwright__browser_navigate' && typeof input.url === 'string') cb.browserUrl(input.url);
        }
        return ALLOW;
      }
      case 'PostToolUse':
      case 'PostToolUseFailure': {
        if (sub) return {};
        const name = toolNames.get(String(b.tool_use_id ?? '')) ?? String(b.tool_name ?? '');
        const out = toolOutput(b.tool_response);
        for (const img of out.images) cb.screenshot(Buffer.from(img.data, 'base64'), img.mime);
        const saved = name === 'mcp__playwright__browser_take_screenshot' && !out.images.length ? screenshotFile(opts.cwd, out.text) : null;
        if (saved) cb.screenshot(saved.data, saved.mime);
        if (name.startsWith('mcp__playwright__')) {
          const url = out.text.match(/Page URL:\s*(\S+)/);
          if (url) cb.browserUrl(url[1]);
        }
        if (event === 'PostToolUseFailure') log([{ kind: 'error', text: `  ⎿ ${clip(tidyPaths(opts.cwd, String(b.error ?? out.text ?? 'Error')).split('\n')[0] || 'Error', 200)}` }]);
        else if (name !== 'TodoWrite') log(summariseResult(opts.cwd, name, out.text));
        cb.tool(null);
        return {};
      }
      case 'UserPromptSubmit': {
        busy();
        const prompt = String(b.prompt ?? '').trim();
        const i = officePrompts.findIndex((p) => p.slice(0, 60) === prompt.slice(0, 60));
        if (i >= 0) officePrompts.splice(i, 1);
        else if (prompt) log([{ kind: 'manager', text: `▶ Typed in the terminal: ${clip(prompt.split('\n')[0], 200)}` }]);
        return {};
      }
      case 'Stop': {
        const text = String(b.last_assistant_message ?? '').trim();
        turns += 1;
        if (text) {
          log(assistantLines(text));
          cb.turn?.(text);
        }
        turnEnded(text);
        return {};
      }
      case 'StopFailure': {
        const error = String(b.error ?? 'unknown');
        const details = String(b.error_details ?? '').trim();
        if (error === 'rate_limit') cb.limited?.([...usageResets.values()].find((t) => t !== null) ?? null);
        finish({ ok: false, text: lastText, errors: [`${label} stopped: ${error.replace(/_/g, ' ')}${details ? ` (${clip(details, 160)})` : ''}`] }, true);
        return {};
      }
      case 'Notification': {
        if (b.notification_type === 'permission_prompt') log([{ kind: 'error', text: `⚠ ${label} is waiting for a permission answer: open the terminal to answer it.` }]);
        return {};
      }
      case 'StatusLine':
        return onStatus(b);
      // Codex's notify program and the OpenCode plugin
      case 'TurnComplete': {
        const thread = typeof b.session_id === 'string' ? b.session_id : '';
        if (cli === 'codex' && thread !== mainThread) {
          // Codex also runs side threads (it titles each task in one): the main thread is the one given our prompt.
          const input = String(b.input ?? '').trim();
          if (mainThread || !launched.some((p) => input.startsWith(p.slice(0, 40)))) return {};
          mainThread = thread;
        }
        if (thread) {
          cb.sessionId(thread);
          if (live) live.resumeId = thread;
        }
        const text = String(b.last_assistant_message ?? '').trim();
        turns += 1;
        if (text) {
          log(assistantLines(text));
          cb.turn?.(text);
        }
        turnEnded(text);
        return {};
      }
      case 'TurnError':
        turnError = `${label}: ${clip(String(b.error ?? 'error'), 200)}`;
        log([{ kind: 'error', text: `✗ ${turnError}` }]);
        return {};
    }
    return {};
  };

  /** The CLI quit on its own: /exit typed in the terminal, a crash, or it couldn't start (not signed in, bad flag…). */
  const exited = (exitCode: number) => {
    const ok = exitCode === 0 && (lastText !== '' || (cli !== 'claude' && Date.now() - started > 20_000));
    finish({ ok, text: lastText, errors: ok ? [] : [`${label} exited${exitCode ? ` with code ${exitCode}` : ''} before finishing.`] });
  };

  const handle: SessionHandle = {
    send(text) {
      const proc = live?.proc;
      if (done || !proc) return;
      busy();
      turnError = null;
      officePrompts.push(text.trim());
      // Pasted, so newlines stay in the message instead of sending it early; then Enter.
      const clean = text.replace(/\x1b\[20[01]~/g, '').replace(/\r\n?/g, '\n');
      launched.push(clean.trim());
      quietly(() => proc.write(`\x1b[200~${clean}\x1b[201~`));
      setTimeout(() => quietly(() => live?.proc?.write('\r')), 150);
    },
    stop() {
      finish({ ok: false, text: '', errors: ['Stopped by manager'] });
    },
  };

  if (adopt && live) {
    // Back in the CLI that was waiting at its prompt: same conversation, same terminal.
    clearTimeout(live.idleTimer);
    term.releaseIdle = null;
    live.session = { hook, exited };
    Object.assign(live, { statusLine });
    if (live.resumeId) cb.sessionId(live.resumeId);
    if (opts.typed) busy(); // the manager typed it at the prompt: it's already running
    else handle.send(opts.prompt);
    shotTimer = setInterval(collectShots, 2000);
    return handle;
  }

  // ---------- a new CLI: files for this session, and the command line ----------

  const cmd = commandFor(cli);
  if (!pty || !cmd) {
    const why = !pty ? 'the terminal module could not be loaded on this machine' : `${label} isn't installed (no "${cli}" on PATH)`;
    setTimeout(() => finish({ ok: false, text: '', errors: [`Could not start ${label}: ${why}.`] }), 0);
    return handle;
  }

  const hookUrl = `${officeUrl}/api/hooks/${token}`;
  const browser = opts.browserTesting ? playwrightServer(path.join(dir, 'browser')) : null;
  let prompt = opts.prompt;
  if (opts.outputSchema) {
    prompt += `\n\nWhen you are done, end your final message with your report as one JSON object in a \`\`\`json block, matching this JSON schema:\n${JSON.stringify(opts.outputSchema)}`;
  }
  let files: { settings: string; mcp: string | null; system: string };
  try {
    writeHelpers();
    fs.mkdirSync(dir, { recursive: true });
    const settings = {
      hooks: Object.fromEntries(HOOK_EVENTS.map((e) => [e, [{ hooks: [{ type: 'http', url: hookUrl, timeout: 30 }] }]])),
      statusLine: { type: 'command', command: `${shellArg(process.execPath)} ${shellArg(path.join(BIN_DIR, 'statusline.cjs'))} ${shellArg(hookUrl)}`, padding: 0 },
    };
    const servers: Record<string, unknown> = {};
    if (browser) servers.playwright = browser;
    if (opts.office) servers.office = { type: 'http', url: `${officeUrl}/api/mcp/${token}` };
    files = { settings: path.join(dir, 'settings.json'), mcp: Object.keys(servers).length ? path.join(dir, 'mcp.json') : null, system: path.join(dir, 'instructions.md') };
    fs.writeFileSync(files.settings, JSON.stringify(settings, null, 2));
    if (files.mcp) fs.writeFileSync(files.mcp, JSON.stringify({ mcpServers: servers }, null, 2));
    fs.writeFileSync(files.system, opts.systemAppend);
    if (prompt.length > INLINE_PROMPT_MAX) {
      const file = path.join(dir, 'task.md');
      fs.writeFileSync(file, prompt);
      prompt = `Your task is in ${file}. Read all of it first, then do what it says.`;
    }
  } catch (err) {
    setTimeout(() => finish({ ok: false, text: '', errors: [`Could not prepare ${label}: ${(err as Error).message}`] }), 0);
    return handle;
  }
  officePrompts.push(opts.prompt.trim());
  launched.push(prompt.trim());

  const launch = launchArgs(cli, {
    cwd: opts.cwd,
    prompt,
    systemAppend: opts.systemAppend,
    model: opts.model,
    effort: opts.effort,
    resumeId: opts.resumeSessionId,
    sessionId,
    name: opts.label ?? 'cubefarm',
    role: opts.role,
    additionalDirectories: opts.additionalDirectories,
    files,
    notify: { script: path.join(BIN_DIR, 'notify.cjs'), url: hookUrl },
    plugin: pathToFileURL(path.join(BIN_DIR, 'opencode-plugin.mjs')).href,
    browser,
  });

  // Each agent must be a clean instance on the account its CLI is logged into: no API keys (they would switch Claude
  // Code's billing to the API) and nothing inherited from a Claude Code session the office itself was started from.
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (/^(ANTHROPIC_|CLAUDE)/i.test(k) && k !== 'CLAUDE_CONFIG_DIR') continue;
    if (/^(NO_COLOR|FORCE_COLOR|TERM_PROGRAM|TERM_PROGRAM_VERSION|CODEX_THREAD_ID|OPENCODE_CONFIG_CONTENT)$/i.test(k)) continue;
    env[k] = v;
  }
  Object.assign(env, { TERM: 'xterm-256color', COLORTERM: 'truecolor' }, launch.env);

  if (cli === 'claude') cb.sessionId(sessionId);
  term.note(`── ${label}${opts.label ? ` · ${opts.label}` : ''} ──`);
  let p: IPty;
  try {
    p = pty.spawn(cmd.file, [...cmd.args, ...launch.args], { name: 'xterm-256color', cols: term.cols, rows: term.rows, cwd: opts.cwd, env });
  } catch (err) {
    setTimeout(() => finish({ ok: false, text: '', errors: [`Could not start ${label}: ${(err as Error).message}`] }), 0);
    return handle;
  }
  const l: LiveCli = { cli, term, proc: p, token, dir, resumeId: cli === 'claude' ? sessionId : (opts.resumeSessionId ?? null), statusLine, shots: new Set(), session: { hook, exited } };
  live = l;
  lives.set(term, l);
  shotTimer = setInterval(collectShots, 2000);
  routes.set(token, { hook: (b) => (l.session ? l.session.hook(b) : idleHook(l, b)), office: opts.office });
  term.bind({ write: (d) => quietly(() => p.write(d)), resize: (c, r) => quietly(() => p.resize(c, r)) });

  p.onData((data) => {
    if (lives.get(term) === l) term.write(data);
  });
  p.onExit(({ exitCode }) => {
    l.proc = null;
    if (lives.get(term) !== l) return; // already replaced or closed
    if (l.session) l.session.exited(exitCode);
    else endLive(l); // quit while waiting at its prompt
  });

  // Starting up: answer the folder-trust question for the office's own worktrees (the answer that trusts it), and
  // say so when a CLI is waiting on something only the manager can do (signing in).
  screenTimer = setInterval(() => {
    if (done || Date.now() - started > BOOT_MS * 2) return clearInterval(screenTimer);
    const screen = term.screen();
    const key = trustKeys < 8 && Date.now() - trustedAt > 3000 ? trustKey(screen) : null;
    if (key === 'down') {
      trustKeys += 1;
      quietly(() => p.write(term.appCursor ? '\x1bOB' : '\x1b[B'));
    } else if (key === 'enter') {
      trustKeys += 1;
      trustedAt = Date.now(); // the question takes a moment to go: don't answer it twice
      log([{ kind: 'system', text: `✓ Trusted the worktree for ${label}.` }]);
      quietly(() => p.write('\r'));
    }
    if (!nudged.has('login') && /Not logged in|run \/login|Select login method|Sign in with ChatGPT|Please login|Invalid API key/i.test(screen)) {
      nudged.add('login');
      log([{ kind: 'error', text: `⚠ ${label} needs you to sign in: open the terminal and sign in there, or run "${cli}" in a terminal of your own.` }]);
    } else if (!nudged.has('setup') && !trustKey(screen) && Date.now() - trustedAt > 5000 && /Choose the text style|Press Enter to continue|Bypass Permissions mode|Settings Error/i.test(screen)) {
      // First-run screens only the manager should answer: the CLI waits for them in the terminal.
      nudged.add('setup');
      log([{ kind: 'error', text: `⚠ ${label} is waiting on a setup screen: open the terminal to answer it.` }]);
    }
  }, 1000);
  bootTimer = setTimeout(() => {
    if (!done && !begun && cli === 'claude') log([{ kind: 'error', text: `⚠ ${label} hasn't started on the task yet. Open the terminal to see what it's waiting for.` }]);
  }, BOOT_MS);

  return handle;
}
