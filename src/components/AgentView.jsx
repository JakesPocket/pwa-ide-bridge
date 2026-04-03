import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import copilotIcon from '../assets/icons/providers/copilot.svg';
import codexIcon from '../assets/icons/providers/codex.svg';
import localIcon from '../assets/icons/providers/local.svg';
import { apiUrl } from '../config/server';
import { readJson, writeJson, readText, writeText } from '../utils/persist';
import { preventScrollOnFocus } from '../utils/preventScrollOnFocus';

const REQUEST_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const CHAT_AUTO_CLOUD_AFTER_MS = 105 * 1000; // Promote long live streams to Cloud after 105s (1m 45s).

const CHAT_MESSAGES_KEY = 'pocketcode.agent.messages.v1';
const CHAT_INPUT_KEY = 'pocketcode.agent.input.v1';
const CHAT_PENDING_REVIEW_KEY = 'pocketcode.agent.pendingReviewPaths.v1';
const CHAT_UI_AGENT_KEY = 'pocketcode.agent.ai.mode.v1';
const CHAT_UI_PROVIDER_KEY = 'pocketcode.agent.ai.provider.v1';
const CHAT_UI_EXEC_MODE_KEY = 'pocketcode.agent.ai.execution.v1';
const CHAT_TURN_AI_MODES_KEY = 'pocketcode.agent.turnAiMode.v1';
const CHAT_TURN_PROVIDERS_KEY = 'pocketcode.agent.turnProvider.v1';
const CHAT_CLOUD_JOBS_KEY = 'pocketcode.agent.cloudJobs.v1';
const CHAT_VIEW_TAB_KEY = 'pocketcode.agent.activeSubTab.v1';

function normalizeMode(value) {
  const mode = String(value || '').toLowerCase().trim();
  return ['agent', 'ask', 'plan', 'cloud'].includes(mode) ? mode : null;
}

function normalizeTab(value) {
  const tab = String(value || '').toLowerCase().trim();
  return tab === 'tasks' || tab === 'cloud' ? 'cloud' : 'chat';
}

function normalizeExecutionMode(value) {
  const mode = String(value || '').toLowerCase().trim();
  return mode === 'cloud' ? 'cloud' : 'chat';
}

function normalizeProvider(value) {
  const provider = String(value || '').toLowerCase().trim();
  if (provider === 'codex' || provider === 'local') return provider;
  return 'copilot';
}

function resolveAutoCloudPromotionMs() {
  const raw = readText('pocketcode.agent.chatAutoCloudMs.v1', '');
  const parsed = Number.parseInt(String(raw || ''), 10);
  if (Number.isFinite(parsed) && parsed >= 10_000 && parsed <= 240_000) return parsed;
  return CHAT_AUTO_CLOUD_AFTER_MS;
}

function providerDisplayName(value) {
  const provider = normalizeProvider(value);
  if (provider === 'codex') return 'Codex';
  if (provider === 'local') return 'Local';
  return 'Copilot';
}

function isLikelyClientDisconnectError(err) {
  const message = String(err?.message || '').toLowerCase();
  return /load failed|failed to fetch|networkerror|network error|network connection was lost|fetch failed|the internet connection appears to be offline|signal is aborted without reason/i.test(message);
}

function ProviderIcon({ provider = 'copilot', className = 'w-4 h-4' }) {
  const normalizedProvider = normalizeProvider(provider);
  const iconSrc = normalizedProvider === 'codex'
    ? codexIcon
    : normalizedProvider === 'local'
      ? localIcon
      : copilotIcon;

  const title = normalizedProvider === 'codex'
    ? 'OpenAI Codex'
    : normalizedProvider === 'local'
      ? 'Local Provider'
      : 'GitHub Copilot';

  return (
    <img
      src={iconSrc}
      alt={title}
      className={`${className} object-contain`}
      title={title}
    />
  );
}

function createMessageId() {
  if (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

const TEXT_EXTENSIONS = new Set([
  '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.h', '.cs',
  '.go', '.rb', '.php', '.swift', '.kt', '.rs', '.json', '.yaml', '.yml',
  '.toml', '.xml', '.md', '.txt', '.sh', '.env', '.css', '.html', '.vue',
  '.svelte', '.graphql', '.gql', '.sql', '.ini', '.cfg', '.conf',
]);

function isTextFile(file) {
  if (file.type.startsWith('text/')) return true;
  const lower = file.name.toLowerCase();
  return Array.from(TEXT_EXTENSIONS).some((ext) => lower.endsWith(ext));
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function readFileAs(file, method) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    if (method === 'text') reader.readAsText(file);
    else reader.readAsDataURL(file);
  });
}

async function readAttachmentFile(file) {
  const MAX_SIZE = 10 * 1024 * 1024;
  const isImage = file.type.startsWith('image/');
  const isText = isTextFile(file);
  let data = '';
  let preview = null;
  if (file.size > MAX_SIZE) {
    data = `[File too large to attach: ${formatFileSize(file.size)}]`;
  } else if (isImage) {
    data = await readFileAs(file, 'dataurl');
    preview = data;
  } else if (isText) {
    data = await readFileAs(file, 'text');
  } else {
    data = await readFileAs(file, 'dataurl');
  }
  return {
    id: createMessageId(),
    name: file.name,
    type: file.type,
    size: file.size,
    data,
    preview,
    isImage,
    isText,
  };
}

function normalizeStoredMessage(msg) {
  if (!msg || typeof msg !== 'object') return null;

  if (msg.role === 'tool') {
    return {
      id: typeof msg.id === 'string' && msg.id ? msg.id : createMessageId(),
      turnId: typeof msg.turnId === 'string' ? msg.turnId : null,
      role: 'tool',
      tool: typeof msg.tool === 'string' ? msg.tool : 'unknown',
      done: Boolean(msg.done),
      input: msg.input ?? null,
      output: msg.output ?? null,
    };
  }

  if (['user', 'agent', 'reasoning', 'error', 'handoff'].includes(msg.role)) {
    const base = {
      id: typeof msg.id === 'string' && msg.id ? msg.id : createMessageId(),
      turnId: typeof msg.turnId === 'string' ? msg.turnId : null,
      role: msg.role,
      text: typeof msg.text === 'string' ? msg.text : '',
      provider: normalizeProvider(msg.provider),
      aiMode: normalizeMode(msg.aiMode),
      options: Array.isArray(msg.options) ? msg.options : null,
      selectedMode: normalizeMode(msg.selectedMode),
      streaming: Boolean(msg.streaming),
      isTimeout: Boolean(msg.isTimeout),
      isLoop: Boolean(msg.isLoop),
    };
    if (msg.role === 'user' && Array.isArray(msg.attachments) && msg.attachments.length > 0) {
      base.attachments = msg.attachments
        .filter((a) => a && typeof a === 'object' && typeof a.name === 'string')
        .map(({ id, name, type, size, isImage, isText }) => ({
          id: typeof id === 'string' ? id : createMessageId(),
          name,
          type: typeof type === 'string' ? type : '',
          size: typeof size === 'number' ? size : 0,
          isImage: Boolean(isImage),
          isText: Boolean(isText),
          data: '',
          preview: null,
        }));
    }
    return base;
  }

  return null;
}

function readInitialPendingReviewPaths() {
  const stored = readJson(CHAT_PENDING_REVIEW_KEY, []);
  if (!Array.isArray(stored)) return [];
  return stored.filter((value) => typeof value === 'string' && value.trim());
}

function readInitialMessages() {
  const fallback = [
    { id: createMessageId(), turnId: null, role: 'agent', text: 'Hello! I am your autonomous coding agent. How can I help?' },
  ];
  const stored = readJson(CHAT_MESSAGES_KEY, null);
  if (!Array.isArray(stored) || stored.length === 0) return fallback;

  const next = stored
    .map(normalizeStoredMessage)
    .filter(Boolean);

  return next.length > 0 ? next : fallback;
}

function readInitialTurnAiModes() {
  const rawMap = readJson(CHAT_TURN_AI_MODES_KEY, {});
  const persisted = {};

  if (rawMap && typeof rawMap === 'object') {
    for (const [turnId, mode] of Object.entries(rawMap)) {
      const normalized = normalizeMode(mode);
      if (normalized && turnId) persisted[turnId] = normalized;
    }
  }

  const storedMessages = readJson(CHAT_MESSAGES_KEY, []);
  if (Array.isArray(storedMessages)) {
    for (const msg of storedMessages) {
      if (!msg || typeof msg !== 'object') continue;
      const turnId = typeof msg.turnId === 'string' ? msg.turnId : null;
      const mode = normalizeMode(msg.aiMode);
      if (turnId && mode && !persisted[turnId]) {
        persisted[turnId] = mode;
      }
    }
  }

  return persisted;
}

function readInitialTurnProviders() {
  const rawMap = readJson(CHAT_TURN_PROVIDERS_KEY, {});
  const persisted = {};

  if (rawMap && typeof rawMap === 'object') {
    for (const [turnId, provider] of Object.entries(rawMap)) {
      const normalized = normalizeProvider(provider);
      if (turnId) persisted[turnId] = normalized;
    }
  }

  const storedMessages = readJson(CHAT_MESSAGES_KEY, []);
  if (Array.isArray(storedMessages)) {
    for (const msg of storedMessages) {
      if (!msg || typeof msg !== 'object') continue;
      const turnId = typeof msg.turnId === 'string' ? msg.turnId : null;
      const provider = normalizeProvider(msg.provider);
      if (turnId && provider && !persisted[turnId]) {
        persisted[turnId] = provider;
      }
    }
  }

  return persisted;
}

function normalizeCloudJob(job) {
  if (!job || typeof job !== 'object') return null;
  const jobId = typeof job.jobId === 'string' && job.jobId ? job.jobId : null;
  if (!jobId) return null;

  return {
    jobId,
    provider: normalizeProvider(job.provider || 'copilot'),
    status: typeof job.status === 'string' ? job.status : 'queued',
    aiMode: normalizeMode(job.aiMode) || 'cloud',
    message: typeof job.message === 'string' ? job.message : '',
    turnId: typeof job.turnId === 'string' ? job.turnId : null,
    resultText: typeof job.resultText === 'string' ? job.resultText : '',
    error: job.error && typeof job.error === 'object'
      ? {
          message: typeof job.error.message === 'string' ? job.error.message : '',
          isTimeout: Boolean(job.error.isTimeout),
          isLoop: Boolean(job.error.isLoop),
        }
      : null,
    createdAt: typeof job.createdAt === 'string' ? job.createdAt : null,
    updatedAt: typeof job.updatedAt === 'string' ? job.updatedAt : null,
    startedAt: typeof job.startedAt === 'string' ? job.startedAt : null,
    finishedAt: typeof job.finishedAt === 'string' ? job.finishedAt : null,
    cancelRequested: Boolean(job.cancelRequested),
  };
}

function readInitialCloudJobs() {
  const stored = readJson(CHAT_CLOUD_JOBS_KEY, []);
  if (!Array.isArray(stored)) return [];
  return stored.map(normalizeCloudJob).filter(Boolean);
}

function getLatestPlanResponseText(messages, turnAiModes) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || msg.role !== 'agent') continue;
    const mode = (msg.turnId ? turnAiModes[msg.turnId] : null) || normalizeMode(msg.aiMode);
    if (mode !== 'plan') continue;
    if (typeof msg.text !== 'string' || !msg.text.trim()) continue;
    if (/recommended plan|possible next steps/i.test(msg.text)) {
      return msg.text.trim();
    }
  }
  return null;
}

