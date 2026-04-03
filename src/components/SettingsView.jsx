import { useState, useEffect, useRef, useCallback } from 'react';
import { apiUrl } from '../config/server';
import { readText, writeText } from '../utils/persist';
import { preventScrollOnFocus } from '../utils/preventScrollOnFocus';

const CHAT_UI_AGENT_KEY = 'pocketcode.agent.ai.mode.v1';
const CHAT_UI_PROVIDER_KEY = 'pocketcode.agent.ai.provider.v1';
const CHAT_UI_MODEL_KEY = 'pocketcode.agent.ai.model.v1';
const CHAT_UI_EXEC_MODE_KEY = 'pocketcode.agent.ai.execution.v1';
const CHAT_UI_APPROVAL_KEY = 'pocketcode.agent.ai.approval.v1';

function parseCodexDeviceAuthInfo(text) {
  const source = String(text || '');
  const urlMatch = source.match(/https?:\/\/[^\s)"']+/i);
  const codeMatch = source.match(/\b([A-Z0-9]{4,}-[A-Z0-9]{4,})\b/);
  return {
    verificationUrl: urlMatch ? urlMatch[0] : '',
    oneTimeCode: codeMatch ? codeMatch[1] : '',
  };
}

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
  const pathInputRef = useRef(null);
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [chatAgentLabel, setChatAgentLabel] = useState(() => readText(CHAT_UI_AGENT_KEY, 'agent'));
  const [chatModelLabel, setChatModelLabel] = useState(() => normalizeProviderLabel(readText(CHAT_UI_PROVIDER_KEY, 'Copilot')));
  const [chatExecModeLabel, setChatExecModeLabel] = useState(() => normalizeExecutionModeLabel(readText(CHAT_UI_EXEC_MODE_KEY, 'Chat')));
  const [chatApprovalLabel, setChatApprovalLabel] = useState(() => readText(CHAT_UI_APPROVAL_KEY, 'Default Approvals'));
  const [providerStatus, setProviderStatus] = useState(null);
  const [providerBusy, setProviderBusy] = useState(false);
  const [providerMsg, setProviderMsg] = useState('');
  const [copilotAuthType, setCopilotAuthType] = useState('logged-in-user');
  const [copilotToken, setCopilotToken] = useState('');
  const [copilotModel, setCopilotModel] = useState('claude-sonnet-4.5');
  const [codexAuthType, setCodexAuthType] = useState('logged-in-user');
  const [codexToken, setCodexToken] = useState('');
  const [codexModel, setCodexModel] = useState('gpt-5.4');
  const [localApiKey, setLocalApiKey] = useState('');
  const [localBaseUrl, setLocalBaseUrl] = useState('http://127.0.0.1:11434/v1');
  const [localModel, setLocalModel] = useState('qwen2.5-coder:latest');
  const [localHealthBusy, setLocalHealthBusy] = useState(false);
  const [localHealthMsg, setLocalHealthMsg] = useState('');
  const [codexLoginBusy, setCodexLoginBusy] = useState(false);
  const [codexLoginOutput, setCodexLoginOutput] = useState('');
  const [codexLoginModalOpen, setCodexLoginModalOpen] = useState(false);
  const [codexLoginUrl, setCodexLoginUrl] = useState('');
  const [codexLoginCode, setCodexLoginCode] = useState('');
  const [codexLoginStatus, setCodexLoginStatus] = useState('');
  const [codexCodeCopied, setCodexCodeCopied] = useState(false);
  const codexCodeInputRef = useRef(null);
  const [copilotLoginBusy, setCopilotLoginBusy] = useState(false);
  const [copilotLoginOutput, setCopilotLoginOutput] = useState('');
  const [copilotLoginModalOpen, setCopilotLoginModalOpen] = useState(false);
  const [copilotLoginUrl, setCopilotLoginUrl] = useState('');
  const [copilotLoginCode, setCopilotLoginCode] = useState('');
  const [copilotLoginStatus, setCopilotLoginStatus] = useState('');
  const [copilotCodeCopied, setCopilotCodeCopied] = useState(false);
  const copilotCodeInputRef = useRef(null);

  const fetchProviderStatus = useCallback(async () => {
    try {
      const r = await fetch(apiUrl('/api/providers/status'));
      if (!r.ok) throw new Error(`Failed (${r.status})`);
      const data = await r.json();
      const providers = data?.providers || {};
      setProviderStatus(providers);
      if (providers.copilot?.authType) setCopilotAuthType(providers.copilot.authType);
      if (providers.copilot?.model) setCopilotModel(providers.copilot.model);
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

  // Focus the path input without triggering browser auto-scroll.
  useEffect(() => {
    if (!changing) return;
    requestAnimationFrame(() => {
      pathInputRef.current?.focus({ preventScroll: true });
    });
  }, [changing]);

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
  useEffect(() => { writeText(CHAT_UI_PROVIDER_KEY, chatModelLabel.toLowerCase()); }, [chatModelLabel]);
  useEffect(() => {
    const selectedModel = chatModelLabel === 'Copilot'
      ? copilotModel
      : chatModelLabel === 'Codex'
        ? codexModel
        : localModel;
    writeText(CHAT_UI_MODEL_KEY, selectedModel);
  }, [chatModelLabel, copilotModel, codexModel, localModel]);
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

  async function handleSaveCopilotModel(nextModel = copilotModel) {
    setProviderBusy(true);
    setProviderMsg('');
    try {
      const r = await fetch(apiUrl('/api/providers/config'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          copilot: { model: nextModel },
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `Failed (${r.status})`);
      setProviderStatus(data.providers || null);
      setProviderMsg('Copilot model saved.');
    } catch (e) {
      setProviderMsg(e.message || 'Failed to save Copilot model.');
    } finally {
      setProviderBusy(false);
    }
  }

  async function handleSaveCodexAuth(nextModel = codexModel) {
    setProviderBusy(true);
    setProviderMsg('');
    try {
      const r = await fetch(apiUrl('/api/providers/config'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          codex: { model: nextModel },
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `Failed (${r.status})`);
      setProviderStatus(data.providers || null);
      setProviderMsg('Codex model saved.');
    } catch (e) {
      setProviderMsg(e.message || 'Failed to save Codex settings.');
    } finally {
      setProviderBusy(false);
    }
  }

  async function handleCodexLogin() {
    setCodexLoginBusy(true);
    setCodexLoginOutput('');
    setCodexLoginModalOpen(true);
    setCodexLoginStatus('Preparing secure device login...');
    setCodexLoginUrl('');
    setCodexLoginCode('');
    setCodexCodeCopied(false);

    const applyLoginText = (text) => {
      const next = String(text || '');
      setCodexLoginOutput(next);
      const parsed = parseCodexDeviceAuthInfo(next);
      if (parsed.verificationUrl) setCodexLoginUrl(parsed.verificationUrl);
      if (parsed.oneTimeCode) setCodexLoginCode(parsed.oneTimeCode);
      if (parsed.verificationUrl && parsed.oneTimeCode) {
        setCodexLoginBusy(false);
        setCodexLoginStatus('Waiting for you to finish sign-in in the browser...');
      }
    };

    try {
      const response = await fetch(apiUrl('/api/providers/codex/login'), { method: 'POST' });
      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        const compact = bodyText.replace(/\s+/g, ' ').trim();
        throw new Error(compact || `Login endpoint failed (${response.status}).`);
      }

      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      if (!contentType.includes('text/event-stream')) {
        const bodyText = await response.text().catch(() => '');
        throw new Error(bodyText.trim() || 'Login endpoint did not return an event stream.');
      }

      if (!response.body) throw new Error('No response stream.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let aggregate = '';
      let sawOutput = false;
      let sawDone = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'output') {
              sawOutput = true;
              aggregate += String(data.content || '');
              applyLoginText(aggregate);
            }
            if (data.type === 'error') {
              aggregate += `\nError: ${data.message}`;
              applyLoginText(aggregate);
              setCodexLoginStatus('Sign-in could not be started. See details below.');
            }
            if (data.type === 'done') {
              sawDone = true;
              if (Number(data.exitCode || 0) === 0) {
                setCodexLoginStatus('Login flow finished. Refreshing status...');
              } else {
                setCodexLoginStatus('Login ended early. You can try again.');
              }
              if (!sawOutput) {
                aggregate += '\nLogin flow ended without CLI output.';
                applyLoginText(aggregate);
              }
            }
          } catch (_) {}
        }
      }

      if (!sawOutput && !sawDone) {
        aggregate += '\nNo login events received from backend. Ensure PocketCode-Server is running the latest code and Codex CLI is installed.';
        applyLoginText(aggregate);
        setCodexLoginStatus('No login events received.');
      }
    } catch (e) {
      const next = `${codexLoginOutput}\nError: ${e.message}`.trim();
      applyLoginText(next);
      setCodexLoginStatus('Login request failed.');
    } finally {
      setCodexLoginBusy(false);
      fetchProviderStatus();
    }
  }

  async function copyCodexCodeToClipboard() {
    if (!codexLoginCode) return;
    try {
      const textToCopy = codexLoginCode.trim();
      let copied = false;

      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(textToCopy);
        copied = true;
      } else {
        const ta = document.createElement('textarea');
        ta.value = textToCopy;
        ta.setAttribute('readonly', 'true');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        copied = document.execCommand('copy');
        document.body.removeChild(ta);
      }

      if (!copied) throw new Error('copy failed');
      setCodexCodeCopied(true);
      setTimeout(() => setCodexCodeCopied(false), 1400);
      return true;
    } catch (_) {
      setCodexCodeCopied(false);
      return false;
    }
  }

  function handleSelectCodexCode() {
    const input = codexCodeInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }

  function handleOpenCodexLoginLink() {
    if (!codexLoginUrl) return;
    const opened = window.open(codexLoginUrl, '_blank', 'noopener,noreferrer');
    if (!opened) window.location.href = codexLoginUrl;
  }

  async function handleCopyAndOpenCodexLogin() {
    const copied = await copyCodexCodeToClipboard();
    if (!copied && codexCodeInputRef.current) {
      handleSelectCodexCode();
    }
    handleOpenCodexLoginLink();
  }

  async function handleCopilotLogin() {
    setCopilotLoginBusy(true);
    setCopilotLoginOutput('');
    setCopilotLoginModalOpen(true);
    setCopilotLoginStatus('Preparing secure device login...');
    setCopilotLoginUrl('');
    setCopilotLoginCode('');
    setCopilotCodeCopied(false);

    const applyLoginText = (text) => {
      const next = String(text || '');
      setCopilotLoginOutput(next);
      const parsed = parseCodexDeviceAuthInfo(next);
      if (parsed.verificationUrl) setCopilotLoginUrl(parsed.verificationUrl);
      if (parsed.oneTimeCode) setCopilotLoginCode(parsed.oneTimeCode);
      if (parsed.verificationUrl && parsed.oneTimeCode) {
        setCopilotLoginBusy(false);
        setCopilotLoginStatus('Waiting for you to finish sign-in in the browser...');
      }
    };

    try {
      const response = await fetch(apiUrl('/api/providers/copilot/login'), { method: 'POST' });
      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        const compact = bodyText.replace(/\s+/g, ' ').trim();
        throw new Error(compact || `Login endpoint failed (${response.status}).`);
      }

      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      if (!contentType.includes('text/event-stream')) {
        const bodyText = await response.text().catch(() => '');
        throw new Error(bodyText.trim() || 'Login endpoint did not return an event stream.');
      }

      if (!response.body) throw new Error('No response stream.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let aggregate = '';
      let sawOutput = false;
      let sawDone = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'output') {
              sawOutput = true;
              aggregate += String(data.content || '');
              applyLoginText(aggregate);
            }
            if (data.type === 'error') {
              aggregate += `\nError: ${data.message}`;
              applyLoginText(aggregate);
              setCopilotLoginStatus('Sign-in could not be started. See details below.');
            }
            if (data.type === 'done') {
              sawDone = true;
              if (Number(data.exitCode || 0) === 0) {
                setCopilotLoginStatus(data.reinitialized
                  ? 'Connected. Copilot provider is ready.'
                  : 'Connection finished. Refresh provider status to confirm.');
              } else {
                setCopilotLoginStatus('Login ended early. You can try again.');
              }
              if (!sawOutput) {
                aggregate += '\nLogin flow ended without CLI output.';
                applyLoginText(aggregate);
              }
            }
          } catch (_) {}
        }
      }

      if (!sawOutput && !sawDone) {
        aggregate += '\nNo login events received from backend. Ensure PocketCode-Server is running the latest code and GitHub CLI is installed (brew install gh).';
        applyLoginText(aggregate);
        setCopilotLoginStatus('No login events received.');
      }
    } catch (e) {
      const next = `${copilotLoginOutput}\nError: ${e.message}`.trim();
      setCopilotLoginOutput(next);
      setCopilotLoginStatus('Login request failed.');
    } finally {
      setCopilotLoginBusy(false);
      fetchProviderStatus();
    }
  }

  async function copyCopilotCodeToClipboard() {
    if (!copilotLoginCode) return false;
    try {
      const textToCopy = copilotLoginCode.trim();
      let copied = false;
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(textToCopy);
        copied = true;
      } else {
        const ta = document.createElement('textarea');
        ta.value = textToCopy;
        ta.setAttribute('readonly', 'true');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        copied = document.execCommand('copy');
        document.body.removeChild(ta);
      }
      if (!copied) throw new Error('copy failed');
      setCopilotCodeCopied(true);
      setTimeout(() => setCopilotCodeCopied(false), 1400);
      return true;
    } catch (_) {
      setCopilotCodeCopied(false);
      return false;
    }
  }

  function handleSelectCopilotCode() {
    const input = copilotCodeInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }

  function handleOpenCopilotLoginLink() {
    if (!copilotLoginUrl) return;
    const opened = window.open(copilotLoginUrl, '_blank', 'noopener,noreferrer');
    if (!opened) window.location.href = copilotLoginUrl;
  }

  async function handleCopyAndOpenCopilotLogin() {
    const copied = await copyCopilotCodeToClipboard();
    if (!copied && copilotCodeInputRef.current) {
      handleSelectCopilotCode();
    }
    handleOpenCopilotLoginLink();
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
                  ref={pathInputRef}
                  value={inputPath}
                  onChange={(e) => setInputPath(e.target.value)}
                  onFocus={preventScrollOnFocus}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleConfirmChange();
                    if (e.key === 'Escape') handleCancelChange();
                  }}
                  placeholder="/absolute/path/to/folder"
                  className="w-full px-3 py-2 rounded-lg text-sm text-vscode-text border border-vscode-border bg-transparent focus:outline-none focus:border-vscode-accent"
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
            <p className="text-sm text-vscode-text font-medium">Model</p>
            {chatModelLabel === 'Copilot' ? (
              <select
                value={copilotModel}
                onChange={(e) => {
                  const nextModel = e.target.value;
                  setCopilotModel(nextModel);
                  handleSaveCopilotModel(nextModel);
                }}
                className="mt-2 w-full px-3 py-2 rounded-lg text-sm text-vscode-text border border-vscode-border bg-transparent"
                style={{ outline: 'none' }}
              >
                <option value="claude-sonnet-4.5">Claude Sonnet 4.5 (default)</option>
                <option value="claude-sonnet-4">Claude Sonnet 4</option>
                <option value="gpt-5">GPT-5</option>
              </select>
            ) : chatModelLabel === 'Codex' ? (
              <select
                value={codexModel}
                onChange={(e) => {
                  const nextModel = e.target.value;
                  setCodexModel(nextModel);
                  handleSaveCodexAuth(nextModel);
                }}
                className="mt-2 w-full px-3 py-2 rounded-lg text-sm text-vscode-text border border-vscode-border bg-transparent"
                style={{ outline: 'none' }}
              >
                <optgroup label="Recommended">
                  <option value="gpt-5.4">gpt-5.4 — Flagship (default)</option>
                  <option value="gpt-5.4-mini">gpt-5.4-mini — Fast &amp; efficient</option>
                  <option value="gpt-5.3-codex">gpt-5.3-codex — Best coding</option>
                  <option value="gpt-5.3-codex-spark">gpt-5.3-codex-spark — Near-instant (Pro)</option>
                </optgroup>
                <optgroup label="Alternative">
                  <option value="gpt-5.2-codex">gpt-5.2-codex</option>
                  <option value="gpt-5.2">gpt-5.2</option>
                  <option value="gpt-5.1-codex-max">gpt-5.1-codex-max</option>
                  <option value="gpt-5.1-codex">gpt-5.1-codex</option>
                  <option value="gpt-5.1">gpt-5.1</option>
                  <option value="gpt-5-codex">gpt-5-codex</option>
                </optgroup>
              </select>
            ) : (
              <p className="mt-2 text-xs text-vscode-text-muted">Local models configured in provider settings.</p>
            )}
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
          Provider Connections
        </p>
        <div className="rounded-xl border border-vscode-border overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}>
          <div className="px-4 py-3 border-b border-vscode-border">
            <p className="text-sm text-vscode-text font-medium">Copilot (GitHub Copilot CLI)</p>
            <p className="text-xs text-vscode-text-muted mt-0.5">Connect via GitHub CLI (<code>gh</code>) or use a personal access token.</p>
            <div className="mt-2 grid grid-cols-1 gap-2">
              <select
                value={copilotAuthType}
                onChange={(e) => setCopilotAuthType(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm text-vscode-text border border-vscode-border bg-transparent"
                style={{ outline: 'none' }}
              >
                <option value="logged-in-user">User Login</option>
                <option value="token">Token</option>
              </select>
              {copilotAuthType === 'token' && (
                <input
                  type="password"
                  value={copilotToken}
                  onChange={(e) => setCopilotToken(e.target.value)}
                  onFocus={preventScrollOnFocus}
                  placeholder="GitHub token"
                  className="w-full px-3 py-2 rounded-lg text-sm text-vscode-text border border-vscode-border bg-transparent"
                  style={{ outline: 'none' }}
                />
              )}
              {copilotAuthType === 'logged-in-user' ? (
                <button
                  type="button"
                  onClick={handleCopilotLogin}
                  disabled={copilotLoginBusy}
                  className="w-full px-3 py-1.5 rounded-lg text-xs font-medium border border-vscode-border text-vscode-text cursor-pointer disabled:opacity-40"
                  style={{ background: 'transparent' }}
                >
                  {copilotLoginBusy ? 'Connecting...' : 'Connect Copilot'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSaveCopilotAuth}
                  disabled={providerBusy}
                  className="w-full px-3 py-1.5 rounded-lg text-xs font-medium border border-vscode-border text-vscode-text cursor-pointer disabled:opacity-40"
                  style={{ background: 'transparent' }}
                >
                  Save Token
                </button>
              )}
            </div>
            <p className="text-[11px] text-vscode-text-muted mt-2">
              Status: {providerStatus?.copilot?.ready ? 'Ready' : 'Not ready'}
              {providerStatus?.copilot?.authMode ? ` (${providerStatus.copilot.authMode})` : ''}
              {providerStatus?.copilot?.error ? ` - ${providerStatus.copilot.error}` : ''}
            </p>
          </div>

          <div className="px-4 py-3">
            <p className="text-sm text-vscode-text font-medium">Codex (OpenAI Codex CLI)</p>
            <p className="text-xs text-vscode-text-muted mt-0.5">
              Connect via the OpenAI Codex CLI device-auth flow or use an API key.
            </p>
            <div className="mt-2 grid grid-cols-1 gap-2">
              <select
                value={codexAuthType}
                onChange={(e) => setCodexAuthType(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm text-vscode-text border border-vscode-border bg-transparent"
                style={{ outline: 'none' }}
              >
                <option value="logged-in-user">User Login</option>
                <option value="api-key">API Key</option>
              </select>
              {codexAuthType === 'api-key' && (
                <input
                  type="password"
                  value={codexToken}
                  onChange={(e) => setCodexToken(e.target.value)}
                  onFocus={preventScrollOnFocus}
                  placeholder="OpenAI API key (placeholder)"
                  className="w-full px-3 py-2 rounded-lg text-sm text-vscode-text border border-vscode-border bg-transparent"
                  style={{ outline: 'none' }}
                />
              )}
              {codexAuthType === 'logged-in-user' ? (
                <button
                  type="button"
                  onClick={handleCodexLogin}
                  disabled={codexLoginBusy}
                  className="w-full px-3 py-1.5 rounded-lg text-xs font-medium border border-vscode-border text-vscode-text cursor-pointer disabled:opacity-40"
                  style={{ background: 'transparent' }}
                >
                  {codexLoginBusy ? 'Connecting...' : 'Connect Codex'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {/* Placeholder for API key save handler */}}
                  disabled={providerBusy}
                  className="w-full px-3 py-1.5 rounded-lg text-xs font-medium border border-vscode-border text-vscode-text cursor-pointer disabled:opacity-40"
                  style={{ background: 'transparent' }}
                >
                  Save API Key
                </button>
              )}
            </div>
            <p className="text-[11px] text-vscode-text-muted mt-2">
              CLI: {providerStatus?.codex?.cliInstalled ? 'Installed' : 'Not installed'}
              {' · '}
              Auth: {providerStatus?.codex?.authenticated ? 'Authenticated' : 'Not authenticated'}
              {' · '}
              Status: {providerStatus?.codex?.ready ? 'Ready' : 'Not ready'}
            </p>
            {!providerStatus?.codex?.cliInstalled && (
              <p className="text-[11px] text-vscode-text-muted mt-1">
                Install the Codex CLI: <code className="font-mono">npm install -g @openai/codex</code>
              </p>
            )}
          </div>

          <div className="px-4 py-3 border-t border-vscode-border">
            <p className="text-sm text-vscode-text font-medium">Local</p>
            <p className="text-xs text-vscode-text-muted mt-0.5">Point to your Local-Agent OpenAI-compatible endpoint and model.</p>
            <div className="mt-2 grid grid-cols-1 gap-2">
              <input
                type="password"
                value={localApiKey}
                onChange={(e) => setLocalApiKey(e.target.value)}
                onFocus={preventScrollOnFocus}
                placeholder="Optional API key"
                className="w-full px-3 py-2 rounded-lg text-sm text-vscode-text border border-vscode-border bg-transparent"
                style={{ outline: 'none' }}
              />
              <input
                type="text"
                value={localBaseUrl}
                onChange={(e) => setLocalBaseUrl(e.target.value)}
                onFocus={preventScrollOnFocus}
                placeholder="http://127.0.0.1:11434/v1"
                className="w-full px-3 py-2 rounded-lg text-sm text-vscode-text border border-vscode-border bg-transparent"
                style={{ outline: 'none' }}
              />
              <input
                type="text"
                value={localModel}
                onChange={(e) => setLocalModel(e.target.value)}
                onFocus={preventScrollOnFocus}
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

      {codexLoginModalOpen && (
        <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-3" onClick={() => !codexLoginBusy && setCodexLoginModalOpen(false)}>
          <div className="absolute inset-0 bg-black/70" />
          <div
            className="relative w-full max-w-2xl rounded-2xl border border-vscode-border bg-vscode-bg shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-vscode-border bg-vscode-sidebar/50 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-vscode-text">Connect Codex</p>
                <p className="text-xs text-vscode-text-muted mt-1">Complete this flow on your phone or in an in-app browser window.</p>
              </div>
              <button
                type="button"
                onClick={() => setCodexLoginModalOpen(false)}
                aria-label="Close sign-in popup"
                className="h-9 w-9 rounded-lg text-vscode-text/70 text-[26px] leading-none flex items-center justify-center transition-colors hover:text-vscode-text"
                style={{ background: 'transparent' }}
              >
                ×
              </button>
            </div>

            <div className="px-4 py-3 border-b border-vscode-border bg-vscode-sidebar/20">
              <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                <input
                  ref={codexCodeInputRef}
                  type="text"
                  readOnly
                  onClick={handleSelectCodexCode}
                  value={codexLoginCode || 'Waiting for code...'}
                  className="w-full px-3 py-1.5 rounded-lg border border-vscode-border bg-vscode-bg/80 text-sm text-center font-semibold tracking-wider text-vscode-text"
                  style={{ outline: 'none' }}
                />
                <button
                  type="button"
                  onClick={handleCopyAndOpenCodexLogin}
                  disabled={!codexLoginUrl}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border border-vscode-border text-vscode-text disabled:opacity-40"
                  style={{ background: 'transparent' }}
                >
                  {codexCodeCopied ? 'Copied' : 'Copy Code and Open Login'}
                </button>
              </div>

              {codexLoginUrl && (
                <p className="mt-2 text-[10px] text-vscode-text-muted break-all text-right">{codexLoginUrl}</p>
              )}
            </div>

            <div className="px-4 py-3">
              <div className="rounded-xl border border-vscode-border bg-vscode-sidebar/20 px-3 py-3 text-xs text-vscode-text-muted leading-relaxed">
                {codexLoginUrl
                  ? 'Tap "Copy Code and Open Login" to copy the code and open the secure OpenAI login page. Return here and keep this modal open while status updates.'
                  : 'Waiting for login URL and code from Codex...'}
              </div>

              {codexLoginStatus && (
                <p className="mt-2 text-[11px] text-vscode-text-muted">
                  {codexLoginStatus}
                </p>
              )}

              {codexLoginOutput && /error:/i.test(codexLoginOutput) && (
                <pre className="mt-2 rounded-xl border border-red-900/60 bg-red-900/20 px-3 py-2 text-[10px] text-red-300 whitespace-pre-wrap break-all max-h-28 overflow-auto">
                  {codexLoginOutput}
                </pre>
              )}
            </div>

            <div className="px-4 py-3 border-t border-vscode-border flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setCodexLoginModalOpen(false)}
                disabled={codexLoginBusy}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-vscode-border text-vscode-text disabled:opacity-40"
                style={{ background: 'transparent' }}
              >
                {codexLoginBusy ? 'Waiting...' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}

      {copilotLoginModalOpen && (
        <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-3" onClick={() => !copilotLoginBusy && setCopilotLoginModalOpen(false)}>
          <div className="absolute inset-0 bg-black/70" />
          <div
            className="relative w-full max-w-2xl rounded-2xl border border-vscode-border bg-vscode-bg shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-vscode-border bg-vscode-sidebar/50 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-vscode-text">Connect Copilot</p>
                <p className="text-xs text-vscode-text-muted mt-1">Complete this flow on your phone or in an in-app browser window.</p>
              </div>
              <button
                type="button"
                onClick={() => setCopilotLoginModalOpen(false)}
                aria-label="Close sign-in popup"
                className="h-9 w-9 rounded-lg text-vscode-text/70 text-[26px] leading-none flex items-center justify-center transition-colors hover:text-vscode-text"
                style={{ background: 'transparent' }}
              >
                ×
              </button>
            </div>

            <div className="px-4 py-3 border-b border-vscode-border bg-vscode-sidebar/20">
              <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                <input
                  ref={copilotCodeInputRef}
                  type="text"
                  readOnly
                  onClick={handleSelectCopilotCode}
                  value={copilotLoginCode || 'Waiting for code...'}
                  className="w-full px-3 py-1.5 rounded-lg border border-vscode-border bg-vscode-bg/80 text-sm text-center font-semibold tracking-wider text-vscode-text"
                  style={{ outline: 'none' }}
                />
                <button
                  type="button"
                  onClick={handleCopyAndOpenCopilotLogin}
                  disabled={!copilotLoginUrl}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border border-vscode-border text-vscode-text disabled:opacity-40"
                  style={{ background: 'transparent' }}
                >
                  {copilotCodeCopied ? 'Copied' : 'Copy Code and Open Login'}
                </button>
              </div>

              {copilotLoginUrl && (
                <p className="mt-2 text-[10px] text-vscode-text-muted break-all text-right">{copilotLoginUrl}</p>
              )}
            </div>

            <div className="px-4 py-3">
              <div className="rounded-xl border border-vscode-border bg-vscode-sidebar/20 px-3 py-3 text-xs text-vscode-text-muted leading-relaxed">
                {copilotLoginUrl
                  ? 'Tap "Copy Code and Open Login" to copy the code and open the GitHub device login page. Return here and keep this modal open while status updates.'
                  : 'Waiting for login URL and code from GitHub CLI...'}
              </div>

              {copilotLoginStatus && (
                <p className="mt-2 text-[11px] text-vscode-text-muted">
                  {copilotLoginStatus}
                </p>
              )}

              {copilotLoginOutput && /error:/i.test(copilotLoginOutput) && (
                <pre className="mt-2 rounded-xl border border-red-900/60 bg-red-900/20 px-3 py-2 text-[10px] text-red-300 whitespace-pre-wrap break-all max-h-28 overflow-auto">
                  {copilotLoginOutput}
                </pre>
              )}
            </div>

            <div className="px-4 py-3 border-t border-vscode-border flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setCopilotLoginModalOpen(false)}
                disabled={copilotLoginBusy}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-vscode-border text-vscode-text disabled:opacity-40"
                style={{ background: 'transparent' }}
              >
                {copilotLoginBusy ? 'Waiting...' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
