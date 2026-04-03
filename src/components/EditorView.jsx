import { useEffect, useMemo, useRef, useState } from 'react';
import { Compartment, EditorState, RangeSetBuilder, StateField } from '@codemirror/state';
import { history, undo, redo, undoDepth, redoDepth } from '@codemirror/commands';
import {
  EditorView as CodeMirrorView,
  drawSelection,
  crosshairCursor,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  Decoration,
  GutterMarker,
  gutterLineClass,
} from '@codemirror/view';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { oneDark } from '@codemirror/theme-one-dark';
import { apiUrl } from '../config/server';
import { readJson, writeJson } from '../utils/persist';

const EDITOR_CONTENTS_KEY = 'pocketcode.editor.fileContents.v1';

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

function summarizeDiffLineRanges(lineNumbers) {
  const sorted = [...lineNumbers].sort((a, b) => a - b);
  const ranges = [];
  for (const lineNo of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && lineNo === last.end + 1) {
      last.end = lineNo;
    } else {
      ranges.push({ start: lineNo, end: lineNo });
    }
  }
  return ranges;
}

class DiffAddedGutterMarker extends GutterMarker {
  get elementClass() { return 'cm-file-diff-added-gutter'; }
}

class DiffRemovedGutterMarker extends GutterMarker {
  get elementClass() { return 'cm-file-diff-removed-gutter'; }
}

const ADDED_GUTTER_MARKER = new DiffAddedGutterMarker();
const REMOVED_GUTTER_MARKER = new DiffRemovedGutterMarker();

