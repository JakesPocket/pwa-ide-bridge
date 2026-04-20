import copilotIcon from '../assets/icons/providers/copilot.svg';
import codexIcon from '../assets/icons/providers/codex.svg';
import localIcon from '../assets/icons/providers/local.svg';

const STATUS_COLORS = {
  queued: '#eab308',
  running: '#3b82f6',
  succeeded: '#22c55e',
  failed: '#ef4444',
  cancelled: '#f97316',
};

const STATUS_LABELS = {
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const MODE_LABELS = {
  agent: 'Agent',
  ask: 'Ask',
  plan: 'Plan',
};

function providerIcon(provider) {
  if (provider === 'codex') return codexIcon;
  if (provider === 'local') return localIcon;
  return copilotIcon;
}

function providerLabel(provider) {
  if (provider === 'codex') return 'Codex';
  if (provider === 'local') return 'Local';
  return 'Copilot';
}

function relativeTime(isoString) {
  if (!isoString) return '';
  const diff = Date.now() - Date.parse(isoString);
  if (diff < 0) return 'just now';
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function latestEventText(events) {
  if (!Array.isArray(events) || events.length === 0) return '';
  for (let i = events.length - 1; i >= 0; i--) {
    const evt = events[i];
    const d = evt?.data;
    if (!d) continue;
    if (evt.type === 'tool_call' && d.tool) {
      const tool = d.tool;
      const input = d.input;
      if (tool === 'apply_patch' || tool === 'create_file') {
        const file = input?.explanation || input?.path || '';
        return file ? `Editing ${file}` : `Running ${tool}`;
      }
      if (tool === 'bash') {
        const cmd = typeof input === 'string' ? input : input?.command || '';
        return cmd ? `Running: ${cmd.slice(0, 40)}${cmd.length > 40 ? '…' : ''}` : 'Running command';
      }
      if (tool === 'read_file') return `Reading ${input?.path || 'file'}`;
      if (tool === 'grep_search' || tool === 'file_search' || tool === 'semantic_search') return 'Searching workspace';
      if (input?.explanation) return input.explanation.slice(0, 50);
      return `Running ${tool}`;
    }
    if (evt.type === 'delta' && typeof d.content === 'string' && d.content.trim()) {
      return 'Writing response…';
    }
    if (evt.type === 'reasoning') return 'Thinking…';
  }
  return '';
}

export default function TaskCard({ job, groupStatus, followUpCount, events, onClick }) {
  const effectiveStatus = groupStatus || job.status;
  const color = STATUS_COLORS[effectiveStatus] || STATUS_COLORS.queued;
  const label = STATUS_LABELS[effectiveStatus] || effectiveStatus;
  const provider = job.provider || 'copilot';
  const mode = MODE_LABELS[job.aiMode] || 'Agent';
  const isRunning = effectiveStatus === 'running' || effectiveStatus === 'queued';
  const progressText = isRunning ? latestEventText(events) : '';
  const time = relativeTime(job._groupUpdatedAt || job.updatedAt || job.createdAt);

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-xl border border-vscode-border px-3 py-2.5 active:bg-vscode-sidebar/60 transition-colors"
      style={{ outline: 'none', backgroundColor: '#181818' }}
    >
      {/* Line 1: status · provider · mode · jobId · time */}
      <div className="flex items-center gap-1.5 text-[11px] text-vscode-text-muted leading-none">
        <span
          className={`inline-block w-2 h-2 rounded-full shrink-0${isRunning ? ' animate-pulse' : ''}`}
          style={{ background: color }}
        />
        <span style={{ color }}>{label}</span>
        <span className="opacity-40">·</span>
        <img src={providerIcon(provider)} alt="" className="w-3.5 h-3.5 object-contain" />
        <span>{providerLabel(provider)}</span>
        <span className="opacity-40">·</span>
        <span>{mode}</span>
        <span className="opacity-40">·</span>
        <span className="font-mono opacity-60">{job.jobId}</span>
        <span className="ml-auto shrink-0">{time}</span>
      </div>

      {/* Line 2: prompt text */}
      <div className="mt-1.5 text-sm text-vscode-text truncate leading-snug">
        {job.message || '(no prompt)'}
      </div>

      {/* Line 3: progress + follow-up count */}
      <div className="mt-1 flex items-center gap-2 text-[11px] text-vscode-text-muted leading-none min-h-[14px]">
        {progressText && (
          <span className="truncate flex-1 min-w-0">{progressText}</span>
        )}
        {!progressText && <span className="flex-1" />}
        {followUpCount > 0 && (
          <span className="shrink-0 px-1.5 py-0.5 rounded bg-vscode-border/40 text-[10px]">
            +{followUpCount} follow-up{followUpCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>
    </button>
  );
}