function resolvePlanContinuationChoice(prompt) {
  const normalized = String(prompt || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return null;

  if (['1', 'start', 'start now', 'go', 'go ahead', 'do it', 'implement'].includes(normalized)) {
    return 'start';
  }
  if (['2', 'explore', 'explore first', 'inspect first', 'locate first'].includes(normalized)) {
    return 'explore';
  }
  if (['3', 'cancel', 'stop', 'never mind', 'nevermind'].includes(normalized)) {
    return 'cancel';
  }

  return null;
}

function buildModeSwitchContinuationPrompt(userPrompt, mode, planText, choice) {
  if (!planText || !choice || mode === 'plan') return userPrompt;

  const choiceText = choice === 'start'
    ? 'Start implementation now'
    : choice === 'explore'
      ? 'Explore first before touching files'
      : 'Cancel and do nothing';

  const compactPlan = planText.length > 1800 ? `${planText.slice(0, 1800)}\n...` : planText;
  return [
    `User switched to ${mode.toUpperCase()} mode and is continuing a previous PLAN response.`,
    `Interpret the user's message as selecting: ${choiceText}.`,
    `Original user message: "${userPrompt}"`,
    '',
    'Previous PLAN response context:',
    compactPlan,
  ].join('\n');
}

// ── Message types ──────────────────────────────────────────────────────────
// { role: 'user',   text: string }
// { role: 'agent',  text: string, streaming?: bool }
// { role: 'tool',   tool: string, done?: bool, input?: unknown, output?: unknown }
// { role: 'handoff', text: string, options?: Array<{ mode: string, label: string }>, selectedMode?: string }
// { role: 'error',  text: string }

function summarizeTool(tool, input) {
  const labelMap = {
    report_intent: 'Shared current intent',
    bash: 'Ran command in terminal',
    read_bash: 'Read terminal output',
    apply_patch: 'Edited workspace files',
    create_file: 'Created file',
    read_file: 'Read file',
    grep_search: 'Searched workspace text',
    file_search: 'Searched workspace files',
    semantic_search: 'Searched code semantically',
  };

  const base = labelMap[tool] || `Ran ${tool}`;
  if (typeof input === 'string' && input.trim()) {
    const compact = input.trim().replace(/\s+/g, ' ');
    return compact.length > 70 ? `${base}: ${compact.slice(0, 67)}...` : `${base}: ${compact}`;
  }
  if (input && typeof input === 'object') {
    if (typeof input.explanation === 'string' && input.explanation.trim()) {
      return input.explanation.trim();
    }
    if (typeof input.command === 'string' && input.command.trim()) {
      const compact = input.command.trim().replace(/\s+/g, ' ');
      return compact.length > 70 ? `${base}: ${compact.slice(0, 67)}...` : `${base}: ${compact}`;
    }
  }
  return base;
}

function formatToolPayload(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value.trim() || null;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

const MODE_BUBBLE_COLORS = {
  agent: { bg: 'rgba(100,200,100,0.34)', border: 'rgba(100,200,100,0.72)' },
  ask:   { bg: 'rgba(255,165,0,0.34)',   border: 'rgba(255,165,0,0.72)'   },
  plan:  { bg: 'rgba(100,150,255,0.34)', border: 'rgba(100,150,255,0.72)' },
  cloud: { bg: 'rgba(0,200,255,0.28)',   border: 'rgba(0,200,255,0.68)'   },
};

function UserBubble({ text, mode, longPressHandlers, attachments }) {
  const colors = MODE_BUBBLE_COLORS[mode];
  const accent = colors?.border || 'var(--color-vscode-accent)';
  return (
    <div className="flex justify-end" {...(longPressHandlers || {})}>
      <div
        className="max-w-[88%] px-3 py-2 rounded-lg text-sm text-vscode-text break-words leading-relaxed"
        style={{
          backgroundColor: 'rgba(255,255,255,0.03)',
          border: '1px solid var(--color-vscode-border)',
          borderRight: `2px solid ${accent}`,
        }}
      >
        {attachments && attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {attachments.map((att) =>
              att.isImage && att.preview ? (
                <img
                  key={att.id}
                  src={att.preview}
                  alt={att.name}
                  title={att.name}
                  className="max-h-32 max-w-[160px] rounded-lg object-cover border border-black/20"
                />
              ) : (
                <div
                  key={att.id}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] border border-black/20 bg-black/15 max-w-[160px]"
                  title={att.name}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3 shrink-0" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <span className="truncate">{att.name}</span>
                  <span className="shrink-0 opacity-60">{formatFileSize(att.size)}</span>
                </div>
              )
            )}
          </div>
        )}
        <div className="whitespace-pre-wrap">{text}</div>
      </div>
    </div>
  );
}

function splitCodeBlocks(text) {
  const chunks = [];
  const re = /```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g;
  let last = 0;
  let m;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      chunks.push({ type: 'text', value: text.slice(last, m.index) });
    }
    chunks.push({ type: 'code', lang: m[1] || '', value: (m[2] || '').replace(/\n$/, '') });
    last = re.lastIndex;
  }

  if (last < text.length) {
    chunks.push({ type: 'text', value: text.slice(last) });
  }

  return chunks;
}

function InlineText({ line }) {
  const parts = line.split(/(`[^`]+`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={idx} className="px-1 py-0.5 rounded bg-vscode-sidebar border border-vscode-border font-mono text-[12px] text-vscode-text">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={idx}>{part}</span>;
  });
}

function TextBlock({ text }) {
  const lines = text.split('\n');
  return (
    <div className="text-[13px] text-vscode-text leading-6 whitespace-pre-wrap break-words">
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={idx} className="h-2" />;

        const isBullet = /^[-*]\s+/.test(trimmed);
        const isNumbered = /^\d+\.\s+/.test(trimmed);

        if (isBullet || isNumbered) {
          return (
            <div key={idx} className="flex items-start gap-2">
              <span className="text-vscode-text-muted">{isNumbered ? trimmed.match(/^\d+\./)?.[0] : '•'}</span>
              <span><InlineText line={trimmed.replace(/^([-*]|\d+\.)\s+/, '')} /></span>
            </div>
          );
        }

        if (/^#{1,3}\s+/.test(trimmed)) {
          return (
            <div key={idx} className="text-vscode-text font-semibold mt-1">
              <InlineText line={trimmed.replace(/^#{1,3}\s+/, '')} />
            </div>
          );
        }

        return (
          <div key={idx}>
            <InlineText line={line} />
          </div>
        );
      })}
    </div>
  );
}

function CodeBlock({ code, lang }) {
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="rounded-xl border border-vscode-border bg-vscode-sidebar overflow-hidden my-2">
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-vscode-text-muted border-b border-vscode-border flex items-center justify-between">
        <span>{lang || 'code'}</span>
        <button
          type="button"
          onClick={copyCode}
          className="text-vscode-text-muted hover:text-vscode-text"
          style={{ background: 'none', border: 'none', outline: 'none' }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="p-3 text-[12px] leading-relaxed text-vscode-text overflow-x-auto font-mono">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function AgentBubble({ text, streaming }) {
  const chunks = splitCodeBlocks(text || '');

  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] min-w-0">
        <div className="pl-2 border-l border-vscode-border/60">
          {chunks.length === 0 ? <TextBlock text="" /> : chunks.map((chunk, idx) => (
            chunk.type === 'code'
              ? <CodeBlock key={idx} code={chunk.value} lang={chunk.lang} />
              : <TextBlock key={idx} text={chunk.value} />
          ))}
          {streaming && (
            <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-vscode-accent align-middle rounded-sm animate-pulse" />
          )}
        </div>
      </div>
    </div>
  );
}

