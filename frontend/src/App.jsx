import { useEffect, useState } from 'react';
import Layout from './components/Layout';
import WorkspaceView from './components/WorkspaceView';
import EditorView from './components/EditorView';
import TerminalView from './components/TerminalView';
import Chat from './Chat';
import { apiUrl } from './config/server';
import { readJson, writeJson } from './utils/persist';
import SettingsView from './components/SettingsView';

const APP_STATE_KEY = 'pocketide.app.state.v1';
const SESSION_SCHEMA_KEY = 'pocketide.session.schema.v1';
const SESSION_SCHEMA_VERSION = '1';
const SESSION_KEYS = [
  APP_STATE_KEY,
  'pocketide.extensions.activeSubTab.v1',
  'pocketide.editor.fileContents.v1',
  'pocketide.chat.messages.v1',
  'pocketide.chat.input.v1',
  'pocketide.terminal.scrollback.v1',
];
const VALID_TABS = new Set(['extensions', 'editor', 'ai-chat', 'terminal', 'settings']);

function clearPersistedSession(storage) {
  for (const key of SESSION_KEYS) {
    storage.removeItem(key);
  }
}

function getStorage() {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

function ensureSessionSchema(storage) {
  const current = storage.getItem(SESSION_SCHEMA_KEY);
  if (current === SESSION_SCHEMA_VERSION) return;
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
      activeTab: 'editor',
      openFiles: [],
      activeFilePath: null,
    };
  }

  const openFiles = Array.isArray(stored.openFiles)
    ? stored.openFiles
        .filter((f) => f && typeof f.path === 'string' && typeof f.name === 'string')
        .map((f) => ({ path: f.path, name: f.name }))
    : [];

  const openSet = new Set(openFiles.map((f) => f.path));
  const activeFilePath =
    typeof stored.activeFilePath === 'string' && openSet.has(stored.activeFilePath)
      ? stored.activeFilePath
      : (openFiles[openFiles.length - 1]?.path ?? null);

  return {
    activeTab: VALID_TABS.has(stored.activeTab) ? stored.activeTab : 'editor',
    openFiles,
    activeFilePath,
  };
}

function readInitialState() {
  const storage = getStorage();
  if (!storage) {
    return {
      activeTab: 'editor',
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

    setActiveTab('editor');
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

    const storage = getStorage();
    if (storage) {
      storage.removeItem('pocketide.chat.messages.v1');
      storage.removeItem('pocketide.chat.input.v1');
      storage.removeItem('pocketide.terminal.scrollback.v1');
    }

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
  }

  return (
    <>
      <Layout activeTab={activeTab} onTabChange={setActiveTab}>
        <div className={activeTab === 'extensions' ? 'h-full' : 'hidden h-full'}>
          <WorkspaceView key={`workspace-${workspaceEpoch}`} onOpenFile={handleOpenFile} />
        </div>
        <div className={activeTab === 'editor' ? 'h-full' : 'hidden h-full'}>
          <EditorView
            key={`editor-${workspaceEpoch}`}
            openFiles={openFiles}
            activeFilePath={activeFilePath}
            onSelectFile={setActiveFilePath}
            onCloseFile={handleCloseFile}
          />
        </div>
        <div className={activeTab === 'terminal' ? 'h-full' : 'hidden h-full'}>
          <TerminalView key={`terminal-${workspaceEpoch}`} />
        </div>
        <div className={activeTab === 'ai-chat' ? 'h-full' : 'hidden h-full'}>
          <Chat key={`chat-${workspaceEpoch}`} />
        </div>
        <div className={activeTab === 'settings' ? 'h-full' : 'hidden h-full'}>
          <SettingsView onClearCache={handleStartFresh} onWorkspaceChanged={handleWorkspaceChanged} />
        </div>
      </Layout>

    </>
  );
}

export default App;
