import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { io } from 'socket.io-client';
import { SOCKET_URL } from '../config/server';
import { readText, writeText } from '../utils/persist';
import '@xterm/xterm/css/xterm.css';

const TERMINAL_SCROLLBACK_KEY = 'pocketide.terminal.scrollback.v1';
const MAX_SCROLLBACK_SNAPSHOT = 120000;

export default function TerminalView() {
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const termRef = useRef(null);
  const socketRef = useRef(null);
  const scrollbackRef = useRef(readText(TERMINAL_SCROLLBACK_KEY, ''));

  function sendInput(data) {
    if (!data) return;
    const socket = socketRef.current;
    if (!socket || !socket.connected) return;
    socket.emit('input', data);
  }

  function focusTerminalInput() {
    termRef.current?.focus();
    try {
      inputRef.current?.focus({ preventScroll: true });
    } catch (_) {
      inputRef.current?.focus();
    }
  }

  useEffect(() => {
    // ── xterm instance ──────────────────────────────────────────────────────
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Courier New', monospace",
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
    fitAddon.fit();
    termRef.current = term;

    if (scrollbackRef.current) {
      term.write(scrollbackRef.current);
    }

    // ── socket ──────────────────────────────────────────────────────────────
    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
    });
    socketRef.current = socket;

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
        // xterm.js needs padding via the container, not via CSS on .xterm
        padding: '6px 4px',
        boxSizing: 'border-box',
      }}
      onPointerDown={focusTerminalInput}
      onTouchStart={focusTerminalInput}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

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
    </div>
  );
}
