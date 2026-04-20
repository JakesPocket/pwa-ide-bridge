import { useState, useRef, useEffect, useMemo } from 'react';
import copilotIcon from '../assets/icons/providers/copilot.svg';
import codexIcon from '../assets/icons/providers/codex.svg';
import localIcon from '../assets/icons/providers/local.svg';
import { apiUrl } from '../config/server';
import { preventScrollOnFocus } from '../utils/preventScrollOnFocus';

const EVENT_POLL_INTERVAL_MS = 3000;

function providerIcon(p) {
  if (p === 'codex') return codexIcon;
  if (p === 'local') return localIcon;
  return copilotIcon;
}

function providerLabel(p) {
  if (p === 'codex') return 'Codex';
  if (p === 'local') return 'Local';
  return 'Copilot';
}

const STATUS_COLORS = {
  queued: '#eab308',
  running: '#3b82f6',
  succeeded: '#22c55e',
  failed: '#ef4444',
  cancelled: '#f97316',
};

function formatTimestamp(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function formatDuration(startIso, endIso) {
  if (!startIso) return '';
  const start = Date.parse(startIso);
  const end = endIso ? Date.parse(endIso) : Date.now();
  const ms = Math.max(0, end - start);
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainder = secs % 60;
  return `${mins}m ${remainder}s`;
}

function splitCodeBlocks(text) {
  const chunks = [];
  const re = /```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) chunks.push({ type: 'text', value: text.slice(last, m.index) });
    chunks.push({ type: 'code', lang: m[1] || '', value: (m[2] || '').replace(/\n$/, '') });
    last = re.lastIndex;
  }
  if (last < text.length) chunks.push({ type: 'text', value: text.slice(last) });
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

function ResultMarkdown({ text }) {
  if (!text) return null;
  const chunks = splitCodeBlocks(text);
  return (
    <div className="text-[13px] text-vscode-text leading-6 whitespace-pre-wrap break-words">
      {chunks.map((chunk, idx) => {
        if (chunk.type === 'code') {
          return (
            <div key={idx} className="rounded-xl border border-vscode-border bg-vscode-sidebar overflow-hidden my-2">
              <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-vscode-text-muted border-b border-vscode-border">
                {chunk.lang || 'code'}
              </div>
              <pre className="p-3 text-[12px] leading-relaxed text-vscode-text overflow-x-auto font-mono">
                <code>{chunk.value}</code>
              </pre>
            </div>
          );
        }
        return chunk.value.split('\n').map((line, li) => {
          const trimmed = line.trim();
          if (!trimmed) return <div key={`${idx}-${li}`} className="h-2" />;
          if (/^[-*]\s+/.test(trimmed)) {
            return (
              <div key={`${idx}-${li}`} className="flex items-start gap-2">
                <span className="text-vscode-text-muted">•</span>
                <span><InlineText line={trimmed.replace(/^[-*]\s+/, '')} /></span>
              </div>
            );
          }
          if (/^#{1,3}\s+/.test(trimmed)) {
            return (
              <div key={`${idx}-${li}`} className="text-vscode-text font-semibold mt-1">
                <InlineText line={trimmed.replace(/^#{1,3}\s+/, '')} />
              </div>
            );
          }
          return <div key={`${idx}-${li}`}><InlineText line={line} /></div>;
        });
      })}
    </div>
  );
}

function eventLabel(evt) {
  if (!evt) return '';
  const d = evt.data || {};
  switch (evt.type) {
    case 'job.created': return 'Task created';
    case 'job.status': return `Status → ${d.status || '?'}`;
    case 'job.completed': return 'Completed';
    case 'job.failed': return `Failed: ${d.message || 'unknown error'}`;
    case 'job.cancelled': return `Cancelled: ${d.reason || ''}`;
    case 'job.cancel_requested': return 'Cancel requested';
    case 'session.started': return 'Agent session started';
    case 'session.ended': return 'Agent session ended';
    case 'tool_call': {
      const tool = d.tool || '?';
      if (d.input?.explanation) return d.input.explanation;
      if (d.input?.command) return `${tool}: ${d.input.command.slice(0, 60)}`;
      if (d.input?.path) return `${tool}: ${d.input.path}`;
      return `Tool: ${tool}`;
    }
    case 'tool_result': return `${d.tool || 'Tool'} completed`;
    case 'delta': return 'Writing response…';
    case 'reasoning': return 'Thinking…';
    case 'message': return 'Response received';
    case 'error': return `Error: ${d.message || ''}`;
    default: return evt.type;
  }
}

function isMinorEvent(evt) {
  return evt.type === 'delta' || evt.type === 'reasoning';
}

export default function TaskDetailView({ job, groupJobs = [], onBack, onSubmitFollowUp, onCancel }) {
  const [eventsByJobId, setEventsByJobId] = useState({});
  const [showAllEvents, setShowAllEvents] = useState(false);
  const [followUpText, setFollowUpText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const cursorsRef = useRef({});
  const scrollRef = useRef(null);
  const composerRef = useRef(null);

  const allJobs = groupJobs.length > 0 ? groupJobs : (job ? [job] : []);
  const allJobIds = allJobs.map((j) => j.jobId).join(',');
  const latestJob = allJobs[allJobs.length - 1] || job;
  const anyActive = allJobs.some((j) => j.status === 'running' || j.status === 'queued');
  const allTerminal = allJobs.every((j) => ['succeeded', 'failed', 'cancelled'].includes(j.status));
  const canCancel = anyActive;
  const displayJob = allJobs.find((j) => j.status === 'running' || j.status === 'queued') || latestJob;
  const statusColor = STATUS_COLORS[displayJob?.status] || '#888';

  // Flatten events from all jobs, sorted by timestamp
  const events = useMemo(() =>
    Object.entries(eventsByJobId).flatMap(([jid, evts]) =>
      evts.map((e) => ({ ...e, _jobId: jid }))
    ).sort((a, b) => {
      const ta = a.ts ? Date.parse(a.ts) : a.id;
      const tb = b.ts ? Date.parse(b.ts) : b.id;
      return ta - tb;
    }),
    [eventsByJobId]
  );

  // Poll events for all jobs in the group
  useEffect(() => {
    setEventsByJobId({});
    cursorsRef.current = {};

    let cancelled = false;
    const jobIds = allJobIds.split(',').filter(Boolean);

    async function fetchEvents() {
      for (const jid of jobIds) {
        if (cancelled) return;
        const cursor = cursorsRef.current[jid] || 0;
        try {
          const r = await fetch(apiUrl(`/api/jobs/${encodeURIComponent(jid)}/events?since=${cursor}`));
          if (!r.ok) continue;
          const data = await r.json();
          if (Array.isArray(data.events) && data.events.length > 0) {
            setEventsByJobId((prev) => ({
              ...prev,
              [jid]: [...(prev[jid] || []), ...data.events],
            }));
            cursorsRef.current[jid] = data.nextCursor || cursor;
          }
        } catch {
          // ignore
        }
      }
    }

    fetchEvents();
    const id = setInterval(fetchEvents, EVENT_POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [allJobIds]);

  // Auto-scroll to bottom when events arrive and user is near bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [events]);

  async function handleFollowUp(e) {
    e.preventDefault();
    const text = followUpText.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    try {
      await onSubmitFollowUp(text, job);
      setFollowUpText('');
    } finally {
      setSubmitting(false);
    }
  }

  // Filter minor events unless user opts in
  const visibleEvents = showAllEvents
    ? events
    : events.filter((evt) => !isMinorEvent(evt));

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2.5 border-b border-vscode-border">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center justify-center w-8 h-8 rounded-lg text-vscode-text-muted hover:text-vscode-text hover:bg-vscode-border/40"
          style={{ background: 'none', border: 'none', outline: 'none' }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span
          className={`inline-block w-2.5 h-2.5 rounded-full shrink-0${anyActive ? ' animate-pulse' : ''}`}
          style={{ background: statusColor }}
        />
        <span className="text-sm font-medium text-vscode-text capitalize">{displayJob?.status || 'Unknown'}</span>
        <span className="opacity-40 text-xs">·</span>
        <img src={providerIcon(job?.provider)} alt="" className="w-4 h-4 object-contain" />
        <span className="text-xs text-vscode-text-muted">{providerLabel(job?.provider)}</span>
        {allJobs.length > 1 && (
          <span className="text-[10px] text-vscode-text-muted px-1.5 py-0.5 rounded bg-vscode-border/40">
            {allJobs.length} turns
          </span>
        )}
        {job?.startedAt && (
          <span className="ml-auto text-[11px] text-vscode-text-muted shrink-0">
            {formatDuration(job.startedAt, latestJob?.finishedAt || latestJob?.updatedAt)}
          </span>
        )}
      </div>

      {/* Scrollable content */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain p-3 flex flex-col gap-3">
        {/* Thread: prompt + result for each job in the group */}
        {allJobs.map((j, idx) => {
          // Strip the "[Follow-up on task XYZ]" prefix for cleaner display
          const rawMsg = j.message || '';
          const displayMsg = idx > 0 ? rawMsg.replace(/^\[Follow-up on task [^\]]*\]\s*\n*/i, '') : rawMsg;
          const jobStatusColor = STATUS_COLORS[j.status] || '#888';
          return (
          <div key={j.jobId} className="flex flex-col gap-2">
            {/* Separator between turns */}
            {idx > 0 && (
              <div className="flex items-center gap-2 pt-1">
                <div className="flex-1 border-t border-vscode-border/50" />
                <span className="text-[9px] uppercase tracking-wider text-vscode-text-muted/60">follow-up #{idx}</span>
                <div className="flex-1 border-t border-vscode-border/50" />
              </div>
            )}

            {/* Prompt */}
            <div className={`rounded-lg border px-3 py-2 ${idx === 0 ? 'border-vscode-border bg-vscode-sidebar/30' : 'border-vscode-accent/30 bg-vscode-accent/5'}`}>
              <div className="flex items-center gap-1.5 mb-1">
                <span
                  className={`inline-block w-1.5 h-1.5 rounded-full shrink-0${j.status === 'running' || j.status === 'queued' ? ' animate-pulse' : ''}`}
                  style={{ background: jobStatusColor }}
                />
                <span className="text-[10px] uppercase tracking-wider text-vscode-text-muted">
                  {idx === 0 ? 'Prompt' : j.jobId}
                </span>
              </div>
              <div className="text-sm text-vscode-text whitespace-pre-wrap break-words">{displayMsg || '(empty)'}</div>
            </div>

            {/* Result */}
            {['succeeded', 'failed', 'cancelled'].includes(j.status) && j.resultText ? (
              <div className="rounded-lg border border-vscode-border bg-vscode-bg/60 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-vscode-text-muted mb-1">Result</div>
                <ResultMarkdown text={j.resultText} />
              </div>
            ) : null}

            {/* Error */}
            {j.error?.message ? (
              <div className="rounded-lg border border-red-900/50 bg-red-900/20 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-red-400 mb-1">Error</div>
                <div className="text-sm text-red-400 break-words">{j.error.message}</div>
              </div>
            ) : null}
          </div>
          );
        })}

        {/* Event timeline */}
        <div className="rounded-lg border border-vscode-border bg-vscode-bg/40 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-vscode-border">
            <span className="text-[10px] uppercase tracking-wider text-vscode-text-muted">
              Activity ({events.length} event{events.length !== 1 ? 's' : ''})
            </span>
            {events.some(isMinorEvent) && (
              <button
                type="button"
                onClick={() => setShowAllEvents((v) => !v)}
                className="text-[10px] text-vscode-accent hover:underline"
                style={{ background: 'none', border: 'none', outline: 'none', cursor: 'pointer' }}
              >
                {showAllEvents ? 'Hide minor' : 'Show all'}
              </button>
            )}
          </div>
          {visibleEvents.length === 0 ? (
            <div className="px-3 py-2 text-xs text-vscode-text-muted">
              {anyActive ? 'Waiting for events…' : 'No events recorded.'}
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto overscroll-y-contain divide-y divide-vscode-border/30">
              {visibleEvents.map((evt) => (
                <div key={evt.id} className="flex items-start gap-2 px-3 py-1.5">
                  <span className="text-[10px] text-vscode-text-muted shrink-0 w-12 text-right pt-0.5">
                    {formatTimestamp(evt.ts)}
                  </span>
                  <span
                    className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${
                      evt.type.startsWith('job.') ? 'bg-vscode-accent' : 'bg-vscode-text-muted/50'
                    }`}
                  />
                  <span className="text-[11px] text-vscode-text-muted flex-1 min-w-0 break-words">
                    {eventLabel(evt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom bar: cancel or follow-up composer */}
      <div className="shrink-0 border-t border-vscode-border px-3 py-2" style={{ backgroundColor: 'var(--color-vscode-bg)' }}>
        {canCancel && (
          <div className="flex items-center gap-2 mb-2">
            <button
              type="button"
              onClick={() => onCancel(displayJob.jobId)}
              className="px-3 py-1.5 rounded-lg border border-vscode-border text-xs text-vscode-text hover:bg-vscode-sidebar/60"
              style={{ background: 'transparent', outline: 'none' }}
            >
              Cancel Task
            </button>
            {anyActive && (
              <span className="text-[11px] text-vscode-text-muted animate-pulse">Running…</span>
            )}
          </div>
        )}
        <form onSubmit={handleFollowUp} className="flex items-end gap-2">
          <textarea
            ref={composerRef}
            value={followUpText}
            onChange={(e) => setFollowUpText(e.target.value)}
            onFocus={preventScrollOnFocus}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleFollowUp(e);
              }
            }}
            placeholder="Follow up on this task…"
            disabled={submitting}
            rows={1}
            className="flex-1 min-h-[40px] max-h-[80px] resize-none rounded-lg border border-vscode-border bg-transparent text-vscode-text placeholder-vscode-text-muted px-3 py-2 outline-none text-[16px] sm:text-sm disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!followUpText.trim() || submitting}
            className="shrink-0 w-10 h-10 flex items-center justify-center rounded-lg border border-vscode-border text-vscode-accent disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'transparent', outline: 'none' }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}
