import { useEffect, useState } from 'react';

// Tracks the visual viewport height so the layout shrinks when the on-screen
// keyboard appears, keeping the nav bar pinned just above the keyboard.
function useVisualViewportHeight() {
  const [height, setHeight] = useState(
    () => (typeof window !== 'undefined' ? (window.visualViewport?.height ?? window.innerHeight) : 0),
  );

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setHeight(vv.height);
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return height;
}

// Icons as tiny inline components so there are no extra dependencies


function IconLayers() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6" aria-hidden="true">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}

function IconFile() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6" aria-hidden="true">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="16" y2="17" />
    </svg>
  );
}

function IconTerminal() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6" aria-hidden="true">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

function IconChat() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6" aria-hidden="true">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  );
}

const TAB_ITEMS = [
  { id: 'extensions', label: 'Workspace' },
  { id: 'editor',     label: 'Editor'   },
  { id: 'ai-chat',    label: 'AI Chat'  },
  { id: 'terminal',   label: 'Terminal' },
  { id: 'settings',   label: 'Settings' },
];

function TabIcon({ id, isActive }) {
  if (id === 'extensions') return <IconLayers />;
  if (id === 'editor')     return <IconFile />;
  if (id === 'ai-chat')    return <IconChat />;
  if (id === 'terminal')   return <IconTerminal />;
  if (id === 'settings')   return <IconSettings />;
  return null;
}

export default function Layout({ activeTab, onTabChange, children }) {
  const vpHeight = useVisualViewportHeight();

  return (
    <div className="flex flex-col overflow-hidden" style={{ height: `${vpHeight}px` }}>
      {/* Top safe-area spacer — expands to the device's notch/Dynamic Island height,
          zero on devices without one. Uses height (not padding) so no element's
          own box size is affected. shrink-0 prevents flex from collapsing it. */}
      <div
        aria-hidden="true"
        className="shrink-0 w-full"
        style={{ height: 'env(safe-area-inset-top)' }}
      />

      {/* Main content — leave room for the nav bar via padding so nothing hides under it */}
      <main className="flex-1 overflow-hidden">
        {children}
      </main>

      {/* ── Bottom Navigation Bar ── */}
      <nav
        aria-label="Main navigation"
        style={{
          // Glassmorphism: semi-transparent dark surface + blur
          backgroundColor: 'rgba(13, 13, 15, 0.75)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          borderTop: '1px solid rgba(255,255,255,0.06)',
        }}
        className="flex shrink-0"
      >
        {TAB_ITEMS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              aria-label={tab.label}
              aria-current={isActive ? 'page' : undefined}
              style={{ background: 'transparent', border: 'none', outline: 'none' }}
              className={[
                'flex-1 flex flex-col items-center justify-center gap-1 py-2',
                'min-h-[56px] transition-colors cursor-pointer',
                'relative',
                isActive ? 'text-vscode-accent' : 'text-vscode-text-muted',
              ].join(' ')}
            >
              {/* Active indicator pill */}
              {isActive && (
                <span
                  className="absolute top-0 left-1/2 -translate-x-1/2 rounded-full"
                  style={{
                    width: 28,
                    height: 3,
                    background: 'var(--color-vscode-accent)',
                    borderRadius: '0 0 4px 4px',
                    top: 0,
                  }}
                />
              )}
              <TabIcon id={tab.id} isActive={isActive} />
              <span className="text-[10px] leading-tight font-medium">{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Safe-area spacer — extends nav background behind the home indicator.
          height-only, never affects button sizing or any other element. */}
      <div
        aria-hidden="true"
        className="shrink-0 w-full"
        style={{
          height: 'env(safe-area-inset-bottom)',
          backgroundColor: 'rgba(13, 13, 15, 0.75)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        }}
      />
    </div>
  );
}
