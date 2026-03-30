import { useState, useEffect, useRef, useCallback } from 'react';
import { apiUrl } from '../config/server';
import { readText, writeText } from '../utils/persist';

const CHAT_UI_AGENT_KEY = 'pocketide.chat.ui.agent.v1';
const CHAT_UI_MODEL_KEY = 'pocketide.chat.ui.model.v1';
const CHAT_UI_EXEC_MODE_KEY = 'pocketide.chat.ui.execMode.v1';
const CHAT_UI_APPROVAL_KEY = 'pocketide.chat.ui.approval.v1';

function normalizeProviderLabel(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'codex') return 'Codex';
  if (normalized === 'local') return 'Local';
  if (['auto', 'balanced', 'fast', 'quality', 'copilot'].includes(normalized)) return 'Copilot';
  return 'Copilot';
}

function normalizeExecutionModeLabel(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'cloud') return 'Cloud';
  if (normalized === 'local' || normalized === 'chat') return 'Chat';
  return 'Chat';
}

export default function SettingsView({ onClearCache, onWorkspaceChanged }) {
  const [workspacePath, setWorkspacePath] = useState(null);
  const [changing, setChanging] = useState(false);
  const [inputPath, setInputPath] = useState('');
  const workspaceRowRef = useRef(null);
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [chatAgentLabel, setChatAgentLabel] = useState(() => readText(CHAT_UI_AGENT_KEY, 'agent'));
  const [chatModelLabel, setChatModelLabel] = useState(() => normalizeProviderLabel(readText(CHAT_UI_MODEL_KEY, 'Copilot')));
  const [chatExecModeLabel, setChatExecModeLabel] = useState(() => normalizeExecutionModeLabel(readText(CHAT_UI_EXEC_MODE_KEY, 'Chat')));
  const [chatApprovalLabel, setChatApprovalLabel] = useState(() => readText(CHAT_UI_APPROVAL_KEY, 'Default Approvals'));
  const [providerStatus, setProviderStatus] = useState(null);
  const [providerBusy, setProviderBusy] = useState(false);
  const [providerMsg, setProviderMsg] = useState('');
  const [copilotAuthType, setCopilotAuthType] = useState('logged-in-user');
  const [copilotToken, setCopilotToken] = useState('');
  const [codexApiKey, setCodexApiKey] = useState('');
  const [codexBaseUrl, setCodexBaseUrl] = useState('https://api.openai.com/v1');
  const [codexModel, setCodexModel] = useState('gpt-5-codex');
  const [localApiKey, setLocalApiKey] = useState('');
  const [localBaseUrl, setLocalBaseUrl] = useState('http://127.0.0.1:11434/v1');
  const [localModel, setLocalModel] = useState('qwen2.5-coder:latest');
  const [localHealthBusy, setLocalHealthBusy] = useState(false);
  const [localHealthMsg, setLocalHealthMsg] = useState('');

  const fetchProviderStatus = useCallback(async () => {
    try {
      const r = await fetch(apiUrl('/api/providers/status'));
      if (!r.ok) throw new Error(`Failed (${r.status})`);
      const data = await r.json();
      const providers = data?.providers || {};
      setProviderStatus(providers);
      if (providers.copilot?.authType) setCopilotAuthType(providers.copilot.authType);
      if (providers.codex?.baseUrl) setCodexBaseUrl(providers.codex.baseUrl);
      if (providers.codex?.model) setCodexModel(providers.codex.model);
      if (providers.local?.baseUrl) setLocalBaseUrl(providers.local.baseUrl);
      if (providers.local?.model) setLocalModel(providers.local.model);
    } catch (_) {
      setProviderStatus(null);
    }
  }, []);

  useEffect(() => {
    fetch(apiUrl('/api/workspace'))
      .then(async (r) => {
        if (!r.ok) throw new Error('Failed to load workspace path');
        return r.json();
      })
      .then((d) => setWorkspacePath(d.path))
      .catch(() => setWorkspacePath('(unavailable)'));
  }, []);

  useEffect(() => {
    fetchProviderStatus();
  }, [fetchProviderStatus]);

  function handleCancelChange() {
    setInputPath(workspacePath ?? '');
    setSuggestions([]);
    setError('');
    setChanging(false);
  }

  useEffect(() => {
    if (!changing) return;
    function handleClickOutside(e) {
      if (workspaceRowRef.current && !workspaceRowRef.current.contains(e.target)) {
        handleCancelChange();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [changing, workspacePath]);

  function handleChangeClick() {
    setInputPath(workspacePath ?? '');
    setError('');
    setSuggestions([]);
    setChanging(true);
  }

  async function handleConfirmChange() {
    setError('');
    try {
      const res = await fetch(apiUrl('/api/workspace'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: inputPath.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `Failed to change workspace (${res.status})`);
        return;
      }
      setWorkspacePath(data.path);
      setSuggestions([]);
      if (typeof onWorkspaceChanged === 'function') {
        await onWorkspaceChanged(data.path);
      }
      setChanging(false);
    } catch (e) {
      setError('Could not reach server');
    }
  }

  useEffect(() => {
    if (!changing) {
      setSuggestions([]);
      return;
    }

    const prefix = inputPath.trim();
    if (!prefix) {
      setSuggestions([]);
      return;
    }

    const timer = window.setTimeout(async () => {
      setLoadingSuggestions(true);
      try {
        const res = await fetch(apiUrl(`/api/workspace/suggestions?prefix=${encodeURIComponent(prefix)}`));
        if (!res.ok) {
          setSuggestions([]);
          return;
        }
        const data = await res.json().catch(() => ({ suggestions: [] }));
        setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
      } catch (_) {
        setSuggestions([]);
      } finally {
        setLoadingSuggestions(false);
      }
    }, 120);

    return () => window.clearTimeout(timer);
  }, [changing, inputPath]);

  useEffect(() => { writeText(CHAT_UI_AGENT_KEY, chatAgentLabel); }, [chatAgentLabel]);
  useEffect(() => { writeText(CHAT_UI_MODEL_KEY, normalizeProviderLabel(chatModelLabel)); }, [chatModelLabel]);
  useEffect(() => { writeText(CHAT_UI_EXEC_MODE_KEY, normalizeExecutionModeLabel(chatExecModeLabel)); }, [chatExecModeLabel]);
  useEffect(() => { writeText(CHAT_UI_APPROVAL_KEY, chatApprovalLabel); }, [chatApprovalLabel]);

  async function handleSaveCopilotAuth() {
    setProviderBusy(true);
    setProviderMsg('');
    try {
      const r = await fetch(apiUrl('/api/providers/config'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          copilot: {
            authType: copilotAuthType,
            token: copilotAuthType === 'token' ? copilotToken : '',
          },
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `Failed (${r.status})`);
      setProviderStatus(data.providers || null);
      setProviderMsg('Copilot provider settings saved.');
    } catch (e) {
      setProviderMsg(e.message || 'Failed to save Copilot settings.');
    } finally {
      setProviderBusy(false);
    }
  }

  async function handleSaveCodexAuth() {
    setProviderBusy(true);
    setProviderMsg('');
    try {
      const r = await fetch(apiUrl('/api/providers/config'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          codex: {
            baseUrl: codexBaseUrl,
            model: codexModel,
            ...(codexApiKey.trim() ? { apiKey: codexApiKey } : {}),
          },
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `Failed (${r.status})`);
      setProviderStatus(data.providers || null);
      setCodexApiKey('');
      setProviderMsg('Codex provider settings saved.');
    } catch (e) {
      setProviderMsg(e.message || 'Failed to save Codex settings.');
    } finally {
      setProviderBusy(false);
    }
  }

  async function handleSaveLocalAuth() {
    setProviderBusy(true);
    setProviderMsg('');
    try {
      const r = await fetch(apiUrl('/api/providers/config'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          local: {
            baseUrl: localBaseUrl,
            model: localModel,
            ...(localApiKey.trim() ? { apiKey: localApiKey } : {}),
          },
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `Failed (${r.status})`);
      setProviderStatus(data.providers || null);
      setLocalApiKey('');
      setProviderMsg('Local provider settings saved.');
    } catch (e) {
      setProviderMsg(e.message || 'Failed to save Local settings.');
    } finally {
      setProviderBusy(false);
    }
  }

  async function handleTestLocalConnection() {
    setLocalHealthBusy(true);
    setLocalHealthMsg('');
    try {
      const r = await fetch(apiUrl('/api/providers/local/health'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: localBaseUrl,
          model: localModel,
          ...(localApiKey.trim() ? { apiKey: localApiKey } : {}),
        }),
      });

      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data?.ok) {
        throw new Error(data?.error || `Failed (${r.status})`);
      }

      const preview = data.responsePreview ? ` (${data.responsePreview})` : '';
      setLocalHealthMsg(`Local connection OK${preview}`);
      fetchProviderStatus();
    } catch (e) {
      setLocalHealthMsg(`Local connection failed: ${e.message || 'Unknown error.'}`);
    } finally {
      setLocalHealthBusy(false);
    }
  }

  function handlePickSuggestion(nextPath) {
    setInputPath(nextPath);
    setSuggestions([]);
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto overscroll-y-contain px-4 py-6">
      <h1 className="text-base font-semibold text-vscode-text mb-6">Settings</h1>

      {/* Workspace section */}
      <div className="mb-2">
        <p className="text-[11px] uppercase tracking-widest text-vscode-text-muted mb-3 px-1">
          Workspace
        </p>
        <div
          className="rounded-xl border border-vscode-border overflow-hidden"
          style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}
        >
          {/* Current Workspace row */}
          <div className="px-4 py-3 border-b border-vscode-border" ref={workspaceRowRef}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-vscode-text font-medium">Current Workspace</p>
                <p
                  className="text-xs text-vscode-text-muted mt-0.5 break-all"
                  title={workspacePath ?? ''}
                >
                  {workspacePath ?? 'Loading…'}
                </p>
              </div>
              {changing ? (
                <button
                  type="button"
                  onClick={handleConfirmChange}
                  className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium bg-vscode-accent text-white border-none cursor-pointer"
                >
                  Apply
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleChangeClick}
                  className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border border-vscode-border text-vscode-text cursor-pointer"
                  style={{ background: 'transparent' }}
                >
                  Change
                </button>
              )}
            </div>

            {changing && (
              <div className="mt-3">
                <input
                  type="text"
                  value={inputPath}
                  onChange={(e) => setInputPath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleConfirmChange();
                    if (e.key === 'Escape') handleCancelChange();
                  }}
                  placeholder="/absolute/path/to/folder"
                  className="w-full px-3 py-2 rounded-lg text-sm text-vscode-text border border-vscode-border bg-transparent focus:outline-none focus:border-vscode-accent"
                  autoFocus
                />
                {(loadingSuggestions || suggestions.length > 0) && (
                  <div
                    className="mt-1 rounded-lg border border-vscode-border overflow-hidden"
                    style={{ backgroundColor: 'rgba(20,20,22,0.98)' }}
                  >
                    {loadingSuggestions && (
                      <p className="px-3 py-2 text-xs text-vscode-text-muted">Loading directories...</p>
                    )}
                    {!loadingSuggestions && suggestions.map((dirPath) => (
                      <button
                        key={dirPath}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handlePickSuggestion(dirPath)}
                        className="w-full text-left px-3 py-2 text-xs text-vscode-text hover:bg-vscode-sidebar-hover border-none cursor-pointer"
                        style={{ background: 'transparent' }}
                      >
                        {dirPath}
                      </button>
                    ))}
                  </div>
                )}
                {error && (
                  <p className="text-xs text-red-400 mt-1">{error}</p>
                )}
              </div>
            )}
          </div>

          {/* Clear Cache row */}
          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="text-sm text-vscode-text font-medium">Clear Cache</p>
              <p className="text-xs text-vscode-text-muted mt-0.5">Clears current workspace</p>
            </div>
            <button
              type="button"
              onClick={onClearCache}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-vscode-border text-vscode-text cursor-pointer"
              style={{ background: 'transparent' }}
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      {/* Agent Controls section */}
      <div className="mt-6">
        <p className="text-[11px] uppercase tracking-widest text-vscode-text-muted mb-3 px-1">
          Agent Controls
        </p>
        <div className="rounded-xl border border-vscode-border overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}>
          <div className="px-4 py-3 border-b border-vscode-border">
            <p className="text-sm text-vscode-text font-medium">AI Mode</p>
            <p className="text-xs text-vscode-text-muted mt-0.5">Autonomous agent, ask for approval, or show plan first.</p>
            <select
              value={chatAgentLabel}
              onChange={(e) => setChatAgentLabel(e.target.value)}
              className="mt-2 w-full px-3 py-2 rounded-lg text-sm text-vscode-text border border-vscode-border bg-transparent"
              style={{ outline: 'none' }}
            >
              <option value="agent">Agent</option>
              <option value="ask">Ask</option>
              <option value="plan">Plan</option>
            </select>
          </div>

          <div className="px-4 py-3 border-b border-vscode-border">
            <p className="text-sm text-vscode-text font-medium">Provider</p>
            <select
              value={chatModelLabel}
              onChange={(e) => setChatModelLabel(e.target.value)}
              className="mt-2 w-full px-3 py-2 rounded-lg text-sm text-vscode-text border border-vscode-border bg-transparent"
              style={{ outline: 'none' }}
            >
              <option value="Copilot">Copilot</option>
              <option value="Codex">Codex</option>
              <option value="Local">Local</option>
            </select>
          </div>

          <div className="px-4 py-3 border-b border-vscode-border">
            <p className="text-sm text-vscode-text font-medium">Execution</p>
            <select
              value={chatExecModeLabel}
              onChange={(e) => setChatExecModeLabel(e.target.value)}
              className="mt-2 w-full px-3 py-2 rounded-lg text-sm text-vscode-text border border-vscode-border bg-transparent"
              style={{ outline: 'none' }}
            >
              <option value="Chat">Chat</option>
              <option value="Cloud">Cloud</option>
            </select>
          </div>

          <div className="px-4 py-3">
            <p className="text-sm text-vscode-text font-medium">Approval Policy Label</p>
            <select
              value={chatApprovalLabel}
              onChange={(e) => setChatApprovalLabel(e.target.value)}
              className="mt-2 w-full px-3 py-2 rounded-lg text-sm text-vscode-text border border-vscode-border bg-transparent"
              style={{ outline: 'none' }}
            >
              <option value="Default Approvals">Default Approvals</option>
              <option value="Ask Every Time">Ask Every Time</option>
              <option value="Auto Approve Safe">Auto Approve Safe</option>
            </select>
          </div>
        </div>
      </div>

      <div className="mt-6">
        <p className="text-[11px] uppercase tracking-widest text-vscode-text-muted mb-3 px-1">
          Provider Sign-in
        </p>
        <div className="rounded-xl border border-vscode-border overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}>
          <div className="px-4 py-3 border-b border-vscode-border">
            <p className="text-sm text-vscode-text font-medium">Copilot</p>
            <p className="text-xs text-vscode-text-muted mt-0.5">Use logged-in user or personal access token.</p>
            <div className="mt-2 grid grid-cols-1 gap-2">
              <select
                value={copilotAuthType}
                onChange={(e) => setCopilotAuthType(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm text-vscode-text border border-vscode-border bg-transparent"
                style={{ outline: 'none' }}
              >
                <option value="logged-in-user">Logged-in User</option>
                <option value="token">Token</option>
              </select>
              {copilotAuthType === 'token' && (
                <input
                  type="password"
                  value={copilotToken}
                  onChange={(e) => setCopilotToken(e.target.value)}
                  placeholder="GitHub token"
                  className="w-full px-3 py-2 rounded-lg text-sm text-vscode-text border border-vscode-border bg-transparent"
                  style={{ outline: 'none' }}
                />
              )}
              <button
                type="button"
                onClick={handleSaveCopilotAuth}
                disabled={providerBusy}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-vscode-border text-vscode-text cursor-pointer disabled:opacity-40"
                style={{ background: 'transparent' }}
              >
                Save Copilot Sign-in
              </button>
            </div>
            <p className="text-[11px] text-vscode-text-muted mt-2">
              Status: {providerStatus?.copilot?.ready ? 'Ready' : 'Not ready'}
              {providerStatus?.copilot?.authMode ? ` (${providerStatus.copilot.authMode})` : ''}
              {providerStatus?.copilot?.error ? ` - ${providerStatus.copilot.error}` : ''}
            </p>
          </div>

          <div className="px-4 py-3">
            <p className="text-sm text-vscode-text font-medium">Codex</p>
            <p className="text-xs text-vscode-text-muted mt-0.5">Configure API key, base URL, and model for Codex/OpenAI-compatible endpoints.</p>
            <div className="mt-2 grid grid-cols-1 gap-2">
              <input
                type="password"
                value={codexApiKey}
                onChange={(e) => setCodexApiKey(e.target.value)}
                placeholder="Codex API key"
                className="w-full px-3 py-2 rounded-lg text-sm text-vscode-text border border-vscode-border bg-transparent"
                style={{ outline: 'none' }}
              />
              <input
                type="text"
                value={codexBaseUrl}
                onChange={(e) => setCodexBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1"
                className="w-full px-3 py-2 rounded-lg text-sm text-vscode-text border border-vscode-border bg-transparent"
                style={{ outline: 'none' }}
              />
              <input
                type="text"
                value={codexModel}
                onChange={(e) => setCodexModel(e.target.value)}
                placeholder="gpt-5-codex"
                className="w-full px-3 py-2 rounded-lg text-sm text-vscode-text border border-vscode-border bg-transparent"
                style={{ outline: 'none' }}
              />
              <button
                type="button"
                onClick={handleSaveCodexAuth}
                disabled={providerBusy}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-vscode-border text-vscode-text cursor-pointer disabled:opacity-40"
                style={{ background: 'transparent' }}
              >
                Save Codex Sign-in
              </button>
            </div>
            <p className="text-[11px] text-vscode-text-muted mt-2">
              Status: {providerStatus?.codex?.ready ? 'Ready' : 'Not ready'}
            </p>
          </div>

          <div className="px-4 py-3 border-t border-vscode-border">
            <p className="text-sm text-vscode-text font-medium">Local</p>
            <p className="text-xs text-vscode-text-muted mt-0.5">Point to your Local-Agent OpenAI-compatible endpoint and model.</p>
            <div className="mt-2 grid grid-cols-1 gap-2">
              <input
                type="password"
                value={localApiKey}
                onChange={(e) => setLocalApiKey(e.target.value)}
                placeholder="Optional API key"
                className="w-full px-3 py-2 rounded-lg text-sm text-vscode-text border border-vscode-border bg-transparent"
                style={{ outline: 'none' }}
              />
              <input
                type="text"
                value={localBaseUrl}
                onChange={(e) => setLocalBaseUrl(e.target.value)}
                placeholder="http://127.0.0.1:11434/v1"
                className="w-full px-3 py-2 rounded-lg text-sm text-vscode-text border border-vscode-border bg-transparent"
                style={{ outline: 'none' }}
              />
              <input
                type="text"
                value={localModel}
                onChange={(e) => setLocalModel(e.target.value)}
                placeholder="qwen2.5-coder:latest"
                className="w-full px-3 py-2 rounded-lg text-sm text-vscode-text border border-vscode-border bg-transparent"
                style={{ outline: 'none' }}
              />
              <button
                type="button"
                onClick={handleSaveLocalAuth}
                disabled={providerBusy}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-vscode-border text-vscode-text cursor-pointer disabled:opacity-40"
                style={{ background: 'transparent' }}
              >
                Save Local Connection
              </button>
              <button
                type="button"
                onClick={handleTestLocalConnection}
                disabled={providerBusy || localHealthBusy}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-vscode-border text-vscode-text cursor-pointer disabled:opacity-40"
                style={{ background: 'transparent' }}
              >
                {localHealthBusy ? 'Testing...' : 'Test Local Connection'}
              </button>
            </div>
            <p className="text-[11px] text-vscode-text-muted mt-2">
              Status: {providerStatus?.local?.ready ? 'Ready' : 'Not ready'}
              {providerStatus?.local?.message ? ` - ${providerStatus.local.message}` : ''}
            </p>
            {localHealthMsg && (
              <p className="text-[11px] text-vscode-text-muted mt-1">{localHealthMsg}</p>
            )}
          </div>
        </div>

        {providerMsg && (
          <p className="text-xs text-vscode-text-muted mt-2 px-1">{providerMsg}</p>
        )}
      </div>
    </div>
  );
}
