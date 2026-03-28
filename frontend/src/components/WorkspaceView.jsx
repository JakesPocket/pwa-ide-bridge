import { useState, useEffect, useCallback } from 'react';
import { apiUrl } from '../config/server';
import { readText, writeText } from '../utils/persist';

const EXTENSIONS_TAB_KEY = 'pocketide.extensions.activeSubTab.v1';

function IconFolder({ open }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round"
      className="w-4 h-4 shrink-0 text-yellow-400" aria-hidden="true">
      {open
        ? <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
        : <>
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
          </>
      }
    </svg>
  );
}

function IconFileSmall() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round"
      className="w-4 h-4 shrink-0 text-vscode-text-muted" aria-hidden="true">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function IconChevron({ open }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round"
      className={`w-3 h-3 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
      aria-hidden="true">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

/** Recursive file tree node */
function FileNode({ node, depth = 0, onOpenFile }) {
  const [expanded, setExpanded] = useState(depth === 0);
  const indent = depth * 12 + 12;

  if (node.type === 'directory') {
    return (
      <div>
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{ paddingLeft: indent, background: 'none', border: 'none', outline: 'none' }}
          className="w-full flex items-center gap-1.5 h-[36px] min-h-[36px] text-vscode-text
                     hover:bg-vscode-sidebar-hover cursor-pointer transition-colors"
        >
          <IconChevron open={expanded} />
          <IconFolder open={expanded} />
          <span className="text-sm truncate">{node.name}</span>
        </button>
        {expanded && node.children?.map((child) => (
          <FileNode key={child.path} node={child} depth={depth + 1} onOpenFile={onOpenFile} />
        ))}
      </div>
    );
  }

  return (
    <button
      onClick={() => onOpenFile({ path: node.path, name: node.name })}
      style={{ paddingLeft: indent + 16, background: 'none', border: 'none', outline: 'none' }}
      className="w-full flex items-center gap-2 h-[44px] min-h-[44px] text-vscode-text
                 hover:bg-vscode-sidebar-hover cursor-pointer transition-colors"
    >
      <IconFileSmall />
      <span className="text-sm truncate">{node.name}</span>
    </button>
  );
}

const STATUS_LABEL = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', U: 'unmerged', '?': 'untracked' };
const STATUS_COLOR = { M: 'text-yellow-400', A: 'text-green-400', D: 'text-red-400', R: 'text-blue-400', C: 'text-blue-400', U: 'text-red-400', '?': 'text-vscode-text-muted' };

function GitFileBadge({ status }) {
  const color = STATUS_COLOR[status] || 'text-vscode-text-muted';
  return <span className={`text-[10px] font-bold uppercase ${color} shrink-0`}>{STATUS_LABEL[status] || status}</span>;
}

function GitSection({ title, files, action, actionLabel, busy }) {
  if (!files.length) return null;
  return (
    <div className="mb-1">
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-vscode-text-muted">
          {title} <span className="font-normal normal-case tracking-normal opacity-70">({files.length})</span>
        </span>
        {action && (
          <button
            onClick={action}
            disabled={busy}
            className="text-[11px] text-vscode-text-muted hover:text-vscode-text cursor-pointer disabled:opacity-40"
            style={{ background: 'none', border: 'none', outline: 'none' }}
          >
            {actionLabel}
          </button>
        )}
      </div>
      {files.map((f) => (
        <div
          key={f.path}
          className="flex items-center justify-between px-3 h-[40px] min-h-[40px]
                     hover:bg-vscode-sidebar-hover transition-colors gap-2"
        >
          <span className="text-sm truncate text-vscode-text flex-1 min-w-0">
            {f.path.split('/').pop()}
          </span>
          <GitFileBadge status={f.status} />
        </div>
      ))}
    </div>
  );
}

function GitView() {
  const [gitStatus, setGitStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [commitMsg, setCommitMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState('');

  const fetchStatus = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(apiUrl('/api/git/status'))
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((data) => setGitStatus(data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  async function gitAction(endpoint, body = {}) {
    setBusy(true);
    setActionMsg('');
    try {
      const r = await fetch(apiUrl(endpoint), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setActionMsg(data.error || `Failed (${r.status})`);
      } else {
        if (data.output) setActionMsg(data.output);
        fetchStatus();
      }
    } catch (e) {
      setActionMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleStageAll() { await gitAction('/api/git/stage', { all: true }); }
  async function handleUnstageAll() { await gitAction('/api/git/unstage', { all: true }); }
  async function handleCommit() {
    if (!commitMsg.trim()) return;
    await gitAction('/api/git/commit', { message: commitMsg });
    setCommitMsg('');
  }
  async function handlePush() { await gitAction('/api/git/push'); }
  async function handlePull() { await gitAction('/api/git/pull'); }

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-4 text-vscode-text-muted text-sm">
        <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12a9 9 0 11-6.22-8.56" strokeLinecap="round" />
        </svg>
        Loading…
      </div>
    );
  }

  if (error) {
    return <p className="px-3 py-4 text-sm text-red-400">Error: {error}</p>;
  }

  if (!gitStatus?.branch) {
    return (
      <div className="px-3 py-4 text-sm text-vscode-text-muted">
        Not a git repository.
      </div>
    );
  }

  const { repoName, branch, ahead, behind, staged, unstaged, untracked } = gitStatus;
  const hasChanges = staged.length + unstaged.length + untracked.length > 0;
  const canCommit = staged.length > 0 && commitMsg.trim().length > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Branch row */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-vscode-border shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0 text-vscode-text-muted">
            <line x1="6" y1="3" x2="6" y2="15" />
            <circle cx="18" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <path d="M18 9a9 9 0 01-9 9" />
          </svg>
          {repoName && (
            <>
              <span className="text-sm text-vscode-text-muted truncate shrink-0">{repoName}</span>
              <span className="text-vscode-text-muted opacity-40 shrink-0">/</span>
            </>
          )}
          <span className="text-sm text-vscode-text truncate">{branch}</span>
          {ahead > 0 && <span className="text-[11px] text-green-400 shrink-0">↑{ahead}</span>}
          {behind > 0 && <span className="text-[11px] text-yellow-400 shrink-0">↓{behind}</span>}
        </div>
        <button
          onClick={fetchStatus}
          disabled={busy}
          title="Refresh"
          style={{ background: 'none', border: 'none', outline: 'none' }}
          className="text-vscode-text-muted hover:text-vscode-text cursor-pointer p-1 disabled:opacity-40 shrink-0"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
          </svg>
        </button>
      </div>

      {/* Scrollable changes + actions */}
      <div className="flex-1 overflow-y-auto">
        {!hasChanges && (
          <p className="px-3 py-4 text-sm text-vscode-text-muted">No changes.</p>
        )}

        <GitSection
          title="Staged"
          files={staged}
          action={staged.length ? handleUnstageAll : null}
          actionLabel="Unstage all"
          busy={busy}
        />
        <GitSection
          title="Changes"
          files={unstaged}
          action={unstaged.length ? handleStageAll : null}
          actionLabel="Stage all"
          busy={busy}
        />
        <GitSection
          title="Untracked"
          files={untracked}
          action={untracked.length ? handleStageAll : null}
          actionLabel="Stage all"
          busy={busy}
        />

        {/* Commit area */}
        {staged.length > 0 && (
          <div className="px-3 pt-3 pb-2 border-t border-vscode-border mt-1">
            <textarea
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              placeholder="Commit message…"
              rows={3}
              className="w-full rounded text-sm px-2 py-1.5 resize-none
                         bg-vscode-bg border border-vscode-border
                         text-vscode-text placeholder-vscode-text-muted
                         focus:outline-none focus:border-vscode-accent"
            />
            <button
              onClick={handleCommit}
              disabled={!canCommit || busy}
              className={[
                'mt-2 w-full py-2 rounded text-sm font-medium transition-colors',
                canCommit && !busy
                  ? 'bg-vscode-accent text-white cursor-pointer'
                  : 'bg-vscode-sidebar border border-vscode-border text-vscode-text-muted opacity-50 cursor-not-allowed',
              ].join(' ')}
              style={{ border: 'none', outline: 'none' }}
            >
              {busy ? 'Working…' : 'Commit'}
            </button>
          </div>
        )}

        {/* Push / Pull */}
        <div className="flex gap-2 px-3 pt-2 pb-3">
          <button
            onClick={handlePull}
            disabled={busy}
            className="flex-1 py-2 rounded text-sm border border-vscode-border
                       text-vscode-text hover:bg-vscode-sidebar-hover
                       cursor-pointer transition-colors disabled:opacity-40"
            style={{ background: 'transparent', outline: 'none' }}
          >
            Pull
          </button>
          <button
            onClick={handlePush}
            disabled={busy}
            className="flex-1 py-2 rounded text-sm border border-vscode-border
                       text-vscode-text hover:bg-vscode-sidebar-hover
                       cursor-pointer transition-colors disabled:opacity-40"
            style={{ background: 'transparent', outline: 'none' }}
          >
            Push
          </button>
        </div>

        {actionMsg && (
          <p className="px-3 pb-3 text-[11px] text-vscode-text-muted whitespace-pre-wrap break-words">
            {actionMsg}
          </p>
        )}
      </div>
    </div>
  );
}

const SUB_TABS = [
  { id: 'file-explorer', label: 'Files' },
  { id: 'source-control', label: 'Git' },
];

export default function WorkspaceView({ onOpenFile }) {
  const [activeSubTab, setActiveSubTab] = useState(() => {
    const stored = readText(EXTENSIONS_TAB_KEY, 'file-explorer');
    return SUB_TABS.some((tab) => tab.id === stored) ? stored : 'file-explorer';
  });
  const [fileTree, setFileTree] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    writeText(EXTENSIONS_TAB_KEY, activeSubTab);
  }, [activeSubTab]);

  useEffect(() => {
    if (activeSubTab !== 'file-explorer') return;
    setLoading(true);
    setError(null);
    fetch(apiUrl('/api/files'))
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json();
      })
      .then((data) => setFileTree(data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [activeSubTab]);

  return (
    <div className="flex flex-col h-full">
      {/* Sub-tab bar */}
      <div
        className="flex shrink-0 border-b border-vscode-border"
        style={{ backgroundColor: 'var(--color-vscode-sidebar)' }}
      >
        {SUB_TABS.map((tab) => {
          const isActive = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              style={{ background: 'transparent', border: 'none', outline: 'none' }}
              className={[
                'flex-1 py-3 text-sm font-medium transition-colors cursor-pointer',
                'min-h-[44px]',
                isActive
                  ? 'text-white border-b-2 border-vscode-accent'
                  : 'text-vscode-text-muted hover:text-vscode-text',
              ].join(' ')}
              aria-current={isActive ? 'true' : undefined}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeSubTab === 'file-explorer' && (
          <>
            <div className="px-3 py-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-vscode-text-muted">
                Workspace
              </span>
              <button
                onClick={() => {
                  setFileTree(null);
                  setLoading(true);
                  fetch(apiUrl('/api/files'))
                    .then((r) => r.json())
                    .then(setFileTree)
                    .catch((e) => setError(e.message))
                    .finally(() => setLoading(false));
                }}
                title="Refresh"
                style={{ background: 'none', border: 'none', outline: 'none' }}
                className="text-vscode-text-muted hover:text-vscode-text cursor-pointer p-1"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5" aria-hidden="true">
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
                </svg>
              </button>
            </div>

            {loading && (
              <div className="flex items-center gap-2 px-3 py-4 text-vscode-text-muted text-sm">
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 11-6.22-8.56" strokeLinecap="round" />
                </svg>
                Loading…
              </div>
            )}

            {error && (
              <p className="px-3 py-4 text-sm text-red-400">
                Error: {error}
              </p>
            )}

            {!loading && !error && fileTree && (
              <FileNode node={fileTree} depth={0} onOpenFile={onOpenFile} />
            )}
          </>
        )}

        {activeSubTab === 'source-control' && <GitView />}
      </div>
    </div>
  );
}
