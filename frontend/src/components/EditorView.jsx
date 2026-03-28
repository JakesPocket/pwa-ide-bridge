import { useEffect, useMemo, useRef, useState } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import { history, undo, redo, undoDepth, redoDepth } from '@codemirror/commands';
import {
  EditorView as CodeMirrorView,
  drawSelection,
  crosshairCursor,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
} from '@codemirror/view';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { oneDark } from '@codemirror/theme-one-dark';
import { apiUrl } from '../config/server';
import { readJson, writeJson } from '../utils/persist';

const EDITOR_CONTENTS_KEY = 'pocketide.editor.fileContents.v1';

function readInitialFileContents() {
  const stored = readJson(EDITOR_CONTENTS_KEY, {});
  if (!stored || typeof stored !== 'object') return {};

  const next = {};
  for (const [path, value] of Object.entries(stored)) {
    if (typeof path !== 'string') continue;
    if (typeof value === 'string' || value === null) {
      next[path] = value;
    }
  }
  return next;
}

function IconClose() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round"
      className="w-3 h-3" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-vscode-text-muted select-none">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25"
        strokeLinecap="round" strokeLinejoin="round" className="w-14 h-14 opacity-30">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="8" y1="13" x2="16" y2="13" />
        <line x1="8" y1="17" x2="16" y2="17" />
      </svg>
      <p className="text-sm opacity-50">Open a file from the Workspace</p>
    </div>
  );
}

