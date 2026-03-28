import { useState, useRef, useEffect, useCallback } from 'react';
import { apiUrl } from './config/server';
import { readJson, writeJson, readText, writeText } from './utils/persist';

const CHAT_MESSAGES_KEY = 'pocketide.chat.messages.v1';
const CHAT_INPUT_KEY = 'pocketide.chat.input.v1';

function readInitialMessages() {
  const fallback = [
    { role: 'agent', text: 'Hello! I am your autonomous coding agent. How can I help?' },
  ];
  const stored = readJson(CHAT_MESSAGES_KEY, null);
  if (!Array.isArray(stored) || stored.length === 0) return fallback;

  const next = stored
    .filter((msg) => msg && typeof msg === 'object')
    .map((msg) => {
      if (msg.role === 'tool') {
        return {
          role: 'tool',
          tool: typeof msg.tool === 'string' ? msg.tool : 'unknown',
          done: Boolean(msg.done),
          input: msg.input ?? null,
          output: msg.output ?? null,
        };
      }
      return {
        role: typeof msg.role === 'string' ? msg.role : 'agent',
        text: typeof msg.text === 'string' ? msg.text : '',
      };
    })
    .filter((msg) => ['user', 'agent', 'reasoning', 'error', 'tool'].includes(msg.role));

  return next.length > 0 ? next : fallback;
}

// ── Message types ──────────────────────────────────────────────────────────
// { role: 'user',   text: string }
// { role: 'agent',  text: string, streaming?: bool }
// { role: 'tool',   tool: string, done?: bool, input?: unknown, output?: unknown }
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

function UserBubble({ text }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-tr-sm text-sm
                      bg-vscode-accent text-white break-words leading-relaxed">
        {text}
      </div>
    </div>
  );
}