function buildOverviewMarkers(patchText, maxDocLines) {
  if (!patchText || typeof patchText !== 'string' || maxDocLines < 1) return [];

  const added = new Set();
  const removedAnchors = new Set();
  const lines = patchText.split('\n');
  let i = 0;

  while (i < lines.length) {
    const header = lines[i].match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
    if (!header) {
      i += 1;
      continue;
    }

    let newLineNo = parseInt(header[3], 10) || 1;
    i += 1;

    while (i < lines.length && !lines[i].startsWith('@@ ')) {
      const line = lines[i] || '';
      if (line.startsWith('+') && !line.startsWith('+++')) {
        if (newLineNo >= 1 && newLineNo <= maxDocLines) added.add(newLineNo);
        newLineNo += 1;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        const anchor = Math.min(Math.max(1, newLineNo), maxDocLines);
        if (anchor >= 1 && anchor <= maxDocLines) removedAnchors.add(anchor);
      } else if (line.startsWith(' ')) {
        newLineNo += 1;
      }
      i += 1;
    }
  }

  const markers = [];
  for (const range of summarizeDiffLineRanges(added)) {
    const top = ((range.start - 1) / maxDocLines) * 100;
    const height = Math.max(((range.end - range.start + 1) / maxDocLines) * 100, 0.6);
    markers.push({ top, height, kind: 'added' });
  }
  for (const range of summarizeDiffLineRanges(removedAnchors)) {
    const top = ((range.start - 1) / maxDocLines) * 100;
    const height = Math.max(((range.end - range.start + 1) / maxDocLines) * 100, 0.6);
    markers.push({ top, height, kind: 'removed' });
  }

  return markers.sort((a, b) => a.top - b.top);
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

export default function EditorView({ openFiles, activeFilePath, diffByPath = {}, onSelectFile, onCloseFile }) {
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
  const diffHighlightCompartmentRef = useRef(new Compartment());
  const sessionsRef = useRef(new Map()); // path -> { state, scrollTop, scrollLeft }
  const activePathRef = useRef(activeFilePath);
  const fileContentsRef = useRef(fileContents);
  const serverContentsRef = useRef(serverContents);
  const diffByPathRef = useRef({});
  const pollingBusyRef = useRef(false);
  const editModeMessageTimerRef = useRef(null);

  function parsePatchLineHighlights(patchText, maxDocLines) {
    const added = new Set();
    const removedAnchors = new Set();
    if (!patchText || typeof patchText !== 'string') {
      return { added, removedAnchors };
    }

    const lines = patchText.split('\n');
    let i = 0;
    while (i < lines.length) {
      const header = lines[i].match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
      if (!header) {
        i += 1;
        continue;
      }

      let newLineNo = parseInt(header[3], 10) || 1;
      i += 1;

      while (i < lines.length && !lines[i].startsWith('@@ ')) {
        const line = lines[i] || '';
        if (line.startsWith('+') && !line.startsWith('+++')) {
          if (newLineNo >= 1 && newLineNo <= maxDocLines) added.add(newLineNo);
          newLineNo += 1;
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          const anchor = Math.min(Math.max(1, newLineNo), maxDocLines);
          if (anchor >= 1 && anchor <= maxDocLines) removedAnchors.add(anchor);
        } else if (line.startsWith(' ')) {
          newLineNo += 1;
        }
        i += 1;
      }
    }

    return { added, removedAnchors };
  }

  function createDiffDecorationField(patchText) {
    const buildDecorations = (doc) => {
      const builder = new RangeSetBuilder();
      const { added, removedAnchors } = parsePatchLineHighlights(patchText, doc.lines);

      for (const lineNo of added) {
        const line = doc.line(lineNo);
        builder.add(line.from, line.from, Decoration.line({ attributes: { class: 'cm-file-diff-added' } }));
      }

      for (const lineNo of removedAnchors) {
        const line = doc.line(lineNo);
        builder.add(line.from, line.from, Decoration.line({ attributes: { class: 'cm-file-diff-removed' } }));
      }

      return builder.finish();
    };

    return StateField.define({
      create(state) {
        return buildDecorations(state.doc);
      },
      update(decorations, tr) {
        if (tr.docChanged) return buildDecorations(tr.state.doc);
        return decorations;
      },
      provide(field) {
        return CodeMirrorView.decorations.from(field);
      },
    });
  }

  function createDiffGutterField(patchText) {
    const buildMarkers = (doc) => {
      const builder = new RangeSetBuilder();
      const { added, removedAnchors } = parsePatchLineHighlights(patchText, doc.lines);

      for (const lineNo of added) {
        const line = doc.line(lineNo);
        builder.add(line.from, line.from, ADDED_GUTTER_MARKER);
      }

      for (const lineNo of removedAnchors) {
        const line = doc.line(lineNo);
        builder.add(line.from, line.from, REMOVED_GUTTER_MARKER);
      }

      return builder.finish();
    };

    return StateField.define({
      create(state) {
        return buildMarkers(state.doc);
      },
      update(markers, tr) {
        if (tr.docChanged) return buildMarkers(tr.state.doc);
        return markers;
      },
      provide(field) {
        return gutterLineClass.from(field);
      },
    });
  }

  function buildDiffExtensions(filePath) {
    const patch = diffByPathRef.current[filePath]?.patch;
    if (!patch) return [];

    return [
      createDiffDecorationField(patch),
      createDiffGutterField(patch),
      CodeMirrorView.theme({
        '.cm-file-diff-added': {
          backgroundColor: 'rgba(46, 160, 67, 0.22)',
          boxShadow: 'inset 2px 0 0 rgba(46, 160, 67, 0.85)',
        },
        '.cm-file-diff-removed': {
          backgroundColor: 'rgba(190, 60, 60, 0.22)',
          boxShadow: 'inset 2px 0 0 rgba(190, 60, 60, 0.85)',
        },
        '.cm-gutterElement.cm-file-diff-added-gutter': {
          color: '#7ad98f',
          backgroundColor: 'rgba(46, 160, 67, 0.10)',
        },
        '.cm-gutterElement.cm-file-diff-removed-gutter': {
          color: '#ff9a9a',
          backgroundColor: 'rgba(190, 60, 60, 0.10)',
        },
      }),
    ];
  }

  useEffect(() => {
    fileContentsRef.current = fileContents;
  }, [fileContents]);

  useEffect(() => {
    writeJson(EDITOR_CONTENTS_KEY, fileContents);
  }, [fileContents]);

  useEffect(() => {
    serverContentsRef.current = serverContents;
  }, [serverContents]);

  useEffect(() => {
    diffByPathRef.current = diffByPath || {};
  }, [diffByPath]);

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
        diffHighlightCompartmentRef.current.of(buildDiffExtensions(filePath)),
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

  useEffect(() => {
    const view = editorViewRef.current;
    const path = activePathRef.current;
    if (!view || !path) return;

    view.dispatch({
      effects: diffHighlightCompartmentRef.current.reconfigure(buildDiffExtensions(path)),
    });
  }, [activeFilePath, diffByPath]);

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
  const activePatch = activeFilePath ? (diffByPath[activeFilePath]?.patch || '') : '';
  const activeDocLines = typeof content === 'string' ? Math.max(1, content.split('\n').length) : 1;
  const overviewMarkers = useMemo(
    () => buildOverviewMarkers(activePatch, activeDocLines),
    [activePatch, activeDocLines],
  );
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

  function handleOverviewLanePointerDown(event) {
    const view = editorViewRef.current;
    if (!view) return;
    const lane = event.currentTarget;
    const rect = lane.getBoundingClientRect();
    if (rect.height <= 0) return;

    const ratio = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    const scroller = view.scrollDOM;
    const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    scroller.scrollTop = Math.max(0, Math.min(maxScroll, ratio * scroller.scrollHeight - scroller.clientHeight / 2));
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
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Horizontal-scrolling open-file tab bar ── */}
      {openFiles.length > 0 && (
        <div
          className="no-scrollbar flex shrink-0 overflow-x-auto border-b border-vscode-border"
          style={{ backgroundColor: 'var(--color-vscode-bg)' }}
        >
          {openFiles.map((file) => {
            const isActive = file.path === activeFilePath;
            const added = Number.isFinite(file.diffAdded) ? file.diffAdded : 0;
            const removed = Number.isFinite(file.diffRemoved) ? file.diffRemoved : 0;
            const hasDiffBadge = added > 0 || removed > 0;
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
                {hasDiffBadge && (
                  <span className="shrink-0 text-[10px]">
                    <span className="text-green-400">+{added}</span>
                    <span className="text-red-400 ml-1">-{removed}</span>
                  </span>
                )}
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
              {saveBusy ? 'Saving...' : (isEditMode ? (isDirty ? 'Save' : 'Done') : 'Edit')}
            </button>
          </div>
        </div>
      )}

      {/* ── Editor body ── */}
      <div className="min-h-0 flex-1 overflow-auto overscroll-y-contain">
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
          <div className="relative h-full">
            <div ref={editorHostRef} className="editor-cm-shell h-full" />
            {overviewMarkers.length > 0 && (
              <button
                type="button"
                aria-label="Scroll change overview"
                onPointerDown={handleOverviewLanePointerDown}
                className="absolute right-0 top-0 bottom-0 w-[5px] border-l border-vscode-border/70 bg-vscode-sidebar/35"
                style={{ outline: 'none' }}
              >
                {overviewMarkers.map((marker, idx) => (
                  <div
                    key={`${marker.kind}-${idx}`}
                    className="absolute left-[1px] right-[1px] rounded-[1px]"
                    style={{
                      top: `${Math.max(0, Math.min(99.5, marker.top))}%`,
                      height: `${Math.max(0.45, marker.height)}%`,
                      backgroundColor: marker.kind === 'added' ? 'rgba(84, 206, 111, 0.82)' : 'rgba(233, 107, 107, 0.82)',
                    }}
                  />
                ))}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
