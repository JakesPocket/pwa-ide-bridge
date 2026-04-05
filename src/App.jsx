import { useEffect, useState } from 'react';
import Layout from './components/Layout';
import WorkspaceView from './components/WorkspaceView';
import EditorView from './components/EditorView';
import TerminalView from './components/TerminalView';
import AgentView from './components/AgentView';
import { apiUrl } from './config/server';
import { readJson, writeJson, removeItem, getStorage } from './utils/persist';
import SettingsView from './components/SettingsView';
import { useSwipeGesture } from './utils/useSwipeGesture';

const APP_STATE_KEY = 'pocketcode.app.state.v1';
const SESSION_SCHEMA_KEY = 'pocketcode.session.schema.v1';
const SESSION_SCHEMA_VERSION = '2';
const SESSION_KEYS = [
  APP_STATE_KEY,
  'pocketcode.workspace.activeSubTab.v1',
  'pocketcode.editor.fileContents.v1',
  'pocketcode.agent.messages.v1',
  'pocketcode.agent.input.v1',
  'pocketcode.agent.pendingReviewPaths.v1',
  'pocketcode.agent.ai.mode.v1',
  'pocketcode.agent.ai.provider.v1',
  'pocketcode.agent.ai.approval.v1',
  'pocketcode.agent.ai.execution.v1',
  'pocketcode.agent.ai.model.v1',
  'pocketcode.agent.turnAiMode.v1',
  'pocketcode.agent.turnProvider.v1',
  'pocketcode.agent.cloudJobs.v1',
  'pocketcode.agent.activeSubTab.v1',
  'pocketcode.terminal.scrollback.v1',
];
const VALID_TABS = new Set(['extensions', 'editor', 'ai-agent', 'terminal', 'settings']);
const TAB_ORDER = ['extensions', 'editor', 'ai-agent', 'terminal', 'settings'];

function summarizePatchCounts(patchText) {
  if (!patchText || typeof patchText !== 'string') {
    return { added: 0, removed: 0 };
  }

  let added = 0;
  let removed = 0;
  for (const line of patchText.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added += 1;
    else if (line.startsWith('-')) removed += 1;
  }

  return { added, removed };
}

function clearPersistedSession(storage) {
  for (const key of SESSION_KEYS) {
    storage.removeItem(key);
  }
}



function ensureSessionSchema(storage) {
  const current = storage.getItem(SESSION_SCHEMA_KEY);
  if (current === SESSION_SCHEMA_VERSION) {
    return;
  }
  clearPersistedSession(storage);
  storage.setItem(SESSION_SCHEMA_KEY, SESSION_SCHEMA_VERSION);
}

function hasAnySessionData(storage) {
  return SESSION_KEYS.some((key) => storage.getItem(key) !== null);
}

function readAppState() {
  const stored = readJson(APP_STATE_KEY, null);
  if (!stored || typeof stored !== 'object') {
    return {
      activeTab: 'ai-agent',
      openFiles: [],
      activeFilePath: null,
    };
  }

  const openFiles = Array.isArray(stored.openFiles)
    ? stored.openFiles
        .filter((f) => f && typeof f.path === 'string' && typeof f.name === 'string')
        .map((f) => ({
          path: f.path,
          name: f.name,
          diffAdded: Number.isFinite(f.diffAdded) ? f.diffAdded : 0,
          diffRemoved: Number.isFinite(f.diffRemoved) ? f.diffRemoved : 0,
        }))
    : [];

  const openSet = new Set(openFiles.map((f) => f.path));
  const activeFilePath =
    typeof stored.activeFilePath === 'string' && openSet.has(stored.activeFilePath)
      ? stored.activeFilePath
      : (openFiles[openFiles.length - 1]?.path ?? null);

  return {
    activeTab: VALID_TABS.has(stored.activeTab) ? stored.activeTab : 'ai-agent',
    openFiles,
    activeFilePath,
  };
}

function readInitialState() {
  const storage = getStorage();
  if (!storage) {
    return {
      activeTab: 'ai-agent',
      openFiles: [],
      activeFilePath: null,
      hasPersistedSession: false,
    };
  }

  ensureSessionSchema(storage);
  const appState = readAppState();

  return {
    ...appState,
    hasPersistedSession: hasAnySessionData(storage),
  };
}