function ToolCallBubble({ tool, done, input, output }) {
  const [open, setOpen] = useState(!done);

  useEffect(() => {
    if (done) setOpen(false);
  }, [done]);

  const summary = summarizeTool(tool, input);
  const inputText = formatToolPayload(input);
  const outputText = formatToolPayload(output);

  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] border-l border-vscode-border/60 pl-1 text-xs text-vscode-text-muted overflow-hidden">
        <button
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-start gap-2 px-2.5 py-1.5 text-left"
          style={{ background: 'none', border: 'none', outline: 'none' }}
        >
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 mt-1 ${done ? 'bg-emerald-500' : 'bg-vscode-accent animate-pulse'}`}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-vscode-text-muted">{summary}</div>
            <div className="mt-0.5 text-[10px] uppercase tracking-wide text-vscode-text-muted/80">
              {done ? 'done' : 'running'} • {tool}
            </div>
          </div>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"
            className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {open && (
          <div className="px-3 pb-3 border-t border-vscode-border/40 bg-vscode-sidebar/20">
            {inputText && <TruncatedPayload text={inputText} label="Input" />}
            {outputText && <TruncatedPayload text={outputText} label="Result" />}
            {!inputText && !outputText && (
              <div className="pt-2 text-[11px] text-vscode-text-muted">No additional details for this step.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolTimelineRow({ tool, done, input, output }) {
  const [open, setOpen] = useState(false);
  const summary = summarizeTool(tool, input);
  const inputText = formatToolPayload(input);
  const outputText = formatToolPayload(output);
  const hasDetails = !!(inputText || outputText);

  return (
    <div className="border-l border-vscode-border/50 ml-1">
      <button
        type="button"
        onClick={() => hasDetails && setOpen((v) => !v)}
        className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left ${hasDetails ? 'cursor-pointer' : 'cursor-default'}`}
        style={{ background: 'none', border: 'none', outline: 'none' }}
      >
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${done ? 'bg-emerald-500' : 'bg-vscode-accent animate-pulse'}`}
          aria-hidden="true"
        />
        <span className="text-[11px] text-vscode-text-muted truncate flex-1 min-w-0">{summary}</span>
        <span className="text-[10px] uppercase tracking-wide text-vscode-text-muted/80">{done ? 'done' : 'running'}</span>
        {hasDetails && (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"
            className={`w-3 h-3 shrink-0 text-vscode-text-muted transition-transform ${open ? 'rotate-180' : ''}`}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
      </button>
      {open && (
        <div className="pl-7 pr-2.5 pb-2 border-t border-vscode-border/30 bg-vscode-sidebar/20">
          {inputText && <TruncatedPayload text={inputText} label="Input" />}
          {outputText && <TruncatedPayload text={outputText} label="Result" />}
        </div>
      )}
    </div>
  );
}

const PAYLOAD_PREVIEW_LIMIT = 2000;

function TruncatedPayload({ text, label }) {
  const [expanded, setExpanded] = useState(false);
  const truncated = !expanded && text.length > PAYLOAD_PREVIEW_LIMIT;
  return (
    <div className="pt-2">
      <div className="text-[10px] uppercase tracking-wider text-vscode-text-muted mb-1">{label}</div>
      <pre className="whitespace-pre-wrap break-words text-[11px] text-vscode-text-muted leading-relaxed font-mono">
        {truncated ? text.slice(0, PAYLOAD_PREVIEW_LIMIT) + '…' : text}
      </pre>
      {text.length > PAYLOAD_PREVIEW_LIMIT && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[10px] text-vscode-accent hover:underline"
          style={{ background: 'none', border: 'none', outline: 'none', padding: 0, cursor: 'pointer' }}
        >
          {expanded ? 'Show less' : `Show ${text.length - PAYLOAD_PREVIEW_LIMIT} more chars`}
        </button>
      )}
    </div>
  );
}

function ReasoningBubble({ text }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex justify-start">
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ background: 'none', border: 'none', outline: 'none' }}
        className="flex flex-col gap-1 max-w-[85%] cursor-pointer text-left"
      >
        <span className="text-[11px] text-vscode-text-muted flex items-center gap-1">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          Thinking {open ? '▲' : '▼'}
        </span>
        {open && (
          <div className="px-3 py-2 rounded-xl text-xs text-vscode-text-muted
                          bg-vscode-sidebar border border-vscode-border
                          whitespace-pre-wrap leading-relaxed">
            {text}
          </div>
        )}
      </button>
    </div>
  );
}

function ThinkingPlaceholderBubble({ text }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[94%] min-w-0 rounded-xl border border-vscode-border bg-vscode-sidebar/30 px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-vscode-text-muted">
          <span className="inline-block w-2 h-2 rounded-full bg-vscode-accent animate-pulse" />
          <span>{text}</span>
        </div>
      </div>
    </div>
  );
}

function ErrorBubble({ text, isTimeout, isLoop, onContinue, className = '' }) {
  return (
    <div className={`px-3 py-2 rounded-xl text-sm bg-red-900/30 text-red-400 border border-red-900/50 break-words ${className}`}>
      <div>{text}</div>
      {isTimeout && !isLoop && onContinue && (
        <button
          type="button"
          onClick={onContinue}
          className="mt-2 px-3 py-1 rounded-lg text-xs text-red-300 border border-red-400/40 hover:bg-red-900/40"
          style={{ background: 'rgba(255,60,60,0.1)', outline: 'none', cursor: 'pointer' }}
        >
          Continue
        </button>
      )}
    </div>
  );
}

function TurnToolTimeline({ tools }) {
  const hasRunning = tools.some((t) => !t.done);
  const [open, setOpen] = useState(hasRunning);

  useEffect(() => {
    if (hasRunning) setOpen(true);
  }, [hasRunning]);

  return (
    <div className="mt-1 rounded-lg border border-vscode-border bg-vscode-bg/60 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-xs"
        style={{ background: 'none', border: 'none', outline: 'none' }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
          className={`w-3 h-3 text-vscode-text-muted transition-transform ${open ? 'rotate-90' : ''}`}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span className="text-vscode-text-muted">{tools.length} step{tools.length !== 1 ? 's' : ''}</span>
        <span className="ml-auto text-[11px] text-vscode-text-muted">{hasRunning ? 'Running' : 'Done'}</span>
      </button>
      {open && (
        <div className="border-t border-vscode-border/60 divide-y divide-vscode-border/30">
          {tools.map((tool) => (
            <ToolTimelineRow
              key={tool.id || `${tool.tool}-${tool.turnId || 'na'}`}
              tool={tool.tool}
              done={tool.done}
              input={tool.input}
              output={tool.output}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TurnResponseGroup({ messages, aiMode = 'agent', provider = 'copilot', longPressHandlers, onContinue }) {
  const orderedMessages = aiMode === 'plan'
    ? messages.filter((m) => m.role !== 'reasoning' && m.role !== 'tool')
    : messages;

  const modeColors = {
    agent: '#64c864',
    ask: '#ffa500',
    plan: '#6496ff',
    cloud: '#00c8ff',
  };
  const modeBgColors = {
    agent: 'rgba(100, 200, 100, 0.2)',
    ask: 'rgba(255, 165, 0, 0.2)',
    plan: 'rgba(100, 150, 255, 0.2)',
    cloud: 'rgba(0, 200, 255, 0.2)',
  };

  return (
    <div className="flex justify-start" {...(longPressHandlers || {})}>
      <div className="max-w-[96%] sm:max-w-[94%] min-w-0 rounded-lg bg-vscode-bg/25 p-2 sm:p-2.5 border-l-2" style={{ borderColor: modeColors[aiMode] || modeColors.agent }}>
        <div className="text-[10px] uppercase tracking-wider text-vscode-text-muted mb-1.5 flex items-center gap-2">
          <span>{providerDisplayName(provider)}</span>
          <span
            style={{
              fontSize: '9px',
              color: modeColors[aiMode] || modeColors.agent,
              backgroundColor: modeBgColors[aiMode] || modeBgColors.agent,
              padding: '2px 8px',
              borderRadius: '3px',
              fontWeight: '600',
            }}
          >
            {aiMode.toUpperCase()}
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          {orderedMessages.map((msg) => {
            if (msg.role === 'reasoning') {
              return <ReasoningBubble key={msg.id} text={msg.text} />;
            }

            if (msg.role === 'tool') {
              return (
                <div key={msg.id} className="rounded-md bg-transparent overflow-hidden">
                  <ToolTimelineRow
                    tool={msg.tool}
                    done={msg.done}
                    input={msg.input}
                    output={msg.output}
                  />
                </div>
              );
            }

            if (msg.role === 'agent' || msg.role === 'handoff') {
              return <AgentBubble key={msg.id} text={msg.text} streaming={msg.streaming} />;
            }

            if (msg.role === 'error') {
              return <ErrorBubble key={msg.id} text={msg.text} isTimeout={msg.isTimeout} isLoop={msg.isLoop} onContinue={onContinue} className="mt-1" />;
            }

            return null;
          })}
        </div>
      </div>
    </div>
  );
}

function buildRenderItems(messages) {
  const groupedByTurn = new Map();
  for (const msg of messages) {
    if (!msg.turnId) continue;
    if (!groupedByTurn.has(msg.turnId)) groupedByTurn.set(msg.turnId, []);
    groupedByTurn.get(msg.turnId).push(msg);
  }

  const items = [];
  const emittedTurns = new Set();
  const emittedMessageIds = new Set();

  for (const msg of messages) {
    if (emittedMessageIds.has(msg.id)) continue;

    if (msg.role === 'user') {
      items.push({ type: 'user', key: msg.id, message: msg });
      emittedMessageIds.add(msg.id);

      if (msg.turnId && !emittedTurns.has(msg.turnId)) {
        const turnMessages = (groupedByTurn.get(msg.turnId) || []).filter((m) => m.role !== 'user');
        if (turnMessages.length > 0) {
          items.push({ type: 'turn', key: `turn:${msg.turnId}`, messages: turnMessages });
          for (const tm of turnMessages) emittedMessageIds.add(tm.id);
          emittedTurns.add(msg.turnId);
        }
      }
      continue;
    }

    if (msg.turnId && !emittedTurns.has(msg.turnId)) {
      const turnMessages = (groupedByTurn.get(msg.turnId) || []).filter((m) => m.role !== 'user');
      if (turnMessages.length > 0) {
        items.push({ type: 'turn', key: `turn:${msg.turnId}`, messages: turnMessages });
        for (const tm of turnMessages) emittedMessageIds.add(tm.id);
        emittedTurns.add(msg.turnId);
      }
      continue;
    }

    if (!msg.turnId) {
      if (msg.role === 'agent') {
        items.push({ type: 'agent', key: msg.id, message: msg });
      } else if (msg.role === 'reasoning') {
        items.push({ type: 'reasoning', key: msg.id, message: msg });
      } else if (msg.role === 'tool') {
        items.push({ type: 'tool', key: msg.id, message: msg });
      } else if (msg.role === 'error') {
        items.push({ type: 'error', key: msg.id, message: msg });
      }
      emittedMessageIds.add(msg.id);
    }
  }

  return items;
}

export default function AgentView({ onOpenDiffFiles }) {
  const [messages, setMessages] = useState(() => readInitialMessages());
  const [reasoning, setReasoning] = useState('');
  const [input, setInput] = useState(() => readText(CHAT_INPUT_KEY, ''));
  const [viewTab, setViewTab] = useState(() => normalizeTab(readText(CHAT_VIEW_TAB_KEY, 'chat')));
  const [cloudJobs, setCloudJobs] = useState(readInitialCloudJobs);
  const [streaming, setStreaming] = useState(false);
  const [changesSummary, setChangesSummary] = useState({ totals: { files: 0, added: 0, removed: 0 }, files: [] });
  const [changesOpen, setChangesOpen] = useState(false);
  const [changesLoading, setChangesLoading] = useState(false);
  const [pendingReviewPaths, setPendingReviewPaths] = useState(readInitialPendingReviewPaths);
  const [reviewActionMsg, setReviewActionMsg] = useState('');
  const [undoBusy, setUndoBusy] = useState(false);
  const [keptSignatures, setKeptSignatures] = useState({});
  const [activeTurnId, setActiveTurnId] = useState(null);
  const [lastStreamEventAt, setLastStreamEventAt] = useState(0);
  const [streamClock, setStreamClock] = useState(0);
  const [quietStage, setQuietStage] = useState('thinking');
  const [aiMode, setAiMode] = useState(() => readText(CHAT_UI_AGENT_KEY, 'agent'));
  const [currentProvider, setCurrentProvider] = useState(() => normalizeProvider(readText(CHAT_UI_PROVIDER_KEY, 'copilot')));
  const [turnAiModes, setTurnAiModes] = useState(readInitialTurnAiModes);
  const [turnProviders, setTurnProviders] = useState(readInitialTurnProviders);
  const [contextMenu, setContextMenu] = useState(null);
  const bottomRef = useRef(null);
  const scrollRef = useRef(null);
  const abortRef = useRef(null);
  const preRequestSnapshotRef = useRef(new Map());
  const shouldAutoScrollRef = useRef(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [showScrollToPrevPrompt, setShowScrollToPrevPrompt] = useState(false);
  const [showScrollToNextPrompt, setShowScrollToNextPrompt] = useState(false);
  const activeTurnRef = useRef(null);
  const submitScrollTimerRef = useRef(null);
  const longPressRef = useRef(null);
  const submitLongPressRef = useRef(null);
  const longPressActivatedRef = useRef(false);
  const composerTextareaRef = useRef(null);
  const cloudJobStatusRef = useRef({});
  const wakeLockRef = useRef(null);
  const [composerTextareaHeight, setComposerTextareaHeight] = useState(46);
  const [attachments, setAttachments] = useState([]);
  const fileInputRef = useRef(null);

  const composerCounts = useMemo(() => {
    const trimmed = input.trim();
    const words = trimmed ? trimmed.split(/\s+/).length : 0;
    return {
      words,
      chars: input.length,
    };
  }, [input]);

  const composerMetricVisibility = useMemo(() => {
    const extraRoom = Math.max(0, composerTextareaHeight - 46);
    return {
      showChars: extraRoom >= 22,
      showWords: extraRoom >= 44,
    };
  }, [composerTextareaHeight]);

  function finalizePendingToolCalls(turnId = null, output = null) {
    setMessages((prev) => prev.map((msg) => {
      if (msg.role === 'tool' && !msg.done && (!turnId || msg.turnId === turnId)) {
        return {
          ...msg,
          done: true,
          output: msg.output ?? output,
        };
      }
      return msg;
    }));
  }

  const fetchChangesSummary = useCallback(async () => {
    setChangesLoading(true);
    try {
      const r = await fetch(apiUrl('/api/git/changes-summary'));
      if (!r.ok) throw new Error(`Failed (${r.status})`);
      const data = await r.json();
      const normalized = {
        totals: data?.totals || { files: 0, added: 0, removed: 0 },
        files: Array.isArray(data?.files) ? data.files : [],
      };
      setChangesSummary(normalized);
      return normalized;
    } catch (_) {
      const empty = { totals: { files: 0, added: 0, removed: 0 }, files: [] };
      setChangesSummary(empty);
      return empty;
    } finally {
      setChangesLoading(false);
    }
  }, []);

  function signatureByPath(summary) {
    const map = new Map();
    for (const f of summary.files || []) {
      map.set(
        f.path,
        [
          f.status,
          f.added || 0,
          f.removed || 0,
          f.mtimeMs || 0,
          f.staged ? 1 : 0,
          f.unstaged ? 1 : 0,
          f.untracked ? 1 : 0,
        ].join('|')
      );
    }
    return map;
  }

  function getVisibleWorkspacePaths() {
    const current = signatureByPath(changesSummary);
    return changesSummary.files
      .filter((file) => keptSignatures[file.path] !== current.get(file.path))
      .map((file) => file.path);
  }

  async function handleUndoAgentChanges() {
    const targetPaths = pendingReviewPaths;

    if (!targetPaths.length || undoBusy) return;
    setUndoBusy(true);
    setReviewActionMsg('');
    try {
      const r = await fetch(apiUrl('/api/git/discard-changes'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: targetPaths }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `Failed (${r.status})`);
      setPendingReviewPaths([]);
      setKeptSignatures({});
      setReviewActionMsg(`Undid ${data.reverted || 0} file change(s).`);
      await fetchChangesSummary();
    } catch (e) {
      setReviewActionMsg(e.message);
    } finally {
      setUndoBusy(false);
    }
  }

  async function handleKeepAgentChanges() {
    const targetPaths = pendingReviewPaths;

    if (!targetPaths.length) return;

    const current = signatureByPath(changesSummary);
    setKeptSignatures((prev) => {
      const next = { ...prev };
      for (const filePath of targetPaths) {
        const sig = current.get(filePath);
        if (sig) next[filePath] = sig;
      }
      return next;
    });

    setPendingReviewPaths([]);
    setReviewActionMsg('');

    // Snapshot current file content so future diffs show only changes since this keep.
    fetch(apiUrl('/api/git/keep-snapshot'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: targetPaths }),
    }).catch(() => {});
  }

  useEffect(() => {
    fetchChangesSummary();
    const timer = setInterval(fetchChangesSummary, 15000);
    return () => clearInterval(timer);
  }, [fetchChangesSummary]);

  useEffect(() => {
    const timer = setInterval(() => {
      const currentMode = readText(CHAT_UI_AGENT_KEY, 'agent');
      setAiMode(currentMode);
    }, 500);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const provider = normalizeProvider(readText(CHAT_UI_PROVIDER_KEY, 'copilot'));
    setCurrentProvider(provider);

    const timer = setInterval(() => {
      const updatedProvider = normalizeProvider(readText(CHAT_UI_PROVIDER_KEY, 'copilot'));
      setCurrentProvider((prev) => (updatedProvider !== prev ? updatedProvider : prev));
    }, 300);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const textarea = composerTextareaRef.current;
    if (!textarea) {
      setComposerTextareaHeight(46);
      return;
    }

    const updateHeight = () => {
      const next = Math.max(46, Math.round(textarea.getBoundingClientRect().height));
      setComposerTextareaHeight(next);
    };

    updateHeight();
    let observer = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(updateHeight);
      observer.observe(textarea);
    }
    window.addEventListener('resize', updateHeight);

    return () => {
      if (observer) observer.disconnect();
      window.removeEventListener('resize', updateHeight);
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined' || typeof navigator === 'undefined') return undefined;

    const wakeLockApi = navigator.wakeLock;
    if (!wakeLockApi || typeof wakeLockApi.request !== 'function') return undefined;

    let released = false;
    const shouldHoldWake = viewTab === 'chat' && streaming;

    const releaseWakeLock = async () => {
      const sentinel = wakeLockRef.current;
      wakeLockRef.current = null;
      if (!sentinel) return;
      try { await sentinel.release(); } catch (_) {}
    };

    const requestWakeLock = async () => {
      if (released || !shouldHoldWake || document.visibilityState !== 'visible') return;
      if (wakeLockRef.current) return;
      try {
        const sentinel = await wakeLockApi.request('screen');
        wakeLockRef.current = sentinel;
        sentinel.addEventListener('release', () => {
          if (wakeLockRef.current === sentinel) wakeLockRef.current = null;
        });
      } catch (_) {
        // Wake Lock is best-effort; ignore unsupported or denied requests.
      }
    };

    const handleVisibilityChange = () => {
      if (!shouldHoldWake) {
        releaseWakeLock();
        return;
      }
      if (document.visibilityState === 'visible') {
        requestWakeLock();
      }
    };

    if (shouldHoldWake) {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      released = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      releaseWakeLock();
    };
  }, [viewTab, streaming]);

  // Auto-scroll only when user is near the bottom.
  // Use immediate scroll here (not smooth) to avoid jumpy animation stacking
  // while streaming frequent deltas.
  useEffect(() => {
    if (!shouldAutoScrollRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  function handleMessagesScroll(e) {
    const el = e.currentTarget;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom < 80;
    shouldAutoScrollRef.current = nearBottom;
    setShowScrollToBottom(!nearBottom);

    const userMsgs = el.querySelectorAll('[data-user-msg]');
    const visibleBottom = el.scrollTop + el.clientHeight;
    let hasPromptAbove = false;
    let hasPromptBelow = false;
    for (const msgEl of userMsgs) {
      if (msgEl.offsetTop < el.scrollTop + 20) hasPromptAbove = true;
      if (msgEl.offsetTop > visibleBottom - 20) hasPromptBelow = true;
    }
    setShowScrollToPrevPrompt(hasPromptAbove);
    setShowScrollToNextPrompt(hasPromptBelow);
  }

  function scrollToBottom() {
    shouldAutoScrollRef.current = true;
    setShowScrollToBottom(false);
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }

  function scheduleDelayedScrollToBottom(delayMs = 250) {
    if (submitScrollTimerRef.current) {
      clearTimeout(submitScrollTimerRef.current);
    }

    submitScrollTimerRef.current = setTimeout(() => {
      submitScrollTimerRef.current = null;
      shouldAutoScrollRef.current = true;
      const el = scrollRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
      } else {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }, delayMs);
  }

  function scrollToPrevPrompt() {
    const el = scrollRef.current;
    if (!el) return;
    const userMsgs = Array.from(el.querySelectorAll('[data-user-msg]'));
    let targetEl = null;
    for (let i = userMsgs.length - 1; i >= 0; i--) {
      if (userMsgs[i].offsetTop < el.scrollTop - 10) {
        targetEl = userMsgs[i];
        break;
      }
    }
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function scrollToNextPrompt() {
    const el = scrollRef.current;
    if (!el) return;
    const userMsgs = Array.from(el.querySelectorAll('[data-user-msg]'));
    const visibleBottom = el.scrollTop + el.clientHeight;
    let targetEl = null;
    for (let i = 0; i < userMsgs.length; i++) {
      if (userMsgs[i].offsetTop > visibleBottom - 20) {
        targetEl = userMsgs[i];
        break;
      }
    }
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  useEffect(() => {
    const safeMessages = messages
      .filter((msg) => msg && typeof msg === 'object')
      .map((msg) => {
        if (msg.role === 'tool') {
          return {
            id: msg.id,
            turnId: msg.turnId,
            role: 'tool',
            tool: msg.tool,
            done: msg.done,
            input: msg.input ?? null,
            output: msg.output ?? null,
          };
        }
        if (msg.role === 'handoff') {
          return {
            id: msg.id,
            turnId: msg.turnId,
            role: 'handoff',
            text: msg.text,
            aiMode: normalizeMode(msg.aiMode),
            options: Array.isArray(msg.options) ? msg.options : null,
            selectedMode: normalizeMode(msg.selectedMode),
          };
        }
        return {
          id: msg.id,
          turnId: msg.turnId,
          role: msg.role,
          text: msg.text,
          provider: normalizeProvider(msg.provider),
          aiMode: normalizeMode(msg.aiMode),
          isTimeout: msg.isTimeout || false,
          attachments: Array.isArray(msg.attachments)
            ? msg.attachments.map(({ id, name, type, size, isImage, isText }) => ({ id, name, type, size, isImage, isText }))
            : undefined,
        };
      });
    writeJson(CHAT_MESSAGES_KEY, safeMessages);
  }, [messages]);

  useEffect(() => {
    writeJson(CHAT_TURN_AI_MODES_KEY, turnAiModes);
  }, [turnAiModes]);

  useEffect(() => {
    writeJson(CHAT_TURN_PROVIDERS_KEY, turnProviders);
  }, [turnProviders]);

  useEffect(() => () => {
    if (submitScrollTimerRef.current) {
      clearTimeout(submitScrollTimerRef.current);
    }
  }, []);

  useEffect(() => {
    writeText(CHAT_INPUT_KEY, input);
  }, [input]);

  useEffect(() => {
    writeText(CHAT_VIEW_TAB_KEY, viewTab);
  }, [viewTab]);

  useEffect(() => {
    writeJson(CHAT_CLOUD_JOBS_KEY, cloudJobs);
  }, [cloudJobs]);

  useEffect(() => {
    writeJson(CHAT_PENDING_REVIEW_KEY, pendingReviewPaths);
  }, [pendingReviewPaths]);

  useEffect(() => {
    setPendingReviewPaths((prev) => {
      if (!prev.length) return prev;
      if (!changesSummary.files.length) return [];
      const changedPaths = new Set(changesSummary.files.map((file) => file.path));
      const next = prev.filter((filePath) => changedPaths.has(filePath));
      return next.length !== prev.length ? next : prev;
    });
  }, [changesSummary.files]);

  useEffect(() => {
    const current = signatureByPath(changesSummary);
    setKeptSignatures((prev) => {
      const next = {};
      let changed = false;

      for (const [filePath, keptSig] of Object.entries(prev)) {
        if (current.get(filePath) === keptSig) {
          next[filePath] = keptSig;
        } else {
          changed = true;
        }
      }

      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (!changed && prevKeys.length === nextKeys.length) return prev;
      return next;
    });
  }, [changesSummary]);

  useEffect(() => {
    if (!streaming) return;
    const id = setInterval(() => setStreamClock(Date.now()), 250);
    return () => clearInterval(id);
  }, [streaming]);

  const latestUserTurnId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'user' && messages[i]?.turnId) {
        return messages[i].turnId;
      }
    }
    return null;
  }, [messages]);

  function closeContextMenu() {
    setContextMenu(null);
  }

  function selectAiMode(mode) {
    writeText(CHAT_UI_AGENT_KEY, mode);
    setAiMode(mode);
    closeContextMenu();
  }

  async function handleCopyFromContextMenu() {
    if (!contextMenu?.text) return;
    try {
      await navigator.clipboard.writeText(contextMenu.text);
      setReviewActionMsg('Copied to clipboard.');
    } catch (_) {
      setReviewActionMsg('Could not copy to clipboard.');
    } finally {
      closeContextMenu();
    }
  }

  async function handleFileSelect(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    e.target.value = '';
    const newAttachments = await Promise.all(files.map(readAttachmentFile));
    setAttachments((prev) => [...prev, ...newAttachments]);
  }

  function removeAttachment(id) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  async function sendPrompt(promptText) {
    const prompt = String(promptText || '').trim();
    if ((!prompt && attachments.length === 0) || streaming) return;

    const requestAiMode = normalizeMode(readText(CHAT_UI_AGENT_KEY, 'agent')) || 'agent';
    const requestProvider = normalizeProvider(readText(CHAT_UI_PROVIDER_KEY, 'Copilot'));
    const requestExecutionMode = normalizeExecutionMode(readText(CHAT_UI_EXEC_MODE_KEY, 'Chat'));
    const runAsCloud = requestExecutionMode === 'cloud' || requestAiMode === 'cloud';
    const turnId = createMessageId();
    const latestPlanText = getLatestPlanResponseText(messages, turnAiModes);
    const planChoice = resolvePlanContinuationChoice(prompt);
    const outgoingPrompt = buildModeSwitchContinuationPrompt(prompt, requestAiMode, latestPlanText, planChoice);
    const currentAttachments = attachments.length > 0 ? attachments : undefined;

    if (runAsCloud) {
      setInput('');
      setAttachments([]);
      setReasoning('');
      setTurnAiModes((prev) => ({ ...prev, [turnId]: requestAiMode }));
      setTurnProviders((prev) => ({ ...prev, [turnId]: requestProvider }));
      setMessages((prev) => [...prev, { id: createMessageId(), turnId, role: 'user', text: prompt, aiMode: requestAiMode, attachments: currentAttachments }]);
      scheduleDelayedScrollToBottom(120);

      try {
        const created = await createCloudJob(outgoingPrompt, turnId, requestProvider, currentAttachments);
        setMessages((prev) => [
          ...prev,
          {
            id: createMessageId(),
            turnId,
            role: 'agent',
            text: `Started ${providerDisplayName(requestProvider)} cloud task ${created.jobId}. You can monitor and cancel it from the Cloud tab.`,
            aiMode: requestAiMode,
            streaming: false,
          },
        ]);
        setViewTab('cloud');
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            id: createMessageId(),
            turnId,
            role: 'error',
            text: err?.message || 'Failed to start cloud task.',
            aiMode: requestAiMode,
          },
        ]);
      }
      return;
    }

    activeTurnRef.current = turnId;
    setActiveTurnId(turnId);
    setLastStreamEventAt(Date.now());
    setQuietStage('thinking');
    shouldAutoScrollRef.current = true;

      // Fetch a fresh git baseline right now so the snapshot is never based on
      // stale React state. Without this, if the user hits Keep and immediately
      // sends another message, the old changesSummary state (pre-previous-turn)
      // is used as "before", causing all prior changes to appear as new again.
      const baselineSummary = await fetchChangesSummary();
      preRequestSnapshotRef.current = signatureByPath(baselineSummary);
      setReviewActionMsg('');

    setInput('');
    setAttachments([]);
    setReasoning('');
    setStreaming(true);

    // Append user message
    setMessages((prev) => [...prev, { id: createMessageId(), turnId, role: 'user', text: prompt, aiMode: requestAiMode, attachments: currentAttachments }]);
    scheduleDelayedScrollToBottom(250);

    // Text bubbles are created on demand as delta events arrive.
    // activeTextBubbleId  — the id of the currently-streaming text bubble (null between segments).
    // firstAgentId        — used to inject reasoning before the first agent bubble.
    let activeTextBubbleId = null;
    let firstAgentId = null;

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const requestTimeoutId = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    const autoCloudAfterMs = resolveAutoCloudPromotionMs();
    const shouldAutoPromoteToCloud = requestExecutionMode === 'chat' && requestAiMode !== 'plan';
    let autoPromotedToCloud = false;
    const autoPromoteTimerId = shouldAutoPromoteToCloud
      ? setTimeout(() => {
          if (ctrl.signal.aborted) return;
          if (activeTurnRef.current !== turnId) return;

          autoPromotedToCloud = true;
          ctrl.abort();

          createCloudJob(outgoingPrompt, turnId, requestProvider, currentAttachments)
            .then((created) => {
              setMessages((prev) => [
                ...prev,
                {
                  id: createMessageId(),
                  turnId,
                  role: 'agent',
                  text: `Long-running chat was promoted to ${providerDisplayName(requestProvider)} cloud task ${created.jobId}. Continue in the Cloud tab.`,
                  aiMode: requestAiMode,
                  streaming: false,
                },
              ]);
              setViewTab('cloud');
            })
            .catch((promoteErr) => {
              setMessages((prev) => [
                ...prev,
                {
                  id: createMessageId(),
                  turnId,
                  role: 'error',
                  text: promoteErr?.message || 'Auto-promotion to cloud failed after long-running chat stream.',
                  aiMode: requestAiMode,
                },
              ]);
            });
        }, autoCloudAfterMs)
      : null;

    try {
      setTurnAiModes((prev) => ({ ...prev, [turnId]: requestAiMode }));
      setTurnProviders((prev) => ({ ...prev, [turnId]: requestProvider }));
      const res = await fetch(apiUrl('/api/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: outgoingPrompt, aiMode: requestAiMode, provider: requestProvider, attachments: currentAttachments }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let reasoningAcc = '';
      let sawServerError = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop(); // keep incomplete last line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let event;
          try { event = JSON.parse(line.slice(6)); } catch { continue; }
          setLastStreamEventAt(Date.now());

          switch (event.type) {
            case 'reasoning':
              if (requestAiMode === 'plan') break;
              setQuietStage('planning');
              reasoningAcc += event.content;
              setReasoning(reasoningAcc);
              break;

            case 'delta':
              setQuietStage('writing');
              if (!activeTextBubbleId) {
                const newId = createMessageId();
                if (!firstAgentId) firstAgentId = newId;
                activeTextBubbleId = newId;
                setMessages((prev) => [...prev, { id: newId, turnId, role: 'agent', text: event.content, aiMode: requestAiMode, streaming: true }]);
              } else {
                const curId = activeTextBubbleId;
                setMessages((prev) => {
                  const next = [...prev];
                  const i = next.findIndex((m) => m.id === curId);
                  if (i !== -1 && next[i].role === 'agent') {
                    next[i] = { ...next[i], text: next[i].text + event.content };
                  }
                  return next;
                });
              }
              break;

            case 'tool_call': {
              if (requestAiMode === 'plan') break;
              setQuietStage('tools');
              // Finalize the current text bubble before showing the tool action
              const curId = activeTextBubbleId;
              if (curId) {
                setMessages((prev) => {
                  const next = [...prev];
                  const i = next.findIndex((m) => m.id === curId);
                  if (i !== -1 && next[i].role === 'agent') {
                    if (!next[i].text.trim()) {
                      next.splice(i, 1);
                      if (firstAgentId === curId) firstAgentId = null;
                    } else {
                      next[i] = { ...next[i], streaming: false };
                    }
                  }
                  return next;
                });
                activeTextBubbleId = null;
              }
              setMessages((prev) => [
                ...prev,
                { id: createMessageId(), turnId, role: 'tool', tool: event.tool, input: event.input ?? null, output: null, done: false },
              ]);
              break;
            }

            case 'tool_result':
              if (requestAiMode === 'plan') break;
              setQuietStage('tools');
              setMessages((prev) => {
                const next = [...prev];
                // Prefer exact tool-name match; fallback to last pending tool.
                let matchedIndex = -1;
                for (let i = next.length - 1; i >= 0; i--) {
                  if (next[i].role === 'tool' && next[i].tool === event.tool && !next[i].done) {
                    matchedIndex = i;
                    break;
                  }
                }
                if (matchedIndex === -1) {
                  for (let i = next.length - 1; i >= 0; i--) {
                    if (next[i].role === 'tool' && !next[i].done) {
                      matchedIndex = i;
                      break;
                    }
                  }
                }
                if (matchedIndex !== -1) {
                  next[matchedIndex] = { ...next[matchedIndex], done: true, output: event.output ?? null };
                }
                return next;
              });
              break;

            case 'message':
              setQuietStage('writing');
              // Finalize the active streaming text bubble with authoritative final content
              if (activeTextBubbleId) {
                const curId = activeTextBubbleId;
                setMessages((prev) => {
                  const next = [...prev];
                  const i = next.findIndex((m) => m.id === curId);
                  if (i !== -1 && next[i].role === 'agent') {
                    next[i] = { ...next[i], text: event.content, streaming: false };
                  }
                  return next;
                });
                activeTextBubbleId = null;
              } else if (event.content?.trim()) {
                // No active bubble — message arrived without prior deltas
                const newId = createMessageId();
                if (!firstAgentId) firstAgentId = newId;
                setMessages((prev) => [...prev, { id: newId, turnId, role: 'agent', text: event.content, aiMode: requestAiMode, streaming: false }]);
              }
              break;

            case 'plan_handoff':
              setQuietStage('writing');
              if (activeTextBubbleId) {
                const curId = activeTextBubbleId;
                setMessages((prev) => {
                  const next = [...prev];
                  const i = next.findIndex((m) => m.id === curId);
                  if (i !== -1 && next[i].role === 'agent') {
                    next[i] = { ...next[i], streaming: false };
                  }
                  return next;
                });
                activeTextBubbleId = null;
              }
              setMessages((prev) => [
                ...prev,
                {
                  id: createMessageId(),
                  turnId,
                  role: 'agent',
                  text: typeof event.content === 'string' ? event.content : 'Choose how you want to continue:',
                  aiMode: requestAiMode,
                  streaming: false,
                },
              ]);
              break;

            case 'error':
              setQuietStage('thinking');
              sawServerError = true;
              finalizePendingToolCalls(turnId, { error: event.message || 'Tool execution ended with error.' });
              setMessages((prev) => [
                ...prev,
                { id: createMessageId(), turnId, role: 'error', text: event.message, aiMode: requestAiMode, isTimeout: Boolean(event.isTimeout) },
              ]);
              break;

            case 'done':
              setQuietStage('thinking');
              finalizePendingToolCalls(turnId);
              break;
          }
        }
      }

      // If reasoning was accumulated, inject it just before the first agent bubble
      if (requestAiMode !== 'plan' && reasoningAcc && firstAgentId) {
        const fId = firstAgentId;
        setMessages((prev) => {
          const next = [...prev];
          const i = next.findIndex((m) => m.id === fId);
          if (i !== -1) next.splice(i, 0, { id: createMessageId(), turnId, role: 'reasoning', text: reasoningAcc, aiMode: requestAiMode });
          return next;
        });
      }

      // Finalise: clean up any remaining streaming agent bubble (safety net)
      setMessages((prev) => {
        const next = [...prev];
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].role === 'agent' && next[i].streaming && next[i].turnId === turnId) {
            const text = typeof next[i].text === 'string' ? next[i].text.trim() : '';
            if (!text) {
              if (sawServerError) {
                next.splice(i, 1);
              } else {
                next[i] = {
                  id: createMessageId(),
                  turnId,
                  role: 'error',
                  text: 'No response content was returned by the agent. Check backend auth/token setup.',
                  aiMode: requestAiMode,
                };
              }
            } else {
              next[i] = { ...next[i], streaming: false };
            }
            break;
          }
        }
        return next;
      });

    } catch (err) {
      if (err.name !== 'AbortError') {
        const disconnectLike = isLikelyClientDisconnectError(err);
        finalizePendingToolCalls(turnId, { error: err.message || 'Tool execution ended with error.' });
        setMessages((prev) => {
          const next = [...prev];

          // Finalize any open streaming bubble for this turn (same logic as the safety net above).
          // On Safari/WebKit, reader.read() throws "Load failed" even after all data has arrived,
          // so we must not discard content that was successfully received.
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].role === 'agent' && next[i].streaming && next[i].turnId === turnId) {
              const text = typeof next[i].text === 'string' ? next[i].text.trim() : '';
              if (text) {
                next[i] = { ...next[i], streaming: false };
              } else {
                next.splice(i, 1);
              }
              break;
            }
          }

          // Only surface the error if no agent content was rendered for this turn at all.
          // firstAgentId being set means at least one agent bubble was created — the response
          // arrived. This suppresses spurious "Load failed" / "Failed to fetch" noise from
          // Safari/WebKit, which throws a network error even when the stream closed cleanly.
          if (disconnectLike) {
            next.push({
              id: createMessageId(),
              turnId,
              role: 'error',
              text: 'Client disconnected during the live chat stream. The connection to the server was interrupted before completion.',
              aiMode: requestAiMode,
            });
          } else if (!firstAgentId) {
            next.push({ id: createMessageId(), turnId, role: 'error', text: err.message, aiMode: requestAiMode });
          }

          return next;
        });
      } else if (!autoPromotedToCloud && activeTurnRef.current === turnId) {
        setMessages((prev) => [
          ...prev,
          {
            id: createMessageId(),
            turnId,
            role: 'error',
            text: 'Client disconnected or the live request was cancelled before completion.',
            aiMode: requestAiMode,
          },
        ]);
      }
    } finally {
      clearTimeout(requestTimeoutId);
      if (autoPromoteTimerId) clearTimeout(autoPromoteTimerId);
      finalizePendingToolCalls(turnId);
      activeTurnRef.current = null;
      setActiveTurnId(null);
      setStreaming(false);
      abortRef.current = null;
      const nextSummary = await fetchChangesSummary();
      const before = preRequestSnapshotRef.current;
      const after = signatureByPath(nextSummary);
      const touched = [];
      for (const filePath of new Set([...before.keys(), ...after.keys()])) {
        if (before.get(filePath) !== after.get(filePath)) {
          touched.push(filePath);
        }
      }
      if (touched.length > 0) {
        setPendingReviewPaths(touched);
      }
    }
  }

  async function handleRetryFromContextMenu() {
    if (!contextMenu?.allowRetry || !contextMenu?.text || streaming) return;
    closeContextMenu();
    await sendPrompt(contextMenu.text);
  }

  function buildLongPressHandlers(payload) {
    return {
      onPointerDown: (e) => {
        if (!payload?.text) return;
        if (e.button != null && e.button !== 0) return;
        if (e.target?.closest?.('button,a,input,textarea,select,label')) return;
        longPressRef.current = {
          startedAt: Date.now(),
          startX: e.clientX,
          startY: e.clientY,
          cancelled: false,
          payload,
        };
      },
      onPointerMove: (e) => {
        const state = longPressRef.current;
        if (!state) return;
        const dx = Math.abs(e.clientX - state.startX);
        const dy = Math.abs(e.clientY - state.startY);
        if (dx > 10 || dy > 10) {
          state.cancelled = true;
        }
      },
      onPointerUp: (e) => {
        const state = longPressRef.current;
        longPressRef.current = null;
        if (!state || state.cancelled) return;
        const elapsed = Date.now() - state.startedAt;
        if (elapsed < 250 || elapsed > 800) return;
        const selectedText = typeof window !== 'undefined' ? window.getSelection?.().toString() : '';
        if (selectedText) return;
        const maxX = typeof window !== 'undefined' ? window.innerWidth - 20 : e.clientX;
        const maxY = typeof window !== 'undefined' ? window.innerHeight - 20 : e.clientY;
        setContextMenu({
          ...state.payload,
          x: Math.max(12, Math.min(e.clientX, maxX)),
          y: Math.max(12, Math.min(e.clientY, maxY)),
        });
      },
      onPointerCancel: () => {
        longPressRef.current = null;
      },
      onPointerLeave: () => {
        const state = longPressRef.current;
        if (state) state.cancelled = true;
      },
    };
  }

  async function handleSend(e) {
    e.preventDefault();
    await sendPrompt(input);
  }

  function handleSubmitButtonClick() {
    if (longPressActivatedRef.current) {
      longPressActivatedRef.current = false;
      return;
    }
    if (streaming) {
      handleAbort();
    } else if (input.trim()) {
      sendPrompt(input);
    }
  }

  function buildSubmitLongPressHandlers() {
    return {
      onPointerDown: (e) => {
        e.preventDefault(); // keep keyboard open on iOS
        if (e.button != null && e.button !== 0) return;
        if (streaming) return;
        const target = e.currentTarget;
        const timerId = setTimeout(() => {
          const state = submitLongPressRef.current;
          if (!state || state.cancelled) return;
          submitLongPressRef.current = null;
          longPressActivatedRef.current = true;
          const rect = target.getBoundingClientRect();
          setContextMenu({
            type: 'modeSelect',
            x: rect.left + rect.width / 2,
            y: rect.top,
          });
        }, 350);
        submitLongPressRef.current = {
          timerId,
          startX: e.clientX,
          startY: e.clientY,
          cancelled: false,
        };
      },
      onPointerMove: (e) => {
        const state = submitLongPressRef.current;
        if (!state) return;
        const dx = Math.abs(e.clientX - state.startX);
        const dy = Math.abs(e.clientY - state.startY);
        if (dx > 10 || dy > 10) {
          state.cancelled = true;
          clearTimeout(state.timerId);
          submitLongPressRef.current = null;
        }
      },
      onPointerUp: () => {
        if (streaming) {
          handleAbort();
          return;
        }
        const state = submitLongPressRef.current;
        if (!state) return;
        clearTimeout(state.timerId);
        submitLongPressRef.current = null;
        if (!state.cancelled && !longPressActivatedRef.current) {
          if (input.trim()) sendPrompt(input);
        }
        longPressActivatedRef.current = false;
      },
      onPointerCancel: () => {
        const state = submitLongPressRef.current;
        if (!state) return;
        clearTimeout(state.timerId);
        submitLongPressRef.current = null;
      },
    };
  }

  function handleAbort() {
    const turnId = activeTurnRef.current;
    abortRef.current?.abort();
    finalizePendingToolCalls(turnId, { cancelled: true });
    setActiveTurnId(null);
    setStreaming(false);
    setMessages((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        const msg = next[i];
        if (msg?.role === 'agent' && msg.streaming && (!turnId || msg.turnId === turnId)) {
          next[i] = {
            ...msg,
            streaming: false,
            text: msg.text ? msg.text + '\n\n_(aborted)_' : '',
          };
          if (!next[i].text) {
            next.splice(i, 1);
          }
          break;
        }
      }
      return next;
    });
  }

  async function handleCopyReviewSummary() {
    const files = displayFiles;
    const header = `Files changed: ${totalsForHeader.files} +${totalsForHeader.added} -${totalsForHeader.removed}`;
    const lines = files.slice(0, 100).map((file) => `${file.path} (+${file.added || 0} -${file.removed || 0})`);
    const text = [header, ...lines].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setReviewActionMsg('Copied change summary.');
    } catch (_) {
      setReviewActionMsg('Could not copy summary.');
    }
  }

  async function handleOpenAllEdits() {
    setReviewActionMsg('');
    try {
      const r = await fetch(apiUrl('/api/git/changes-diff'));
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `Failed (${r.status})`);
      const files = Array.isArray(data.files) ? data.files : [];
      if (!files.length) {
        setReviewActionMsg('No editable diffs found.');
        return;
      }
      onOpenDiffFiles?.(files);
    } catch (e) {
      setReviewActionMsg(e.message || 'Failed to load edits.');
    }
  }

  function formatCloudStatusMessage(job) {
    const label = `${providerDisplayName(job.provider)} cloud task ${job.jobId}`;
    switch (job.status) {
      case 'queued':
        return `${label} queued.`;
      case 'running':
        return `${label} is running in the background.`;
      case 'succeeded':
        return job.resultText
          ? `${label} completed.\n\n${job.resultText}`
          : `${label} completed.`;
      case 'failed':
        return `${label} failed: ${job.error?.message || 'Unknown error.'}`;
      case 'cancelled':
        return `${label} was cancelled.`;
      default:
        return `${label} status: ${job.status}.`;
    }
  }

  function announceCloudStatusTransitions(nextJobs) {
    const known = cloudJobStatusRef.current;
    const updates = [];

    for (const job of nextJobs) {
      const prevStatus = known[job.jobId];
      if (!prevStatus || prevStatus !== job.status) {
        updates.push(job);
      }
      known[job.jobId] = job.status;
    }

    const terminal = new Set(['succeeded', 'failed', 'cancelled']);
    const terminalUpdates = updates.filter((job) => terminal.has(job.status));
    if (!terminalUpdates.length) return;

    const providerByTurn = {};
    for (const job of terminalUpdates) {
      if (job.turnId) providerByTurn[job.turnId] = normalizeProvider(job.provider || 'copilot');
    }
    if (Object.keys(providerByTurn).length > 0) {
      setTurnProviders((prevProviders) => ({ ...prevProviders, ...providerByTurn }));
    }

    setMessages((prev) => {
      const next = [...prev];
      for (const job of terminalUpdates) {
        next.push({
          id: createMessageId(),
          turnId: job.turnId,
          role: job.status === 'failed' ? 'error' : 'agent',
          text: formatCloudStatusMessage(job),
          provider: normalizeProvider(job.provider || 'copilot'),
          aiMode: 'cloud',
        });
      }
      return next;
    });
  }

  const fetchCloudJobs = useCallback(async () => {
    try {
      const r = await fetch(apiUrl('/api/jobs?limit=80'));
      if (!r.ok) throw new Error(`Failed (${r.status})`);
      const data = await r.json();
      const incoming = Array.isArray(data?.jobs)
        ? data.jobs.map(normalizeCloudJob).filter(Boolean)
        : [];

      announceCloudStatusTransitions(incoming);
      setCloudJobs(incoming);
      return incoming;
    } catch (_) {
      return [];
    }
  }, []);

  useEffect(() => {
    fetchCloudJobs();
    const id = setInterval(fetchCloudJobs, 4000);
    return () => clearInterval(id);
  }, [fetchCloudJobs]);

  async function createCloudJob(message, turnId, provider, attachments) {
    const r = await fetch(apiUrl('/api/jobs'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, aiMode: 'cloud', turnId, provider, attachments }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error(data.error || `Failed (${r.status})`);
    }
    await fetchCloudJobs();
    return data;
  }

  async function handleCancelCloudJob(jobId) {
    try {
      const r = await fetch(apiUrl(`/api/jobs/${encodeURIComponent(jobId)}/cancel`), {
        method: 'POST',
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `Failed (${r.status})`);
      await fetchCloudJobs();
    } catch (e) {
      setReviewActionMsg(e.message || 'Failed to cancel cloud job.');
    }
  }

  const reviewFileSet = new Set(pendingReviewPaths);
  const currentSignatures = useMemo(() => signatureByPath(changesSummary), [changesSummary]);
  const visibleWorkspaceFiles = useMemo(
    () => changesSummary.files.filter((file) => keptSignatures[file.path] !== currentSignatures.get(file.path)),
    [changesSummary.files, keptSignatures, currentSignatures]
  );
  const displayFiles = visibleWorkspaceFiles.filter((file) => reviewFileSet.has(file.path));
  const displayTotals = useMemo(
    () => displayFiles.reduce(
      (acc, file) => ({
        files: acc.files + 1,
        added: acc.added + (file.added || 0),
        removed: acc.removed + (file.removed || 0),
      }),
      { files: 0, added: 0, removed: 0 }
    ),
    [displayFiles]
  );
  const totalsForHeader = displayTotals;
  const fileWord = totalsForHeader.files === 1 ? 'file' : 'files';
  useEffect(() => {
    if (!totalsForHeader.files && changesOpen) {
      setChangesOpen(false);
    }
  }, [totalsForHeader.files, changesOpen]);
  const renderItems = useMemo(() => buildRenderItems(messages), [messages]);
  const activeTurnMessages = useMemo(
    () => (activeTurnId ? messages.filter((m) => m.turnId === activeTurnId) : []),
    [messages, activeTurnId]
  );
  const activeTurnAiMode = activeTurnId ? turnAiModes[activeTurnId] || 'agent' : 'agent';
  const hasVisibleProgressCue = activeTurnMessages.some((m) =>
    (m.role === 'tool' && !m.done)
    || (m.role === 'agent' && m.streaming && typeof m.text === 'string' && m.text.trim().length > 0)
  );
  const showThinkingPlaceholder = streaming
    && Boolean(activeTurnId)
    && !hasVisibleProgressCue
    && (streamClock - lastStreamEventAt > 1200);
  const thinkingLabel = quietStage === 'planning'
    ? 'Planning...'
    : quietStage === 'tools'
      ? 'Running tools...'
      : quietStage === 'writing'
        ? 'Writing response...'
        : 'Thinking...';
  useEffect(() => {
    if (!showThinkingPlaceholder || !shouldAutoScrollRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [showThinkingPlaceholder, thinkingLabel]);
  const sortedCloudJobs = useMemo(
    () => [...cloudJobs].sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0)),
    [cloudJobs]
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Message list */}
      <div className="relative min-h-0 flex-1">
        <div className="px-2.5 pt-2 pb-1 border-b border-vscode-border flex items-center gap-1.5 select-none justify-between">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setViewTab('chat')}
              className="px-2.5 py-1 rounded-md text-xs"
              style={{
                border: '1px solid var(--color-vscode-border)',
                background: viewTab === 'chat' ? 'var(--color-vscode-sidebar)' : 'transparent',
                color: 'var(--color-vscode-text)',
              }}
            >
              Chat
            </button>
            <button
              type="button"
              onClick={() => setViewTab('cloud')}
              className="px-2.5 py-1 rounded-md text-xs"
              style={{
                border: '1px solid var(--color-vscode-border)',
                background: viewTab === 'cloud' ? 'var(--color-vscode-sidebar)' : 'transparent',
                color: 'var(--color-vscode-text)',
              }}
            >
              Cloud ({cloudJobs.length})
            </button>
          </div>
          <div className="flex items-center gap-1.5 text-vscode-text opacity-70">
            <ProviderIcon provider={currentProvider} className="w-4 h-4" />
            <span className="text-xs" title={`Provider: ${currentProvider}`}>{providerDisplayName(currentProvider)}</span>
          </div>
        </div>

        {viewTab === 'chat' ? (
        <div ref={scrollRef} onScroll={handleMessagesScroll} className="h-[calc(100%-37px)] overflow-x-hidden overflow-y-auto overscroll-y-contain p-3 sm:p-4 flex flex-col gap-2.5 sm:gap-3">
        {renderItems.map((item) => {
          if (item.type === 'user') {
            const mode = (item.message.turnId ? turnAiModes[item.message.turnId] : null) || normalizeMode(item.message.aiMode) || 'agent';
            const allowRetry = item.message.turnId === latestUserTurnId;
            return (
              <div key={item.key} data-user-msg="true">
                <UserBubble
                  text={item.message.text}
                  mode={mode}
                  attachments={item.message.attachments}
                  longPressHandlers={buildLongPressHandlers({
                    text: item.message.text,
                    allowRetry,
                  })}
                />
              </div>
            );
          }
          if (item.type === 'turn') {
            const turnId = item.messages[0]?.turnId;
            const fallbackMode = normalizeMode(item.messages.find((m) => m?.aiMode)?.aiMode);
            const mode = turnId ? turnAiModes[turnId] || fallbackMode || 'agent' : fallbackMode || 'agent';
            const responseText = item.messages
              .filter((m) => m.role === 'agent' || m.role === 'error')
              .map((m) => m.text || '')
              .join('\n\n')
              .trim();
            return (
              <TurnResponseGroup
                key={item.key}
                messages={item.messages}
                aiMode={mode}
                provider={turnId ? (turnProviders[turnId] || 'copilot') : 'copilot'}
                longPressHandlers={buildLongPressHandlers({
                  text: responseText,
                  allowRetry: false,
                })}
                onContinue={() => sendPrompt('continue')}
              />
            );
          }
          if (item.type === 'agent') {
            return (
              <div key={item.key} {...buildLongPressHandlers({ text: item.message.text || '', allowRetry: false })}>
                <AgentBubble text={item.message.text} streaming={item.message.streaming} />
              </div>
            );
          }
          if (item.type === 'reasoning') return <ReasoningBubble key={item.key} text={item.message.text} />;
          if (item.type === 'tool') return <ToolCallBubble key={item.key} tool={item.message.tool} done={item.message.done} input={item.message.input} output={item.message.output} />;
          if (item.type === 'error') return (
            <div key={item.key} className="flex justify-start" {...buildLongPressHandlers({ text: item.message.text || '', allowRetry: false })}>
              <div className="max-w-[85%]">
                <ErrorBubble text={item.message.text} isTimeout={item.message.isTimeout} isLoop={item.message.isLoop} onContinue={() => sendPrompt('continue')} />
              </div>
            </div>
          );
          return null;
        })}
        {showThinkingPlaceholder && <ThinkingPlaceholderBubble text={thinkingLabel} />}
        <div ref={bottomRef} />
        </div>
        ) : (
        <div className="h-[calc(100%-37px)] overflow-x-hidden overflow-y-auto overscroll-y-contain p-3 sm:p-4">
          {sortedCloudJobs.length === 0 ? (
            <div className="rounded-lg border border-vscode-border bg-vscode-sidebar/40 px-3 py-2 text-sm text-vscode-text-muted">
              No cloud runs yet. Set Execution to Cloud and send a prompt to queue a background run.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {sortedCloudJobs.map((job) => {
                const statusColor = job.status === 'succeeded'
                  ? '#22c55e'
                  : job.status === 'failed'
                    ? '#f87171'
                    : job.status === 'cancelled'
                      ? '#f59e0b'
                      : '#00c8ff';
                const canCancel = job.status === 'queued' || job.status === 'running';
                return (
                  <div key={job.jobId} className="rounded-lg border border-vscode-border bg-vscode-sidebar/40 px-3 py-2">
                    <div className="flex items-center gap-2 text-xs text-vscode-text-muted">
                      <span className="inline-block w-2 h-2 rounded-full" style={{ background: statusColor }} />
                      <span className="px-1.5 py-0.5 rounded border border-vscode-border/70 text-[10px] uppercase">
                        {providerDisplayName(job.provider)}
                      </span>
                      <span className="uppercase">{job.status}</span>
                      <span className="ml-auto">{job.jobId}</span>
                    </div>
                    <div className="mt-1 text-sm text-vscode-text whitespace-pre-wrap break-words">{job.message || '(no prompt text)'}</div>
                    {job.resultText && (
                      <div className="mt-2 text-xs text-vscode-text-muted whitespace-pre-wrap break-words">
                        {job.resultText}
                      </div>
                    )}
                    {job.error?.message && (
                      <div className="mt-2 text-xs text-red-400 whitespace-pre-wrap break-words">
                        {job.error.message}
                      </div>
                    )}
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleCancelCloudJob(job.jobId)}
                        disabled={!canCancel}
                        className="px-2.5 py-1 rounded-md text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{
                          border: '1px solid var(--color-vscode-border)',
                          background: 'transparent',
                          color: 'var(--color-vscode-text)',
                        }}
                      >
                        Cancel
                      </button>
                      <span className="text-[11px] text-vscode-text-muted ml-auto">
                        {job.updatedAt ? new Date(job.updatedAt).toLocaleTimeString() : ''}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        )}
        {viewTab === 'chat' && showScrollToPrevPrompt && (
          <button
            type="button"
            onClick={scrollToPrevPrompt}
            className="absolute right-3 bottom-14 h-8 w-8 rounded-full border border-vscode-border text-vscode-text-muted hover:text-vscode-text flex items-center justify-center cursor-pointer"
            style={{ backgroundColor: 'var(--color-vscode-bg)', boxShadow: '0 2px 8px rgba(0,0,0,0.4)' }}
            title="Scroll to previous prompt"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <polyline points="6 15 12 9 18 15" />
            </svg>
          </button>
        )}
        {viewTab === 'chat' && showScrollToNextPrompt && (
          <button
            type="button"
            onClick={scrollToNextPrompt}
            className="absolute right-3 bottom-3 h-8 w-8 rounded-full border border-vscode-border text-vscode-text-muted hover:text-vscode-text flex items-center justify-center cursor-pointer"
            style={{ backgroundColor: 'var(--color-vscode-bg)', boxShadow: '0 2px 8px rgba(0,0,0,0.4)' }}
            title="Scroll to next prompt"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        )}
        {viewTab === 'chat' && showScrollToBottom && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute bottom-3 left-3 h-8 w-8 rounded-full border border-vscode-border text-vscode-text-muted hover:text-vscode-text flex items-center justify-center cursor-pointer"
            style={{ backgroundColor: 'var(--color-vscode-bg)', boxShadow: '0 2px 8px rgba(0,0,0,0.4)' }}
            title="Scroll to bottom"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <polyline points="6 7 12 13 18 7" />
              <line x1="5" y1="17" x2="19" y2="17" />
            </svg>
          </button>
        )}

        {contextMenu && (
          <div className="fixed inset-0 z-[60]" onPointerDown={closeContextMenu}>
            {contextMenu.type === 'modeSelect' ? (() => {
              const menuW = 210;
              const menuH = 168;
              const vv = typeof window !== 'undefined' ? window.visualViewport : null;
              const vx = vv ? vv.offsetLeft : 0;
              const vy = vv ? vv.offsetTop : 0;
              const vw = vv ? vv.width : (typeof window !== 'undefined' ? window.innerWidth : 400);
              const vh = vv ? vv.height : (typeof window !== 'undefined' ? window.innerHeight : 800);
              const left = Math.max(vx + 8, Math.min(contextMenu.x - menuW / 2, vx + vw - menuW - 8));
              const top  = Math.max(vy + 8, Math.min(contextMenu.y - menuH - 10, vy + vh - menuH - 8));
              return (
                <div
                  className="absolute rounded-xl border border-vscode-border bg-vscode-bg/95 shadow-xl p-1.5 select-none"
                  style={{ left, top, width: menuW }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <p className="px-3 pt-1 pb-1.5 text-[10px] uppercase tracking-wider text-vscode-text-muted">AI Mode</p>
                  {[
                    { id: 'agent', label: 'Agent', desc: 'Autonomous execution',   color: MODE_BUBBLE_COLORS.agent },
                    { id: 'ask',   label: 'Ask',   desc: 'Approval before actions', color: MODE_BUBBLE_COLORS.ask   },
                    { id: 'plan',  label: 'Plan',  desc: 'Show plan first',         color: MODE_BUBBLE_COLORS.plan  },
                    { id: 'cloud', label: 'Cloud', desc: 'Queue background job',    color: MODE_BUBBLE_COLORS.cloud },
                  ].map(({ id, label, desc, color }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => selectAiMode(id)}
                      className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-vscode-sidebar/60 flex items-center gap-2.5"
                      style={{ background: aiMode === id ? color.bg : 'transparent', border: 'none', outline: 'none', cursor: 'pointer' }}
                    >
                      <span
                        className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                        style={{ background: color.border }}
                      />
                      <span>
                        <span className="block text-vscode-text font-medium leading-tight">{label}</span>
                        <span className="block text-[11px] text-vscode-text-muted leading-tight mt-0.5">{desc}</span>
                      </span>
                      {aiMode === id && (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 ml-auto text-vscode-text flex-shrink-0">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              );
            })() : (() => {
              const menuW = 160;
              const menuH = contextMenu.allowRetry ? 88 : 44;
              const vv = typeof window !== 'undefined' ? window.visualViewport : null;
              const vx = vv ? vv.offsetLeft : 0;
              const vy = vv ? vv.offsetTop : 0;
              const vw = vv ? vv.width : (typeof window !== 'undefined' ? window.innerWidth : 400);
              const vh = vv ? vv.height : (typeof window !== 'undefined' ? window.innerHeight : 800);
              const left = Math.max(vx + 8, Math.min(contextMenu.x - 8, vx + vw - menuW - 8));
              const top  = Math.max(vy + 8, Math.min(contextMenu.y - 8, vy + vh - menuH - 8));
              return (
                <div
                  className="absolute min-w-[150px] rounded-xl border border-vscode-border bg-vscode-bg/95 shadow-xl p-1.5 select-none"
                  style={{ left, top }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={handleCopyFromContextMenu}
                    className="w-full text-left px-3 py-2 rounded-lg text-sm text-vscode-text hover:bg-vscode-sidebar/60"
                    style={{ background: 'transparent', border: 'none', outline: 'none', cursor: 'pointer' }}
                  >
                    Copy
                  </button>
                  {contextMenu.allowRetry && (
                    <button
                      type="button"
                      onClick={handleRetryFromContextMenu}
                      className="w-full text-left px-3 py-2 rounded-lg text-sm text-vscode-text hover:bg-vscode-sidebar/60"
                      style={{ background: 'transparent', border: 'none', outline: 'none', cursor: 'pointer' }}
                    >
                      Retry
                    </button>
                  )}
                </div>
              );
            })()}
          </div>
        )}

      </div>

      <form
        onSubmit={handleSend}
        className="border-t border-vscode-border px-2.5 sm:px-3 py-2"
        style={{ backgroundColor: 'var(--color-vscode-bg)' }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,text/*,.js,.ts,.jsx,.tsx,.py,.java,.c,.cpp,.h,.cs,.go,.rb,.php,.swift,.kt,.rs,.json,.yaml,.yml,.toml,.xml,.md,.sh,.env,.css,.html,.vue,.svelte,.graphql,.sql"
          className="hidden"
          onChange={handleFileSelect}
        />
        <div className="rounded-lg border border-vscode-border" style={{ backgroundColor: { agent: 'rgba(100,200,100,0.05)', ask: 'rgba(255,165,0,0.05)', plan: 'rgba(100,150,255,0.05)', cloud: 'rgba(0,200,255,0.06)' }[aiMode] ?? 'rgba(255,255,255,0.02)' }}>
          {totalsForHeader.files > 0 && (
            <div className="flex items-center gap-2 px-2.5 py-2 border-b border-vscode-border select-none">
            <button
              type="button"
              onClick={() => setChangesOpen((v) => !v)}
              className="flex items-center gap-2 text-xs text-vscode-text-muted hover:text-vscode-text cursor-pointer"
              style={{ background: 'none', border: 'none', outline: 'none' }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round"
                className={`w-3 h-3 transition-transform ${changesOpen ? 'rotate-90' : ''}`}>
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <span>
                {totalsForHeader.files} {fileWord} changed
                <span className="ml-2 text-green-400">+{totalsForHeader.added}</span>
                <span className="ml-1 text-red-400">-{totalsForHeader.removed}</span>
              </span>
            </button>
            <div className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleKeepAgentChanges}
                disabled={!pendingReviewPaths.length || streaming}
                className="h-8 px-3 rounded-lg border text-sm text-white disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'var(--color-vscode-accent)', borderColor: 'var(--color-vscode-accent)', outline: 'none' }}
              >
                Keep
              </button>
              <button
                type="button"
                onClick={handleUndoAgentChanges}
                disabled={!pendingReviewPaths.length || streaming || undoBusy}
                className="h-8 px-3 rounded-lg border border-vscode-border text-sm text-white disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'transparent', outline: 'none' }}
              >
                {undoBusy ? 'Undoing…' : 'Undo'}
              </button>
              <button
                type="button"
                onClick={handleOpenAllEdits}
                className="h-8 w-8 rounded-lg border border-vscode-border text-vscode-text-muted hover:text-vscode-text"
                style={{ background: 'transparent', outline: 'none' }}
                title="View all edits"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 mx-auto" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="8" y1="12" x2="12" y2="12" />
                  <line x1="10" y1="10" x2="10" y2="14" />
                  <line x1="14" y1="16" x2="17" y2="16" />
                </svg>
              </button>
            </div>
            </div>
          )}

          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-2.5 pt-2 pb-1 border-b border-vscode-border">
              {attachments.map((att) =>
                att.isImage && att.preview ? (
                  <div key={att.id} className="relative group">
                    <img
                      src={att.preview}
                      alt={att.name}
                      title={att.name}
                      className="h-14 w-14 rounded-lg object-cover border border-vscode-border"
                    />
                    <button
                      type="button"
                      onClick={() => removeAttachment(att.id)}
                      className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-vscode-bg border border-vscode-border text-vscode-text-muted hover:text-vscode-text flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Remove"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-2.5 h-2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                ) : (
                  <div key={att.id} className="relative group flex items-center gap-1 pl-2 pr-6 py-1 rounded-md border border-vscode-border bg-vscode-sidebar text-vscode-text-muted text-[11px] max-w-[160px]">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3 shrink-0" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                    </svg>
                    <span className="truncate" title={att.name}>{att.name}</span>
                    <span className="shrink-0 opacity-60">{formatFileSize(att.size)}</span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(att.id)}
                      className="absolute right-1 top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full hover:bg-vscode-border text-vscode-text-muted hover:text-vscode-text flex items-center justify-center"
                      title="Remove"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-2 h-2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                )
              )}
            </div>
          )}

          <div className="flex items-end min-h-[46px]">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={streaming}
              className="flex items-center justify-center w-8 h-8 ml-1 mb-1 shrink-0 rounded-lg text-vscode-text-muted hover:text-vscode-text hover:bg-vscode-border/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="Attach files or photos"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <textarea
              ref={composerTextareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onFocus={preventScrollOnFocus}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend(e);
                }
              }}
              placeholder="What are you gonna do?"
              disabled={streaming}
              rows={1}
                className="flex-1 resize-none bg-transparent text-vscode-text placeholder-vscode-text-muted px-[5px] py-[2px] outline-none text-sm min-h-[46px] max-h-[92px] overflow-y-auto overscroll-y-contain disabled:opacity-50 leading-relaxed -mt-px -mb-px"
              style={{ fieldSizing: 'content' }}
            />
            <div className="relative h-[48px] w-[48px] shrink-0 -mt-px -mr-px -mb-px select-none">
              {composerMetricVisibility.showChars && (
                <div className={`absolute right-0 bottom-[48px] h-[22px] w-[48px] border border-vscode-border bg-vscode-sidebar/90 text-center text-[8px] leading-[1.05] text-vscode-text-muted ${composerMetricVisibility.showWords ? 'rounded-b-lg rounded-t-none' : 'rounded-lg'}`}>
                  <div className="pt-[2px]">{composerCounts.chars}</div>
                  <div>chars</div>
                </div>
              )}
              {composerMetricVisibility.showWords && (
                <div className="absolute right-0 bottom-[70px] h-[22px] w-[48px] rounded-t-lg rounded-b-none border border-vscode-border bg-vscode-sidebar/90 text-center text-[8px] leading-[1.05] text-vscode-text-muted">
                  <div className="pt-[2px]">{composerCounts.words}</div>
                  <div>words</div>
                </div>
              )}
              <button
                type="button"
                disabled={!streaming && !input.trim() && attachments.length === 0}
                className="relative flex items-center justify-center h-[48px] w-[48px] rounded-lg border border-vscode-border text-vscode-text-muted hover:text-vscode-text disabled:opacity-40 disabled:cursor-not-allowed select-none"
                style={{
                  background: { agent: 'rgba(100,200,100,0.14)', ask: 'rgba(255,165,0,0.14)', plan: 'rgba(100,150,255,0.14)', cloud: 'rgba(0,200,255,0.14)' }[aiMode] ?? 'rgba(255,255,255,0.05)',
                  borderColor: { agent: 'rgba(100,200,100,0.5)', ask: 'rgba(255,165,0,0.5)', plan: 'rgba(100,150,255,0.5)', cloud: 'rgba(0,200,255,0.55)' }[aiMode],
                  color: { agent: '#64c864', ask: '#ffa500', plan: '#6496ff', cloud: '#00c8ff' }[aiMode],
                  outline: 'none',
                }}
                title={streaming ? 'Stop' : 'Send (hold for mode)'}
                {...buildSubmitLongPressHandlers()}
              >
                {streaming ? (
                  <>
                    <span className="inline-block w-3 h-3 rounded-sm bg-current" />
                    <span className="absolute inset-0 m-auto w-6 h-6 rounded-full border-2 border-vscode-border/70 border-t-vscode-text animate-spin pointer-events-none" />
                  </>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 mx-auto" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="19" x2="12" y2="5" />
                    <polyline points="5 12 12 5 19 12" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {reviewActionMsg && (
            <p className="px-3 pb-2 text-[11px] text-vscode-text-muted select-none">{reviewActionMsg}</p>
          )}

          {changesOpen && (
            <div className="mx-2.5 mb-2 max-h-32 overflow-y-auto overscroll-y-contain rounded border border-vscode-border bg-vscode-bg select-none">
              <div className="px-2.5 py-1 border-b border-vscode-border flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-vscode-text-muted">Changed files</span>
                <button
                  type="button"
                  onClick={fetchChangesSummary}
                  disabled={changesLoading}
                  className="text-[10px] text-vscode-text-muted hover:text-vscode-text disabled:opacity-40"
                  style={{ background: 'none', border: 'none', outline: 'none' }}
                >
                  {changesLoading ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>
              {displayFiles.length === 0 ? (
                <p className="px-2.5 py-2 text-xs text-vscode-text-muted">No local changes.</p>
              ) : (
                displayFiles.map((file) => (
                  <div key={file.path} className="px-2.5 py-1.5 text-xs border-b border-vscode-border last:border-b-0 flex items-center gap-2">
                    <span className="text-vscode-text truncate flex-1">{file.path}</span>
                    <span className="text-green-400">+{file.added || 0}</span>
                    <span className="text-red-400">-{file.removed || 0}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