export default function EditorView({ openFiles, activeFilePath, onSelectFile, onCloseFile }) {
  const [fileContents, setFileContents] = useState(() => readInitialFileContents()); // path → local editor content
  const [serverContents, setServerContents] = useState({}); // path → last fetched server content
  const [loadingPath, setLoadingPath] = useState(null);
  const [errorPath, setErrorPath] = useState(null);
  const [editModeByPath, setEditModeByPath] = useState({}); // path -> boolean
  const [saveBusyByPath, setSaveBusyByPath] = useState({}); // path -> boolean
  const [saveErrorByPath, setSaveErrorByPath] = useState({}); // path -> string
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [editModeMessage, setEditModeMessage] = useState(''); // tmp msg when undo/redo clicked in view mode

  const editorHostRef = useRef(null);
  const editorViewRef = useRef(null);
  const editabilityCompartmentRef = useRef(new Compartment());
  const sessionsRef = useRef(new Map()); // path -> { state, scrollTop, scrollLeft }
  const activePathRef = useRef(activeFilePath);
  const fileContentsRef = useRef(fileContents);
  const serverContentsRef = useRef(serverContents);
  const pollingBusyRef = useRef(false);
  const editModeMessageTimerRef = useRef(null);

  useEffect(() => {
    fileContentsRef.current = fileContents;
  }, [fileContents]);

  useEffect(() => {
    writeJson(EDITOR_CONTENTS_KEY, fileContents);
  }, [fileContents]);

  useEffect(() => {
    serverContentsRef.current = serverContents;
  }, [serverContents]);

  const languageExtensionForPath = useMemo(() => {
    return (filePath) => {
      const lower = filePath.toLowerCase();
      if (lower.endsWith('.py')) return python();
      if (lower.endsWith('.html') || lower.endsWith('.htm')) return html();
      if (
        lower.endsWith('.js') ||
        lower.endsWith('.jsx') ||
        lower.endsWith('.mjs') ||
        lower.endsWith('.cjs') ||
        lower.endsWith('.ts') ||
        lower.endsWith('.tsx')
      ) {
        return javascript({ typescript: lower.endsWith('.ts') || lower.endsWith('.tsx') });
      }
      return javascript({ jsx: true });
    };
  }, []);

  function isPathEditMode(path) {
    if (!path) return false;
    return editModeByPath[path] ?? false;
  }

  function updateHistoryAvailability(state) {
    setCanUndo(undoDepth(state) > 0);
    setCanRedo(redoDepth(state) > 0);
  }

  function createEditorState(filePath, doc) {
    return EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        drawSelection(),
        crosshairCursor(),
        history(),
        oneDark,
        languageExtensionForPath(filePath),
        editabilityCompartmentRef.current.of([
          EditorState.readOnly.of(!isPathEditMode(filePath)),
          CodeMirrorView.editable.of(isPathEditMode(filePath)),
        ]),
        CodeMirrorView.lineWrapping,
        CodeMirrorView.updateListener.of((update) => {
          const currentPath = activePathRef.current;
          if (!currentPath) return;

          // Persist full CodeMirror view state (selection + history + scroll) per file tab.
          sessionsRef.current.set(currentPath, {
            state: update.state,
            scrollTop: update.view.scrollDOM.scrollTop,
            scrollLeft: update.view.scrollDOM.scrollLeft,
          });

          updateHistoryAvailability(update.state);

          if (!update.docChanged) return;

          const next = update.state.doc.toString();
          setFileContents((prev) => {
            if (prev[currentPath] === next) return prev;
            return { ...prev, [currentPath]: next };
          });
        }),
      ],
    });
  }

  function saveSessionForPath(path) {
    const view = editorViewRef.current;
    if (!view || !path) return;
    sessionsRef.current.set(path, {
      state: view.state,
      scrollTop: view.scrollDOM.scrollTop,
      scrollLeft: view.scrollDOM.scrollLeft,
    });
  }

  function restoreSessionForPath(path) {
    const view = editorViewRef.current;
    if (!view || !path) return;

    const existing = sessionsRef.current.get(path);
    const targetState = existing?.state ?? createEditorState(path, fileContentsRef.current[path] ?? '');

    if (!existing) {
      sessionsRef.current.set(path, { state: targetState, scrollTop: 0, scrollLeft: 0 });
    }

    if (view.state !== targetState) {
      view.setState(targetState);
      updateHistoryAvailability(targetState);
    }

    const targetScrollTop = existing?.scrollTop ?? 0;
    const targetScrollLeft = existing?.scrollLeft ?? 0;

    requestAnimationFrame(() => {
      if (!editorViewRef.current) return;
      editorViewRef.current.scrollDOM.scrollTop = targetScrollTop;
      editorViewRef.current.scrollDOM.scrollLeft = targetScrollLeft;
    });
  }

  // Create the CodeMirror view once.
  useEffect(() => {
    if (!editorHostRef.current || editorViewRef.current) return;

    editorViewRef.current = new CodeMirrorView({
      state: createEditorState(activeFilePath || '/untitled.js', ''),
      parent: editorHostRef.current,
    });

    updateHistoryAvailability(editorViewRef.current.state);

    return () => {
      saveSessionForPath(activePathRef.current);
      editorViewRef.current?.destroy();
      editorViewRef.current = null;
      if (editModeMessageTimerRef.current) {
        clearTimeout(editModeMessageTimerRef.current);
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch file content whenever a new activeFilePath appears that we haven't loaded yet
  useEffect(() => {
    if (!activeFilePath) return;
    if (fileContents[activeFilePath] !== undefined) return; // already loaded

    setLoadingPath(activeFilePath);
    setErrorPath(null);

    fetch(apiUrl(`/api/file?path=${encodeURIComponent(activeFilePath)}`))
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.text();
      })
      .then((text) => {
        setFileContents((prev) => ({ ...prev, [activeFilePath]: text }));
        setServerContents((prev) => ({ ...prev, [activeFilePath]: text }));
      })
      .catch((e) => {
        setFileContents((prev) => ({ ...prev, [activeFilePath]: null }));
        setErrorPath(activeFilePath);
        console.error('EditorView fetch error:', e);
      })
      .finally(() => setLoadingPath(null));
  }, [activeFilePath]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep local maps/sessions clean when tabs are closed.
  useEffect(() => {
    const openPathSet = new Set(openFiles.map((f) => f.path));

    setFileContents((prev) => {
      const next = {};
      for (const [path, text] of Object.entries(prev)) {
        if (openPathSet.has(path)) next[path] = text;
      }
      return next;
    });

    setServerContents((prev) => {
      const next = {};
      for (const [path, text] of Object.entries(prev)) {
        if (openPathSet.has(path)) next[path] = text;
      }
      return next;
    });

    for (const path of [...sessionsRef.current.keys()]) {
      if (!openPathSet.has(path)) sessionsRef.current.delete(path);
    }

    setEditModeByPath((prev) => {
      const next = {};
      for (const [path, value] of Object.entries(prev)) {
        if (openPathSet.has(path)) next[path] = value;
      }
      return next;
    });

    setSaveBusyByPath((prev) => {
      const next = {};
      for (const [path, value] of Object.entries(prev)) {
        if (openPathSet.has(path)) next[path] = value;
      }
      return next;
    });

    setSaveErrorByPath((prev) => {
      const next = {};
      for (const [path, value] of Object.entries(prev)) {
        if (openPathSet.has(path)) next[path] = value;
      }
      return next;
    });
  }, [openFiles]);

  // Switch CodeMirror session whenever active file tab changes.
  useEffect(() => {
    if (!editorViewRef.current) return;

    const previousPath = activePathRef.current;
    const activeContent = activeFilePath ? fileContents[activeFilePath] : undefined;

    if (previousPath && previousPath !== activeFilePath) {
      saveSessionForPath(previousPath);
    }

    activePathRef.current = activeFilePath;

    if (!activeFilePath) return;
    if (activeContent === undefined || activeContent === null) return;

    const isTabSwitch = previousPath !== activeFilePath;
    const hasSession = sessionsRef.current.has(activeFilePath);

    if (isTabSwitch || !hasSession) {
      restoreSessionForPath(activeFilePath);
    }
  }, [activeFilePath, fileContents]); // eslint-disable-line react-hooks/exhaustive-deps

  // If content changes externally (e.g. AI refactor on disk), patch active editor doc live.
  useEffect(() => {
    const view = editorViewRef.current;
    if (!view || !activeFilePath) return;

    const incoming = fileContents[activeFilePath];
    if (incoming === undefined || incoming === null) return;

    const currentDoc = view.state.doc.toString();
    if (incoming === currentDoc) return;

    // External sync should replace stale history so Undo only tracks
    // user edits for the current in-memory version of this file.
    const scrollTop = view.scrollDOM.scrollTop;
    const scrollLeft = view.scrollDOM.scrollLeft;

    const nextState = createEditorState(activeFilePath, incoming);
    view.setState(nextState);
    updateHistoryAvailability(nextState);

    sessionsRef.current.set(activeFilePath, {
      state: nextState,
      scrollTop,
      scrollLeft,
    });

    requestAnimationFrame(() => {
      if (!editorViewRef.current) return;
      editorViewRef.current.scrollDOM.scrollTop = scrollTop;
      editorViewRef.current.scrollDOM.scrollLeft = scrollLeft;
    });
  }, [activeFilePath, fileContents]);

  useEffect(() => {
    const view = editorViewRef.current;
    if (!view) return;

    const currentPath = activePathRef.current;
    const editable = isPathEditMode(currentPath);

    view.dispatch({
      effects: editabilityCompartmentRef.current.reconfigure([
        EditorState.readOnly.of(!editable),
        CodeMirrorView.editable.of(editable),
      ]),
    });

    updateHistoryAvailability(view.state);
  }, [activeFilePath, editModeByPath]);

  // Poll open files to reflect external edits made by the AI agent.
  useEffect(() => {
    if (openFiles.length === 0) return;

    const interval = setInterval(async () => {
      if (pollingBusyRef.current) return;
      pollingBusyRef.current = true;

      try {
        for (const file of openFiles) {
          const path = file.path;

          const response = await fetch(apiUrl(`/api/file?path=${encodeURIComponent(path)}`));
          if (!response.ok) continue;

          const text = await response.text();
          const previousServer = serverContentsRef.current[path];

          if (previousServer === undefined) {
            setServerContents((prev) => ({ ...prev, [path]: text }));
            continue;
          }

          if (text !== previousServer) {
            setServerContents((prev) => ({ ...prev, [path]: text }));
            setFileContents((prev) => ({ ...prev, [path]: text }));
          }
        }
      } catch (err) {
        console.warn('EditorView polling warning:', err);
      } finally {
        pollingBusyRef.current = false;
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [openFiles]);

  const activeFile = openFiles.find((f) => f.path === activeFilePath);
  const content = activeFilePath ? fileContents[activeFilePath] : undefined;
  const isLoading = loadingPath === activeFilePath;
  const hasError = errorPath === activeFilePath;
  const isEditMode = activeFilePath ? (editModeByPath[activeFilePath] ?? false) : false;
  const saveBusy = activeFilePath ? Boolean(saveBusyByPath[activeFilePath]) : false;
  const saveError = activeFilePath ? (saveErrorByPath[activeFilePath] ?? '') : '';
  const isDirty = Boolean(
    activeFilePath
    && fileContents[activeFilePath] !== undefined
    && fileContents[activeFilePath] !== null
    && serverContents[activeFilePath] !== undefined
    && fileContents[activeFilePath] !== serverContents[activeFilePath]
  );

  function handleUndoClick() {
    if (!isEditMode) {
      setEditModeMessage('Must be in edit mode to undo');
      if (editModeMessageTimerRef.current) clearTimeout(editModeMessageTimerRef.current);
      editModeMessageTimerRef.current = setTimeout(() => {
        setEditModeMessage('');
        editModeMessageTimerRef.current = null;
      }, 2500);
      return;
    }
    const view = editorViewRef.current;
    if (!view) return;
    undo(view);
  }

  function handleRedoClick() {
    if (!isEditMode) {
      setEditModeMessage('Must be in edit mode to redo');
      if (editModeMessageTimerRef.current) clearTimeout(editModeMessageTimerRef.current);
      editModeMessageTimerRef.current = setTimeout(() => {
        setEditModeMessage('');
        editModeMessageTimerRef.current = null;
      }, 2500);
      return;
    }
    const view = editorViewRef.current;
    if (!view) return;
    redo(view);
  }

  async function handleToggleEditSave() {
    if (!activeFilePath || isLoading || hasError) return;

    const currentPath = activeFilePath;

    setSaveErrorByPath((prev) => ({ ...prev, [currentPath]: '' }));

    if (!isEditMode) {
      if (editModeMessageTimerRef.current) {
        clearTimeout(editModeMessageTimerRef.current);
        editModeMessageTimerRef.current = null;
      }
      setEditModeMessage('');
      setEditModeByPath((prev) => ({ ...prev, [currentPath]: true }));
      return;
    }

    if (!isDirty) {
      setEditModeByPath((prev) => ({ ...prev, [currentPath]: false }));
      return;
    }

    const nextContent = fileContents[currentPath];
    if (typeof nextContent !== 'string') return;

    setSaveBusyByPath((prev) => ({ ...prev, [currentPath]: true }));
    try {
      const response = await fetch(apiUrl('/api/file'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: currentPath, content: nextContent }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setSaveErrorByPath((prev) => ({
          ...prev,
          [currentPath]: payload.error || `Failed to save (${response.status})`,
        }));
        return;
      }

      setServerContents((prev) => ({ ...prev, [currentPath]: nextContent }));
      setEditModeByPath((prev) => ({ ...prev, [currentPath]: false }));
    } catch (_) {
      setSaveErrorByPath((prev) => ({ ...prev, [currentPath]: 'Could not save file' }));
    } finally {
      setSaveBusyByPath((prev) => ({ ...prev, [currentPath]: false }));
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* ── Horizontal-scrolling open-file tab bar ── */}
      {openFiles.length > 0 && (
        <div
          className="no-scrollbar flex shrink-0 overflow-x-auto border-b border-vscode-border"
          style={{ backgroundColor: 'var(--color-vscode-bg)' }}
        >
          {openFiles.map((file) => {
            const isActive = file.path === activeFilePath;
            return (
              <div
                key={file.path}
                className={[
                  'flex items-center gap-2 px-3 shrink-0 cursor-pointer',
                  'min-h-[34px] border-r border-vscode-border transition-colors',
                  'text-xs select-none',
                  isActive
                    ? 'text-vscode-text border-t-2 border-t-vscode-accent'
                    : 'text-vscode-text-muted hover:text-vscode-text hover:bg-vscode-sidebar',
                ].join(' ')}
                style={{
                  backgroundColor: isActive
                    ? 'var(--color-vscode-tab-active)'
                    : 'transparent',
                }}
                onClick={() => onSelectFile(file.path)}
              >
                <span className="truncate max-w-[120px]">{file.name}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseFile(file.path);
                  }}
                  aria-label={`Close ${file.name}`}
                  style={{ background: 'none', border: 'none', outline: 'none' }}
                  className="flex items-center justify-center w-5 h-5 rounded
                             text-vscode-text-muted hover:text-vscode-text
                             hover:bg-vscode-sidebar cursor-pointer transition-colors shrink-0"
                >
                  <IconClose />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {openFiles.length > 0 && (
        <div
          className="flex items-center justify-between px-2 py-1.5 border-b border-vscode-border shrink-0"
          style={{ backgroundColor: 'var(--color-vscode-sidebar)' }}
        >
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleUndoClick}
              disabled={!canUndo}
              className={[
                'px-2 py-1 rounded text-xs border-none transition-colors',
                canUndo
                  ? 'text-vscode-text hover:bg-vscode-sidebar-hover cursor-pointer'
                  : 'text-vscode-text-muted opacity-50 cursor-not-allowed',
              ].join(' ')}
              style={{ background: 'transparent' }}
            >
              Undo
            </button>
            <button
              type="button"
              onClick={handleRedoClick}
              disabled={!canRedo}
              className={[
                'px-2 py-1 rounded text-xs border-none transition-colors',
                canRedo
                  ? 'text-vscode-text hover:bg-vscode-sidebar-hover cursor-pointer'
                  : 'text-vscode-text-muted opacity-50 cursor-not-allowed',
              ].join(' ')}
              style={{ background: 'transparent' }}
            >
              Redo
            </button>
          </div>

          <div className="flex items-center gap-2">
            {editModeMessage && (
              <span className="text-[11px] text-amber-400">{editModeMessage}</span>
            )}
            {saveError && (
              <span className="text-[11px] text-red-400">{saveError}</span>
            )}
            {isDirty && isEditMode && !saveError && (
              <span className="text-[11px] text-vscode-text-muted">Unsaved</span>
            )}
            <button
              type="button"
              onClick={handleToggleEditSave}
              disabled={!activeFilePath || isLoading || hasError || saveBusy}
              className={[
                'px-2.5 py-1 rounded text-xs font-medium border cursor-pointer transition-colors',
                (!activeFilePath || isLoading || hasError || saveBusy)
                  ? 'opacity-50 cursor-not-allowed border-vscode-border text-vscode-text-muted'
                  : (isEditMode
                    ? 'bg-vscode-accent text-white border-transparent'
                    : 'bg-transparent text-vscode-text border-vscode-border hover:bg-vscode-sidebar-hover'),
              ].join(' ')}
            >
              {saveBusy ? 'Saving...' : (isEditMode ? 'Save' : 'Edit')}
            </button>
          </div>
        </div>
      )}

      {/* ── Editor body ── */}
      <div className="flex-1 overflow-auto">
        {openFiles.length === 0 && <EmptyState />}

        {openFiles.length > 0 && isLoading && (
          <div className="flex items-center gap-2 p-4 text-vscode-text-muted text-sm">
            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 11-6.22-8.56" strokeLinecap="round" />
            </svg>
            Loading {activeFile?.name}…
          </div>
        )}

        {openFiles.length > 0 && hasError && (
          <p className="p-4 text-sm text-red-400">
            Failed to load {activeFile?.name}.
          </p>
        )}

        <div
          className={[
            'h-full min-h-0',
            openFiles.length > 0 && !isLoading && !hasError && content !== undefined ? '' : 'hidden',
          ].join(' ')}
        >
          <div ref={editorHostRef} className="editor-cm-shell h-full" />
        </div>
      </div>
    </div>
  );
}
