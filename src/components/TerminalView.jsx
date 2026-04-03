import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { io } from 'socket.io-client';
import { SOCKET_URL } from '../config/server';
import { readText, writeText } from '../utils/persist';
import '@xterm/xterm/css/xterm.css';

const TERMINAL_SCROLLBACK_KEY = 'pocketcode.terminal.scrollback.v1';
const MAX_SCROLLBACK_SNAPSHOT = 120000;

export default function TerminalView() {
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const termRef = useRef(null);
  const socketRef = useRef(null);
  const scrollbackRef = useRef(readText(TERMINAL_SCROLLBACK_KEY, ''));
  // Prevents re-entrant focus loops when the sentinel immediately refocuses the textarea.
  const sentinelGuardRef = useRef(false);
  const focusLockUntilRef = useRef(0);
  const focusLockTimerRef = useRef(null);

  function sendInput(data) {
    if (!data) return;
    const socket = socketRef.current;
    if (!socket || !socket.connected) return;
    socket.emit('input', data);
  }

  function focusBridgeInput() {
    try {
      inputRef.current?.focus({ preventScroll: true });
    } catch (_) {
      inputRef.current?.focus();
    }
  }

  function focusTerminalInput() {
    // Keep xterm focused for cursor/render semantics, then force our bridge
    // textarea to be the final active element so Safari accessory arrows use
    // the sentinel -> bridge -> sentinel focus chain.
    termRef.current?.focus();

    focusBridgeInput();
    requestAnimationFrame(() => {
      focusBridgeInput();
      setTimeout(focusBridgeInput, 30);
    });
  }

  function clearFocusLockTimer() {
    if (focusLockTimerRef.current) {
      clearInterval(focusLockTimerRef.current);
      focusLockTimerRef.current = null;
    }
  }

  function startFocusLock(durationMs = 450) {
    focusLockUntilRef.current = Date.now() + durationMs;
    clearFocusLockTimer();

    // During this short window, keep bridge textarea as the active element.
    // xterm's helper textarea can steal focus slightly after tap on iOS.
    focusLockTimerRef.current = setInterval(() => {
      if (Date.now() >= focusLockUntilRef.current) {
        clearFocusLockTimer();
        return;
      }
      if (document.activeElement !== inputRef.current) {
        focusBridgeInput();
      }
    }, 50);
  }

  function restoreTerminalFocus() {
    const tryFocus = () => {
      termRef.current?.focus();
      focusBridgeInput();
    };

    // iOS may ignore the first focus call during accessory-bar navigation.
    tryFocus();
    requestAnimationFrame(() => {
      tryFocus();
      setTimeout(tryFocus, 30);
    });
  }

  useEffect(() => {
    // ── xterm instance ──────────────────────────────────────────────────────
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Courier New', monospace",
      scrollSensitivity: 1,
      theme: {
        background: '#0d0d0f',
        foreground: '#d4d4d4',
        cursor: '#007acc',
        selectionBackground: 'rgba(0,122,204,0.3)',
        black: '#0d0d0f',
        red: '#f44747',
        green: '#4ec9b0',
        yellow: '#dcdcaa',
        blue: '#569cd6',
        magenta: '#c586c0',
        cyan: '#9cdcfe',
        white: '#d4d4d4',
        brightBlack: '#6a6a6a',
        brightRed: '#f44747',
        brightGreen: '#4ec9b0',
        brightYellow: '#dcdcaa',
        brightBlue: '#569cd6',
        brightMagenta: '#c586c0',
        brightCyan: '#9cdcfe',
        brightWhite: '#ffffff',
      },
      scrollback: 2000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    termRef.current = term;

    // Defer fit to after the browser has painted so the container has its
    // final pixel dimensions — avoids wrong column count and line-wrap artifacts.
    // We intentionally do NOT replay the scrollback snapshot here: replaying it
    // on every mount stacks old prompts on top of the freshly-spawned shell.
    requestAnimationFrame(() => {
      if (!termRef.current) return;
      fitAddon.fit();
    });

    // ── socket ──────────────────────────────────────────────────────────────
    // Use autoConnect:false and defer connect to a setTimeout so that React
    // StrictMode's synchronous unmount/remount cycle fires before the socket
    // ever opens — this prevents the "WebSocket closed before established" warning.
    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: false,
    });
    socketRef.current = socket;
    const connectTimer = setTimeout(() => {
      if (socketRef.current === socket) socket.connect();
    }, 0);

    // Backend → terminal
    socket.on('output', (data) => {
      term.write(data);
      scrollbackRef.current = (scrollbackRef.current + data).slice(-MAX_SCROLLBACK_SNAPSHOT);
      writeText(TERMINAL_SCROLLBACK_KEY, scrollbackRef.current);
    });
    socket.on('exit', () => {
      const msg = '\r\n\x1b[31m[session ended]\x1b[0m\r\n';
      term.write(msg);
      scrollbackRef.current = (scrollbackRef.current + msg).slice(-MAX_SCROLLBACK_SNAPSHOT);
      writeText(TERMINAL_SCROLLBACK_KEY, scrollbackRef.current);
    });

    // Terminal → backend
    term.onData((data) => socket.emit('input', data));

    // Send resize whenever the terminal dimensions change
    function sendResize() {
      fitAddon.fit();
      socket.emit('resize', term.cols, term.rows);
    }
    term.onResize(() => socket.emit('resize', term.cols, term.rows));

    // Fit on connect so the shell knows the correct dimensions immediately
    socket.on('connect', () => {
      fitAddon.fit();
      socket.emit('resize', term.cols, term.rows);
      focusTerminalInput();
    });

    // Refit when the container size changes (keyboard appears, rotation, etc.)
    const ro = new ResizeObserver(() => sendResize());
    if (containerRef.current) ro.observe(containerRef.current);

    return () => {
      clearTimeout(connectTimer);
      clearFocusLockTimer();
      ro.disconnect();
      socket.close();
      socketRef.current = null;
      termRef.current = null;
      term.dispose();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#0d0d0f',
        position: 'relative',
        boxSizing: 'border-box',
      }}
      onPointerDown={() => {
        startFocusLock();
        focusTerminalInput();
      }}
      onTouchStart={() => {
        startFocusLock();
        focusTerminalInput();
      }}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }} />

      {/*
        Safari accessory-bar sentinel (↑ arrow).
        The ↑ button in Safari's input toolbar moves focus to the previous editable field in
        DOM order. This hidden input exists only to receive that focus event, send history-prev,
        and then immediately return focus to the terminal textarea.
      */}
      <input
        tabIndex={0}
        type="text"
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        placeholder="UP"
        aria-label="Terminal history previous"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          opacity: 0.5,
          pointerEvents: 'auto',
          border: '1px solid rgba(255,255,255,0.25)',
          borderRadius: 8,
          background: 'rgba(0,0,0,0.65)',
          color: '#d4d4d4',
          caretColor: '#d4d4d4',
          padding: '0 10px',
          margin: 0,
          // fontSize 16 prevents iOS Safari from auto-zooming the viewport on focus.
          fontSize: 16,
        }}
        onInput={(e) => {
          const text = e.currentTarget.value;
          if (text) sendInput(text);
          e.currentTarget.value = '';
          restoreTerminalFocus();
        }}
        onFocus={() => {
          if (sentinelGuardRef.current) return;
          sentinelGuardRef.current = true;
          sendInput('\x1b[A');
          restoreTerminalFocus();
          requestAnimationFrame(() => {
            setTimeout(() => {
              sentinelGuardRef.current = false;
            }, 40);
          });
        }}
      />

      {/* iOS/Safari fallback input: captures software keyboard text reliably and forwards it to the backend shell. */}
      <textarea
        ref={inputRef}
        aria-label="Terminal keyboard input"
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        rows={1}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: 'none',
          border: 'none',
          padding: 0,
          margin: 0,
          resize: 'none',
        }}
        onInput={(e) => {
          const text = e.currentTarget.value;
          if (text) sendInput(text);
          e.currentTarget.value = '';
        }}
        onKeyDown={(e) => {
          let seq = '';
          if (e.key === 'Enter') seq = '\r';
          else if (e.key === 'Backspace') seq = '\x7f';
          else if (e.key === 'Tab') seq = '\t';
          else if (e.key === 'Escape') seq = '\x1b';
          else if (e.key === 'ArrowUp') seq = '\x1b[A';
          else if (e.key === 'ArrowDown') seq = '\x1b[B';
          else if (e.key === 'ArrowRight') seq = '\x1b[C';
          else if (e.key === 'ArrowLeft') seq = '\x1b[D';

          if (seq) {
            e.preventDefault();
            sendInput(seq);
          }
        }}
      />

      {/*
        Safari accessory-bar sentinel (↓ arrow).
        Mirrors the sentinel above but for the ↓ (next) button, sending history-next.
      */}
      <input
        tabIndex={0}
        type="text"
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        placeholder="DOWN sentinel input (for Safari accessory arrow testing)"
        aria-label="Terminal history next"
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 2,
          opacity: 0.5,
          pointerEvents: 'auto',
          border: '1px solid rgba(255,255,255,0.25)',
          borderRadius: 8,
          background: 'rgba(0,0,0,0.65)',
          color: '#d4d4d4',
          caretColor: '#d4d4d4',
          padding: '0 10px',
          margin: 0,
          fontSize: 16,
        }}
        onInput={(e) => {
          const text = e.currentTarget.value;
          if (text) sendInput(text);
          e.currentTarget.value = '';
          restoreTerminalFocus();
        }}
        onFocus={() => {
          if (sentinelGuardRef.current) return;
          sentinelGuardRef.current = true;
          sendInput('\x1b[B');
          restoreTerminalFocus();
          requestAnimationFrame(() => {
            setTimeout(() => {
              sentinelGuardRef.current = false;
            }, 40);
          });
        }}
      />
    </div>
  );
}