function AgentBubble({ text, streaming }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-tl-sm text-sm
                      bg-vscode-sidebar text-vscode-text break-words leading-relaxed whitespace-pre-wrap">
        {text}
        {streaming && (
          <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-vscode-accent align-middle
                           rounded-sm animate-pulse" />
        )}
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
      <div className="max-w-[90%] rounded-xl text-xs text-vscode-text-muted border border-vscode-border bg-vscode-bg overflow-hidden">
        <button
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-start gap-2 px-3 py-2 text-left"
          style={{ background: 'none', border: 'none', outline: 'none' }}
        >
          {!done ? (
            <svg className="w-3.5 h-3.5 shrink-0 animate-spin text-vscode-accent mt-0.5"
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 12a9 9 0 11-6.22-8.56" strokeLinecap="round" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5 shrink-0 text-green-500 mt-0.5"
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-vscode-text">{summary}</div>
            <div className="mt-0.5 text-[11px] text-vscode-text-muted">
              {done ? 'Finished' : 'Running'} • {tool}
            </div>
          </div>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"
            className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {open && (
          <div className="px-3 pb-3 border-t border-vscode-border/60 bg-vscode-sidebar/40">
            {inputText && (
              <div className="pt-2">
                <div className="text-[10px] uppercase tracking-wider text-vscode-text-muted mb-1">Input</div>
                <pre className="whitespace-pre-wrap break-words text-[11px] text-vscode-text-muted leading-relaxed font-mono">{inputText}</pre>
              </div>
            )}
            {outputText && (
              <div className="pt-2">
                <div className="text-[10px] uppercase tracking-wider text-vscode-text-muted mb-1">Result</div>
                <pre className="whitespace-pre-wrap break-words text-[11px] text-vscode-text-muted leading-relaxed font-mono">{outputText}</pre>
              </div>
            )}
            {!inputText && !outputText && (
              <div className="pt-2 text-[11px] text-vscode-text-muted">No additional details for this step.</div>
            )}
          </div>
        )}
      </div>
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

export default function Chat() {
  const [messages, setMessages] = useState(() => readInitialMessages());
  const [reasoning, setReasoning] = useState('');
  const [input, setInput] = useState(() => readText(CHAT_INPUT_KEY, ''));
  const [streaming, setStreaming] = useState(false);
  const [changesSummary, setChangesSummary] = useState({ totals: { files: 0, added: 0, removed: 0 }, files: [] });
  const [changesOpen, setChangesOpen] = useState(false);
  const [changesLoading, setChangesLoading] = useState(false);
  const [pendingReviewPaths, setPendingReviewPaths] = useState([]);
  const [reviewActionMsg, setReviewActionMsg] = useState('');
  const [undoBusy, setUndoBusy] = useState(false);
  const bottomRef = useRef(null);
  const abortRef = useRef(null);
  const preRequestSnapshotRef = useRef(new Map());

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
      map.set(f.path, [f.status, f.added || 0, f.removed || 0, f.staged ? 1 : 0, f.unstaged ? 1 : 0, f.untracked ? 1 : 0].join('|'));
    }
    return map;
  }

  async function handleUndoAgentChanges() {
    if (!pendingReviewPaths.length || undoBusy) return;
    setUndoBusy(true);
    setReviewActionMsg('');
    try {
      const r = await fetch(apiUrl('/api/git/discard-changes'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: pendingReviewPaths }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `Failed (${r.status})`);
      setPendingReviewPaths([]);
      setReviewActionMsg(`Undid ${data.reverted || 0} file change(s).`);
      await fetchChangesSummary();
    } catch (e) {
      setReviewActionMsg(e.message);
    } finally {
      setUndoBusy(false);
    }
  }

  function handleKeepAgentChanges() {
    if (!pendingReviewPaths.length) return;
    setPendingReviewPaths([]);
    setReviewActionMsg('Kept latest agent changes.');
  }

  useEffect(() => {
    fetchChangesSummary();
    const timer = setInterval(fetchChangesSummary, 15000);
    return () => clearInterval(timer);
  }, [fetchChangesSummary]);

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const safeMessages = messages
      .filter((msg) => msg && typeof msg === 'object')
      .map((msg) => {
        if (msg.role === 'tool') {
          return { role: 'tool', tool: msg.tool, done: msg.done, input: msg.input ?? null, output: msg.output ?? null };
        }
        return { role: msg.role, text: msg.text };
      });
    writeJson(CHAT_MESSAGES_KEY, safeMessages);
  }, [messages]);

  useEffect(() => {
    writeText(CHAT_INPUT_KEY, input);
  }, [input]);

  async function handleSend(e) {
    e.preventDefault();
    const prompt = input.trim();
    if (!prompt || streaming) return;

    preRequestSnapshotRef.current = signatureByPath(changesSummary);
    setReviewActionMsg('');

    setInput('');
    setReasoning('');
    setStreaming(true);

    // Append user message
    setMessages((prev) => [...prev, { role: 'user', text: prompt }]);

    // Reserve a slot for the streaming agent reply
    const agentIdx = messages.length + 1; // after user msg
    setMessages((prev) => [...prev, { role: 'agent', text: '', streaming: true }]);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch(apiUrl('/api/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: prompt }),
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

          switch (event.type) {
            case 'reasoning':
              reasoningAcc += event.content;
              setReasoning(reasoningAcc);
              break;

            case 'delta':
              setMessages((prev) => {
                const next = [...prev];
                const target = next[agentIdx];
                if (target?.role === 'agent') {
                  next[agentIdx] = { ...target, text: target.text + event.content, streaming: true };
                }
                return next;
              });
              break;

            case 'tool_call':
              setMessages((prev) => [
                ...prev,
                { role: 'tool', tool: event.tool, input: event.input ?? null, output: null, done: false },
              ]);
              break;

            case 'tool_result':
              setMessages((prev) => {
                const next = [...prev];
                // Mark the last matching tool bubble as done
                for (let i = next.length - 1; i >= 0; i--) {
                  if (next[i].role === 'tool' && next[i].tool === event.tool && !next[i].done) {
                    next[i] = { ...next[i], done: true, output: event.output ?? null };
                    break;
                  }
                }
                return next;
              });
              break;

            case 'message':
              // Replace streaming placeholder with final complete text
              setMessages((prev) => {
                const next = [...prev];
                const target = next[agentIdx];
                if (target?.role === 'agent') {
                  next[agentIdx] = { role: 'agent', text: event.content, streaming: false };
                }
                return next;
              });
              break;

            case 'error':
              sawServerError = true;
              setMessages((prev) => [
                ...prev,
                { role: 'error', text: event.message },
              ]);
              break;

            case 'done':
              break;
          }
        }
      }

      // If reasoning was accumulated, inject it just before the agent bubble
      if (reasoningAcc) {
        setMessages((prev) => {
          const next = [...prev];
          next.splice(agentIdx, 0, { role: 'reasoning', text: reasoningAcc });
          return next;
        });
      }

      // Finalise: strip streaming flag
      setMessages((prev) => {
        const next = [...prev];
        const finalIdx = agentIdx + (reasoningAcc ? 1 : 0);
        const target = next[finalIdx];
        if (target?.role === 'agent') {
          const text = typeof target.text === 'string' ? target.text.trim() : '';
          if (!text) {
            if (sawServerError) {
              next.splice(finalIdx, 1);
            } else {
              next[finalIdx] = {
                role: 'error',
                text: 'No response content was returned by the agent. Check backend auth/token setup.',
              };
            }
          } else {
            next[finalIdx] = { ...target, streaming: false };
          }
        }
        return next;
      });

    } catch (err) {
      if (err.name !== 'AbortError') {
        setMessages((prev) => [
          ...prev.filter((m) => !(m.role === 'agent' && m.text === '' && m.streaming)),
          { role: 'error', text: err.message },
        ]);
      }
    } finally {
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
      setPendingReviewPaths(touched);
    }
  }

  function handleAbort() {
    abortRef.current?.abort();
    setStreaming(false);
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === 'agent' && last.streaming) {
        next[next.length - 1] = { ...last, streaming: false };
      }
      return next;
    });
  }

  const reviewFileSet = new Set(pendingReviewPaths);
  const displayFiles = reviewFileSet.size
    ? changesSummary.files.filter((file) => reviewFileSet.has(file.path))
    : changesSummary.files;

  return (
    <div className="flex flex-col h-full">
      {/* Message list */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        {messages.map((msg, idx) => {
          if (msg.role === 'user')      return <UserBubble    key={idx} text={msg.text} />;
          if (msg.role === 'agent')     return <AgentBubble   key={idx} text={msg.text} streaming={msg.streaming} />;
          if (msg.role === 'tool')      return <ToolCallBubble key={idx} tool={msg.tool} done={msg.done} input={msg.input} output={msg.output} />;
          if (msg.role === 'reasoning') return <ReasoningBubble key={idx} text={msg.text} />;
          if (msg.role === 'error')     return (
            <div key={idx} className="flex justify-start">
              <div className="px-4 py-2.5 rounded-2xl text-sm bg-red-900/30 text-red-400
                              border border-red-900/50 max-w-[85%] break-words">
                {msg.text}
              </div>
            </div>
          );
          return null;
        })}
        <div ref={bottomRef} />
      </div>

      {/* Changed files strip */}
      <div className="border-t border-vscode-border px-3 py-2" style={{ backgroundColor: 'var(--color-vscode-sidebar)' }}>
        <div className="flex items-center gap-2">
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
              Files changed: {changesSummary.totals.files}
              <span className="ml-1 text-green-400">+{changesSummary.totals.added}</span>
              <span className="ml-1 text-red-400">-{changesSummary.totals.removed}</span>
            </span>
          </button>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-vscode-text-muted/70">
              Review
            </span>
          <button
            type="button"
            onClick={handleKeepAgentChanges}
            disabled={!pendingReviewPaths.length || streaming}
            title="Keep latest agent changes"
            className="h-6 px-2 rounded border border-vscode-border text-[11px]
                       text-vscode-text-muted hover:text-vscode-text hover:bg-vscode-sidebar-hover
                       disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'transparent', outline: 'none' }}
          >
            Keep
          </button>
          <button
            type="button"
            onClick={handleUndoAgentChanges}
            disabled={!pendingReviewPaths.length || streaming || undoBusy}
            title="Undo latest agent changes"
            className="h-6 px-2 rounded border border-vscode-border text-[11px]
                       text-vscode-text-muted hover:text-vscode-text hover:bg-vscode-sidebar-hover
                       disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'transparent', outline: 'none' }}
          >
            {undoBusy ? 'Undoing…' : 'Undo'}
          </button>
          </div>
        </div>

        {reviewActionMsg && (
          <p className="mt-1 text-[11px] text-vscode-text-muted">{reviewActionMsg}</p>
        )}

        {changesOpen && (
          <div className="mt-2 max-h-36 overflow-y-auto rounded border border-vscode-border bg-vscode-bg">
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

      {/* Input bar */}
      <form
        onSubmit={handleSend}
        className="flex items-end gap-2 border-t border-vscode-border p-3"
        style={{ backgroundColor: 'var(--color-vscode-nav)' }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend(e);
            }
          }}
          placeholder="What are you gonna do?"
          disabled={streaming}
          rows={1}
          className="flex-1 resize-none bg-vscode-sidebar text-vscode-text
                     placeholder-vscode-text-muted px-3 py-2.5 rounded-2xl
                     border border-vscode-border outline-none text-sm
                     min-h-[44px] max-h-[120px] overflow-y-auto
                     disabled:opacity-50 leading-relaxed"
          style={{ fieldSizing: 'content' }}
        />
        {streaming ? (
          <button
            type="button"
            onClick={handleAbort}
            className="bg-red-600 text-white px-4 py-2.5 rounded-2xl text-sm font-medium
                       min-h-[44px] min-w-[44px] cursor-pointer border-none shrink-0"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="bg-vscode-accent text-white px-4 py-2.5 rounded-2xl text-sm font-medium
                       min-h-[44px] min-w-[44px] cursor-pointer border-none shrink-0
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Send
          </button>
        )}
      </form>
    </div>
  );
}