function App() {
  const [initialState] = useState(() => readInitialState());
  const [activeTab, setActiveTab] = useState(initialState.activeTab);

  // Open files: [{ path, name }]
  const [openFiles, setOpenFiles] = useState(initialState.openFiles);
  // The path of the currently focused file.
  const [activeFilePath, setActiveFilePath] = useState(initialState.activeFilePath);
  const [workspaceEpoch, setWorkspaceEpoch] = useState(0);
  const [workspacePath, setWorkspacePath] = useState(null);
  const [diffByPath, setDiffByPath] = useState({});

  // Swipe gesture handlers for tab navigation
  const handleSwipeLeft = () => {
    const currentIndex = TAB_ORDER.indexOf(activeTab);
    if (currentIndex < TAB_ORDER.length - 1) {
      setActiveTab(TAB_ORDER[currentIndex + 1]);
    }
  };

  const handleSwipeRight = () => {
    const currentIndex = TAB_ORDER.indexOf(activeTab);
    if (currentIndex > 0) {
      setActiveTab(TAB_ORDER[currentIndex - 1]);
    }
  };

  const swipeRef = useSwipeGesture(handleSwipeLeft, handleSwipeRight, {
    minSwipeDistance: 60,
    maxVerticalDistance: 100,
  });

  useEffect(() => {
    fetch(apiUrl('/api/workspace'))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.path) setWorkspacePath(data.path);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    writeJson(APP_STATE_KEY, { activeTab, openFiles, activeFilePath });
  }, [activeTab, openFiles, activeFilePath]);

  function handleStartFresh() {
    const storage = getStorage();
    if (storage) {
      clearPersistedSession(storage);
      storage.setItem(SESSION_SCHEMA_KEY, SESSION_SCHEMA_VERSION);
    }

    setActiveTab('ai-agent');
    setOpenFiles([]);
    setActiveFilePath(null);

    // Child tabs (chat/terminal/editor) keep local in-memory state;
    // reload ensures a truly clean workspace reset.
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }

  async function handleWorkspaceChanged(nextWorkspacePath) {
    // Refresh tab views immediately so Explorer/Terminal/Chat re-bind to new workspace now.
    setWorkspaceEpoch((v) => v + 1);

    setWorkspacePath(nextWorkspacePath);

    // Keep workspace switching predictable: always close all open editor tabs.
    setOpenFiles([]);
    setActiveFilePath(null);
    setDiffByPath({});

    removeItem('pocketcode.agent.messages.v1');
    removeItem('pocketcode.agent.input.v1');
    removeItem('pocketcode.agent.pendingReviewPaths.v1');
    removeItem('pocketcode.agent.ai.mode.v1');
    removeItem('pocketcode.agent.ai.provider.v1');
    removeItem('pocketcode.agent.ai.approval.v1');
    removeItem('pocketcode.agent.ai.execution.v1');
    removeItem('pocketcode.agent.ai.model.v1');
    removeItem('pocketcode.agent.turnAiMode.v1');
    removeItem('pocketcode.agent.turnProvider.v1');
    removeItem('pocketcode.agent.cloudJobs.v1');
    removeItem('pocketcode.agent.activeSubTab.v1');
    removeItem('pocketcode.terminal.scrollback.v1');

    try {
      await fetch(apiUrl('/api/chat/reset'), { method: 'POST' });
    } catch (_) {
      // If chat reset fails, remounting chat still clears local client state.
    }
  }

  /** Open a file from the explorer, switching to the editor tab */
  function handleOpenFile(file) {
    setOpenFiles((prev) => {
      if (prev.find((f) => f.path === file.path)) return prev;
      return [...prev, file];
    });
    setActiveFilePath(file.path);
    setActiveTab('editor');
  }

  /** Close a file tab */
  function handleCloseFile(path) {
    setOpenFiles((prev) => {
      const next = prev.filter((f) => f.path !== path);
      if (activeFilePath === path) {
        setActiveFilePath(next.length ? next[next.length - 1].path : null);
      }
      return next;
    });
    setDiffByPath((prev) => {
      if (!prev[path]) return prev;
      const next = { ...prev };
      delete next[path];
      return next;
    });
  }

  function handleOpenDiffFiles(files) {
    if (!Array.isArray(files) || files.length === 0) return;

    const normalized = files
      .filter((f) => f && typeof f.path === 'string' && f.path.trim())
      .map((f) => {
        const path = f.path;
        const patch = typeof f.patch === 'string' ? f.patch : '';
        const fallback = summarizePatchCounts(patch);
        const countedAdded = Number.isFinite(f.added) ? f.added : 0;
        const countedRemoved = Number.isFinite(f.removed) ? f.removed : 0;
        return {
          path,
          name: path.split('/').pop() || path,
          diffAdded: countedAdded > 0 ? countedAdded : fallback.added,
          diffRemoved: countedRemoved > 0 ? countedRemoved : fallback.removed,
          patch,
        };
      });

    if (!normalized.length) return;

    setOpenFiles((prev) => {
      const byPath = new Map(prev.map((f) => [f.path, f]));
      for (const file of normalized) {
        byPath.set(file.path, {
          ...(byPath.get(file.path) || {}),
          path: file.path,
          name: file.name,
          diffAdded: file.diffAdded,
          diffRemoved: file.diffRemoved,
        });
      }
      return [...byPath.values()];
    });

    setDiffByPath((prev) => {
      const next = { ...prev };
      for (const file of normalized) {
        next[file.path] = {
          added: file.diffAdded,
          removed: file.diffRemoved,
          patch: file.patch,
        };
      }
      return next;
    });

    setActiveFilePath(normalized[0].path);
    setActiveTab('editor');
  }

  return (
    <>
      <Layout activeTab={activeTab} onTabChange={setActiveTab}>
        <div ref={swipeRef} className="h-full min-h-0">
          <div className={activeTab === 'extensions' ? 'h-full min-h-0' : 'hidden h-full min-h-0'}>
            <WorkspaceView key={`workspace-${workspaceEpoch}`} onOpenFile={handleOpenFile} />
          </div>
          <div className={activeTab === 'editor' ? 'h-full min-h-0' : 'hidden h-full min-h-0'}>
            <EditorView
              key={`editor-${workspaceEpoch}`}
              openFiles={openFiles}
              activeFilePath={activeFilePath}
              diffByPath={diffByPath}
              onSelectFile={setActiveFilePath}
              onCloseFile={handleCloseFile}
            />
          </div>
          <div className={activeTab === 'terminal' ? 'h-full min-h-0' : 'hidden h-full min-h-0'}>
            <TerminalView key={`terminal-${workspaceEpoch}`} />
          </div>
          <div className={activeTab === 'ai-agent' ? 'h-full min-h-0' : 'hidden h-full min-h-0'}>
            <AgentView key={`chat-${workspaceEpoch}`} onOpenDiffFiles={handleOpenDiffFiles} />
          </div>
          <div className={activeTab === 'settings' ? 'h-full min-h-0' : 'hidden h-full min-h-0'}>
            <SettingsView onClearCache={handleStartFresh} onWorkspaceChanged={handleWorkspaceChanged} />
          </div>
        </div>
      </Layout>

    </>
  );
}

export default App;
