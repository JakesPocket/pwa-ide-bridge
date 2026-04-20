import { useState, useRef, useEffect } from 'react';
import copilotIcon from '../assets/icons/providers/copilot.svg';
import codexIcon from '../assets/icons/providers/codex.svg';
import localIcon from '../assets/icons/providers/local.svg';
import { preventScrollOnFocus } from '../utils/preventScrollOnFocus';

const MAX_HEIGHT_PX = 120;

const MODE_COLORS = {
  agent: { dot: '#64c864', bg: 'rgba(100,200,100,0.2)' },
  ask:   { dot: '#ffa500', bg: 'rgba(255,165,0,0.2)' },
  plan:  { dot: '#6496ff', bg: 'rgba(100,150,255,0.2)' },
};

function providerIcon(p) {
  if (p === 'codex') return codexIcon;
  if (p === 'local') return localIcon;
  return copilotIcon;
}

function providerLabel(p) {
  if (p === 'codex') return 'Codex';
  if (p === 'local') return 'Local';
  return 'Copilot';
}

export default function ComposeModal({ open, onClose, onSubmit, provider, aiMode, onChangeMode }) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef(null);

  useEffect(() => {
    if (open) {
      setText('');
      setTimeout(() => textareaRef.current?.focus(), 60);
    }
  }, [open]);

  if (!open) return null;

  async function handleSubmit(e) {
    e?.preventDefault();
    const prompt = text.trim();
    if (!prompt || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(prompt);
      setText('');
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  const modeColor = MODE_COLORS[aiMode] || MODE_COLORS.agent;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="fixed inset-x-0 bottom-0 z-[81] rounded-t-2xl border-t border-vscode-border bg-vscode-bg shadow-2xl animate-slide-up">
        <div className="mx-auto w-10 h-1 rounded-full bg-vscode-border/60 mt-2 mb-1" />

        {/* Header row */}
        <div className="flex items-center justify-between px-4 py-2">
          <span className="text-sm font-medium text-vscode-text">New Task</span>
          <div className="flex items-center gap-2">
            <img src={providerIcon(provider)} alt="" className="w-4 h-4 object-contain" />
            <span className="text-xs text-vscode-text-muted">{providerLabel(provider)}</span>
          </div>
        </div>

        {/* Mode selector */}
        <div className="flex items-center gap-1.5 px-4 pb-2">
          {['agent', 'ask', 'plan'].map((m) => {
            const c = MODE_COLORS[m];
            const active = aiMode === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => onChangeMode(m)}
                className="px-2.5 py-1 rounded-md text-[11px] font-medium border"
                style={{
                  background: active ? c.bg : 'transparent',
                  borderColor: active ? c.dot : 'var(--color-vscode-border)',
                  color: active ? c.dot : 'var(--color-vscode-text-muted)',
                  outline: 'none',
                }}
              >
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            );
          })}
        </div>

        {/* Composer */}
        <form onSubmit={handleSubmit} className="px-4 pb-4">
          <div className="rounded-lg border border-vscode-border overflow-hidden">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onFocus={preventScrollOnFocus}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              placeholder="What should the agent do?"
              disabled={submitting}
              rows={3}
              className="w-full resize-none bg-transparent text-vscode-text placeholder-vscode-text-muted px-3 py-2.5 outline-none text-[16px] sm:text-sm"
              style={{ maxHeight: `${MAX_HEIGHT_PX}px` }}
            />
          </div>

          <div className="flex items-center justify-end gap-2 mt-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-vscode-text-muted border border-vscode-border"
              style={{ background: 'transparent', outline: 'none' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!text.trim() || submitting}
              className="px-4 py-2 rounded-lg text-sm text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: modeColor.dot,
                border: 'none',
                outline: 'none',
              }}
            >
              {submitting ? 'Submitting…' : 'Submit Task'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
