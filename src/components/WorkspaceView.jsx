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

const FILE_TYPE_STYLE = {
  js: { label: 'JS', className: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40' },
  jsx: { label: 'JSX', className: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' },
  ts: { label: 'TS', className: 'bg-blue-500/20 text-blue-300 border-blue-500/40' },
  tsx: { label: 'TSX', className: 'bg-sky-500/20 text-sky-300 border-sky-500/40' },
  py: { label: 'PY', className: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40' },
  html: { label: 'HTML', className: 'bg-orange-500/20 text-orange-300 border-orange-500/40' },
  css: { label: 'CSS', className: 'bg-blue-400/20 text-blue-200 border-blue-400/40' },
  json: { label: 'JSON', className: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
  md: { label: 'MD', className: 'bg-slate-500/20 text-slate-200 border-slate-500/40' },
  yml: { label: 'YAML', className: 'bg-violet-500/20 text-violet-300 border-violet-500/40' },
  yaml: { label: 'YAML', className: 'bg-violet-500/20 text-violet-300 border-violet-500/40' },
  sh: { label: 'SH', className: 'bg-lime-500/20 text-lime-300 border-lime-500/40' },
  dockerfile: { label: 'DKR', className: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' },
  default: { label: 'FILE', className: 'bg-vscode-sidebar text-vscode-text-muted border-vscode-border' },
};

function getFileTypeStyle(fileName = '') {
  const lower = fileName.toLowerCase();
  if (lower === 'dockerfile') return FILE_TYPE_STYLE.dockerfile;
  const ext = lower.includes('.') ? lower.split('.').pop() : '';
  return FILE_TYPE_STYLE[ext] || FILE_TYPE_STYLE.default;
}

function FileTypeIcon({ name }) {
  const style = getFileTypeStyle(name);
  return (
    <span
      className={`inline-flex items-center justify-center min-w-[28px] h-4 px-1 rounded border text-[9px] font-semibold tracking-wide ${style.className}`}
      aria-hidden="true"
    >
      {style.label}
    </span>
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
      <FileTypeIcon name={node.name} />
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
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <FileTypeIcon name={f.path.split('/').pop()} />
            <span className="text-sm truncate text-vscode-text min-w-0">
              {f.path.split('/').pop()}
            </span>
          </div>
          <GitFileBadge status={f.status} />
        </div>
      ))}
    </div>
  );
}

function RepoGitPanel({ repo, isExpanded, onToggle }) {
  const [gitStatus, setGitStatus] = useState(null);
  const [branches, setBranches] = useState([]);
  const [showBranchPicker, setShowBranchPicker] = useState(false);
  const [pendingBranchSwitch, setPendingBranchSwitch] = useState(null);
  const [createBranchMode, setCreateBranchMode] = useState(null);
  const [newBranchName, setNewBranchName] = useState('');
  const [fromRef, setFromRef] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [commitMsg, setCommitMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState('');

  const fetchStatus = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(apiUrl(`/api/git/status?repo=${encodeURIComponent(repo.id)}`))
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((data) => setGitStatus(data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [repo.id]);

  const fetchBranches = useCallback(() => {
    fetch(apiUrl(`/api/git/branches?repo=${encodeURIComponent(repo.id)}`))
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((data) => setBranches(Array.isArray(data.branches) ? data.branches : []))
      .catch(() => setBranches([]));
  }, [repo.id]);

  useEffect(() => {
    if (!isExpanded) return;
    fetchStatus();
    fetchBranches();
  }, [isExpanded, fetchStatus, fetchBranches]);

  async function gitAction(endpoint, body = {}) {
    setBusy(true);
    setActionMsg('');
    try {
      const r = await fetch(apiUrl(endpoint), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, repo: repo.id }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setActionMsg(data.error || `Failed (${r.status})`);
        return false;
      }
      if (data.output) setActionMsg(data.output);
      fetchStatus();
      fetchBranches();
      return true;
    } catch (e) {
      setActionMsg(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerateCommitMessage() {
    setBusy(true);
    setActionMsg('');
    try {
      const r = await fetch(apiUrl('/api/git/generate-commit-message'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: repo.id }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setActionMsg(data.error || `Failed (${r.status})`);
        return;
      }
      if (typeof data.message === 'string' && data.message.trim()) {
        setCommitMsg(data.message.trim());
        setActionMsg('Generated commit message with AI.');
      }
    } catch (e) {
      setActionMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function switchBranch(targetBranch, strategy = null, remote = false) {
    setBusy(true);
    setActionMsg('');
    try {
      const r = await fetch(apiUrl('/api/git/checkout'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: targetBranch, remote, repo: repo.id, ...(strategy ? { strategy } : {}) }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.status === 409 && data?.conflict) {
        setPendingBranchSwitch({ branch: targetBranch, remote });
        setActionMsg('This branch switch needs a strategy: Stash or Discard changes.');
        return;
      }
      if (!r.ok) {
        setActionMsg(data.error || `Failed (${r.status})`);
        return;
      }
      setPendingBranchSwitch(null);
      setShowBranchPicker(false);
      setActionMsg(data.warning || data.output || `Switched to ${targetBranch}`);
      fetchStatus();
      fetchBranches();
    } catch (e) {
      setActionMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateBranch(localBranches, remoteBranches, currentBranch) {
    const name = newBranchName.trim();
    if (!name) {
      setActionMsg('Branch name is required.');
      return;
    }
    setBusy(true);
    setActionMsg('');
    try {
      const r = await fetch(apiUrl('/api/git/branch/create'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: repo.id,
          name,
          ...(createBranchMode === 'from' && (fromRef || currentBranch) ? { from: fromRef || currentBranch } : {}),
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setActionMsg(data.error || `Failed (${r.status})`);
        return;
      }
      setActionMsg(data.output || `Created and switched to ${name}`);
      setCreateBranchMode(null);
      setNewBranchName('');
      setFromRef('');
      setShowBranchPicker(false);
      fetchStatus();
      fetchBranches();
    } catch (e) {
      setActionMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  const branchLabel = gitStatus?.branch || 'No branch';
  const ahead = gitStatus?.ahead || 0;
  const behind = gitStatus?.behind || 0;
  const changedCount = (gitStatus?.staged?.length || 0) + (gitStatus?.unstaged?.length || 0) + (gitStatus?.untracked?.length || 0);

  return (
    <div className="border-b border-vscode-border">
      <button
        onClick={onToggle}
        className="w-full px-3 py-2.5 flex items-center justify-between text-left hover:bg-vscode-sidebar-hover"
        style={{ background: 'transparent', border: 'none', outline: 'none' }}
      >
        <div className="min-w-0">
          <div className="text-sm text-vscode-text truncate">{repo.name}</div>
          <div className="text-[11px] text-vscode-text-muted">
            {branchLabel}{ahead > 0 ? `  ↑${ahead}` : ''}{behind > 0 ? `  ↓${behind}` : ''}{changedCount > 0 ? `  • ${changedCount} changes` : ''}
          </div>
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
          className={`w-4 h-4 text-vscode-text-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {!isExpanded && null}
      {isExpanded && loading && (
        <div className="px-3 py-3 text-sm text-vscode-text-muted">Loading...</div>
      )}
      {isExpanded && error && (
        <div className="px-3 py-3 text-sm text-red-400">Error: {error}</div>
      )}
      {isExpanded && !loading && !error && gitStatus?.branch && (() => {
        const { branch, staged, unstaged, untracked } = gitStatus;
        const localBranches = branches.filter((b) => !b.remote);
        const remoteBranches = branches.filter((b) => b.remote);
        const hasChanges = staged.length + unstaged.length + untracked.length > 0;
        const canCommit = staged.length > 0 && commitMsg.trim().length > 0;
        const hasMessage = commitMsg.trim().length > 0;
        return (
          <div>
            <div className="flex items-center justify-between px-3 py-2 border-t border-vscode-border">
              <button
                onClick={() => {
                  fetchBranches();
                  setShowBranchPicker((v) => !v);
                }}
                disabled={busy}
                className="text-sm text-vscode-text hover:text-white disabled:opacity-40"
                style={{ background: 'none', border: 'none', outline: 'none' }}
              >
                {branch} {showBranchPicker ? '▲' : '▼'}
              </button>
              <button
                onClick={fetchStatus}
                disabled={busy}
                className="text-vscode-text-muted hover:text-vscode-text"
                style={{ background: 'none', border: 'none', outline: 'none' }}
              >
                Refresh
              </button>
            </div>

            {showBranchPicker && (
              <div className="px-3 py-2 border-t border-vscode-border bg-vscode-sidebar">
                <div className="flex flex-col gap-1 mb-2">
                  <button
                    onClick={() => { setCreateBranchMode('new'); setNewBranchName(''); setFromRef(branch); }}
                    disabled={busy}
                    className="text-left px-2 py-1.5 rounded text-xs border border-vscode-border text-vscode-text-muted hover:text-vscode-text"
                    style={{ outline: 'none', background: 'transparent' }}
                  >
                    + Create new branch...
                  </button>
                  <button
                    onClick={() => {
                      setCreateBranchMode('from');
                      setNewBranchName('');
                      setFromRef(branch || localBranches[0]?.fullName || remoteBranches[0]?.fullName || '');
                    }}
                    disabled={busy}
                    className="text-left px-2 py-1.5 rounded text-xs border border-vscode-border text-vscode-text-muted hover:text-vscode-text"
                    style={{ outline: 'none', background: 'transparent' }}
                  >
                    + Create new branch from...
                  </button>
                </div>

                {createBranchMode && (
                  <div className="mb-2 p-2 rounded border border-vscode-border bg-vscode-bg flex flex-col gap-2">
                    <input
                      value={newBranchName}
                      onChange={(e) => setNewBranchName(e.target.value)}
                      placeholder="new-branch-name"
                      className="w-full px-2 py-1.5 rounded border border-vscode-border bg-vscode-sidebar text-xs text-vscode-text"
                      style={{ outline: 'none' }}
                    />
                    {createBranchMode === 'from' && (
                      <select
                        value={fromRef}
                        onChange={(e) => setFromRef(e.target.value)}
                        className="w-full px-2 py-1.5 rounded border border-vscode-border bg-vscode-sidebar text-xs text-vscode-text"
                        style={{ outline: 'none' }}
                      >
                        {[...localBranches, ...remoteBranches].map((b) => (
                          <option key={`from:${b.fullName}`} value={b.fullName}>{b.fullName}</option>
                        ))}
                      </select>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleCreateBranch(localBranches, remoteBranches, branch)}
                        disabled={busy || !newBranchName.trim()}
                        className="flex-1 py-1.5 rounded text-xs border border-vscode-border text-vscode-text disabled:opacity-40"
                        style={{ background: 'transparent', outline: 'none' }}
                      >
                        Create &amp; Switch
                      </button>
                      <button
                        onClick={() => { setCreateBranchMode(null); setNewBranchName(''); setFromRef(''); }}
                        disabled={busy}
                        className="px-2 py-1.5 rounded text-xs border border-vscode-border text-vscode-text-muted"
                        style={{ background: 'transparent', outline: 'none' }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-1">
                  {localBranches.length > 0 && <p className="text-[10px] uppercase tracking-wider text-vscode-text-muted px-1 pt-1">Local branches</p>}
                  {localBranches.map((b) => (
                    <button
                      key={`local:${b.fullName}`}
                      onClick={async () => {
                        const hasUncommitted = staged.length + unstaged.length + untracked.length > 0;
                        if (hasUncommitted && !b.current) {
                          setPendingBranchSwitch({ branch: b.fullName, remote: false });
                          setShowBranchPicker(false);
                          return;
                        }
                        if (!b.current) await switchBranch(b.fullName, null, false);
                        setShowBranchPicker(false);
                      }}
                      disabled={busy || b.current}
                      className="text-left px-2 py-1.5 rounded text-xs border border-vscode-border text-vscode-text-muted hover:text-vscode-text disabled:opacity-60"
                      style={{ outline: 'none', background: 'transparent' }}
                    >
                      {b.name}{b.current ? ' (Current)' : ''}
                    </button>
                  ))}

                  {remoteBranches.length > 0 && <p className="text-[10px] uppercase tracking-wider text-vscode-text-muted px-1 pt-2">Remote branches</p>}
                  {remoteBranches.map((b) => (
                    <button
                      key={`remote:${b.fullName}`}
                      onClick={async () => {
                        const hasUncommitted = staged.length + unstaged.length + untracked.length > 0;
                        if (hasUncommitted) {
                          setPendingBranchSwitch({ branch: b.fullName, remote: true });
                          setShowBranchPicker(false);
                          return;
                        }
                        await switchBranch(b.fullName, null, true);
                        setShowBranchPicker(false);
                      }}
                      disabled={busy}
                      className="text-left px-2 py-1.5 rounded text-xs border border-vscode-border text-vscode-text-muted hover:text-vscode-text"
                      style={{ outline: 'none', background: 'transparent' }}
                    >
                      {b.fullName}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {pendingBranchSwitch && (
              <div className="px-3 py-2 border-t border-vscode-border bg-vscode-sidebar">
                <p className="text-xs text-vscode-text-muted mb-2">
                  Uncommitted changes detected before switching to <span className="text-vscode-text">{pendingBranchSwitch.branch}</span>.
                </p>
                <div className="flex gap-2">
                  <button onClick={() => switchBranch(pendingBranchSwitch.branch, 'stash', pendingBranchSwitch.remote)} disabled={busy}
                    className="flex-1 py-1.5 rounded text-xs border border-vscode-border text-vscode-text" style={{ background: 'transparent', outline: 'none' }}>
                    Stash &amp; Switch
                  </button>
                  <button onClick={() => switchBranch(pendingBranchSwitch.branch, 'force', pendingBranchSwitch.remote)} disabled={busy}
                    className="flex-1 py-1.5 rounded text-xs border border-vscode-border text-red-300" style={{ background: 'transparent', outline: 'none' }}>
                    Discard &amp; Switch
                  </button>
                  <button
                    onClick={() => setPendingBranchSwitch(null)}
                    disabled={busy}
                    className="px-2 py-1.5 rounded text-xs border border-vscode-border text-vscode-text-muted hover:text-vscode-text disabled:opacity-40"
                    style={{ background: 'transparent', outline: 'none' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto">
              {!hasChanges && <p className="px-3 py-4 text-sm text-vscode-text-muted">No changes.</p>}
              <GitSection title="Staged" files={staged} action={staged.length ? () => gitAction('/api/git/unstage', { all: true }) : null} actionLabel="Unstage all" busy={busy} />
              <GitSection title="Changes" files={unstaged} action={unstaged.length ? () => gitAction('/api/git/stage', { all: true }) : null} actionLabel="Stage all" busy={busy} />
              <GitSection title="Untracked" files={untracked} action={untracked.length ? () => gitAction('/api/git/stage', { all: true }) : null} actionLabel="Stage all" busy={busy} />

              {staged.length > 0 && (
                <div className="px-3 pt-3 pb-2 border-t border-vscode-border mt-1">
                  <div className="mb-2.5 p-2 rounded border border-vscode-border bg-vscode-sidebar">
                    <div className="text-[11px] uppercase tracking-wider text-vscode-text-muted mb-1.5">Commit flow</div>
                    <div className="grid grid-cols-3 gap-2 text-[11px]">
                      <div className="rounded border px-2 py-1 border-vscode-border text-vscode-text"><div className="font-medium">1. Stage</div><div className="text-vscode-text-muted">{staged.length} staged</div></div>
                      <div className={['rounded border px-2 py-1', hasMessage ? 'border-green-500/40 text-vscode-text' : 'border-vscode-border text-vscode-text-muted'].join(' ')}><div className="font-medium">2. Message</div><div>{hasMessage ? 'ready' : 'required'}</div></div>
                      <div className={['rounded border px-2 py-1', canCommit ? 'border-green-500/40 text-vscode-text' : 'border-vscode-border text-vscode-text-muted'].join(' ')}><div className="font-medium">3. Commit</div><div>{canCommit ? 'ready' : 'blocked'}</div></div>
                    </div>
                  </div>
                  <div className="flex justify-end mb-1">
                    <button onClick={handleGenerateCommitMessage} disabled={staged.length === 0 || busy}
                      className="text-[11px] px-2.5 py-1 rounded border border-vscode-border text-vscode-text-muted hover:text-vscode-text disabled:opacity-40"
                      style={{ background: 'transparent', outline: 'none' }}>
                      Generate commit message
                    </button>
                  </div>
                  <textarea value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)} placeholder="Commit message…" rows={3}
                    className="w-full rounded text-sm px-2 py-1.5 resize-none bg-vscode-bg border border-vscode-border text-vscode-text placeholder-vscode-text-muted focus:outline-none focus:border-vscode-accent" />
                  <button onClick={() => { if (commitMsg.trim()) gitAction('/api/git/commit', { message: commitMsg }).then((ok) => { if (ok) setCommitMsg(''); }); }}
                    disabled={!canCommit || busy}
                    className={['mt-2 w-full py-2 rounded text-sm font-medium transition-colors', canCommit && !busy ? 'bg-vscode-accent text-white cursor-pointer' : 'bg-vscode-sidebar border border-vscode-border text-vscode-text-muted opacity-50 cursor-not-allowed'].join(' ')}
                    style={{ border: 'none', outline: 'none' }}>
                    {busy ? 'Working…' : 'Commit'}
                  </button>
                </div>
              )}

              <div className="flex gap-2 px-3 pt-2 pb-3">
                <button onClick={() => gitAction('/api/git/pull')} disabled={busy}
                  className="flex-1 py-2 rounded text-sm border border-vscode-border text-vscode-text hover:bg-vscode-sidebar-hover disabled:opacity-40"
                  style={{ background: 'transparent', outline: 'none' }}>
                  Pull
                </button>
                <button onClick={() => gitAction('/api/git/push')} disabled={busy}
                  className="flex-1 py-2 rounded text-sm border border-vscode-border text-vscode-text hover:bg-vscode-sidebar-hover disabled:opacity-40"
                  style={{ background: 'transparent', outline: 'none' }}>
                  Push
                </button>
              </div>

              {actionMsg && <p className="px-3 pb-3 text-[11px] text-vscode-text-muted whitespace-pre-wrap break-words">{actionMsg}</p>}
            </div>
          </div>
        );
      })()}
      {isExpanded && !loading && !error && !gitStatus?.branch && (
        <div className="px-3 py-3 text-sm text-vscode-text-muted">Not a git repository.</div>
      )}
    </div>
  );
}

function GitView() {
  const [repos, setRepos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedRepoIds, setExpandedRepoIds] = useState(() => new Set());

  const fetchRepos = useCallback(() => {
    setLoading(true);
    fetch(apiUrl('/api/git/repos'))
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((data) => {
        const list = Array.isArray(data.repos) ? data.repos : [];
        setRepos(list);
        if (list.length === 1) {
          setExpandedRepoIds(new Set([list[0].id]));
        } else {
          setExpandedRepoIds(new Set());
        }
      })
      .catch(() => setRepos([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchRepos();
  }, [fetchRepos]);

  function toggleRepo(repoId) {
    setExpandedRepoIds((prev) => {
      const next = new Set(prev);
      if (next.has(repoId)) next.delete(repoId);
      else next.add(repoId);
      return next;
    });
  }

  if (loading) {
    return <div className="px-3 py-4 text-sm text-vscode-text-muted">Loading repositories...</div>;
  }

  if (!repos.length) {
    return <div className="px-3 py-4 text-sm text-vscode-text-muted">No git repositories found in this workspace.</div>;
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {repos.map((repo) => (
        <RepoGitPanel
          key={repo.id}
          repo={repo}
          isExpanded={expandedRepoIds.has(repo.id)}
          onToggle={() => toggleRepo(repo.id)}
        />
      ))}
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
