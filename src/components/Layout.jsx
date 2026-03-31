import { useEffect, useRef, useState } from 'react';

// ─── Nav bar spacing ──────────────────────────────────────────────────────────
// Tweak these to adjust gaps around the floating nav bar.
const NAV_TOP_GAP_PX = 8;             // gap between content area and top of nav bar
const NAV_BOTTOM_GAP_PX = 20;         // space below nav bar when keyboard is closed (0 when open)
const NAV_SIDE_MARGIN_PX = 16;        // left/right margin that makes the nav bar "float"
const NAV_SAFE_AREA_EXTEND_PX = 0;   // how far the nav bar dips below 100dvh into the iOS safe area
// ─────────────────────────────────────────────────────────────────────────────

// Keep the app shell pinned to the pre-keyboard viewport height. On iOS Safari,
// shrinking a fixed shell to visualViewport.height while focusing an input causes
// Safari's own focus-reveal scroll to stack with our relayout, which overshoots
// more for controls that start lower on screen.
function useAppViewportHeight() {
  // Track a baseline visual viewport height for keyboard-open detection.
  const baselineVvHeightRef = useRef(0);

  function resolveViewportMetrics() {
    const vv = window.visualViewport;
    if (!vv) {
      const fallbackHeight = Math.max(0, Math.round(window.innerHeight || 0));
      return {
        height: fallbackHeight,
        keyboardOpen: false,
      };
    }

    const visible = Math.max(0, Math.round(vv.height));
    if (visible > baselineVvHeightRef.current) {
      baselineVvHeightRef.current = visible;
    }
    const baseline = baselineVvHeightRef.current || visible;
    const keyboardOpen = visible < baseline - 120;

    // Freeze the shell height while the keyboard is open. Safari already pans the
    // visual viewport to reveal the focused control; shrinking the entire app at the
    // same time causes focused inputs to jump much farther than necessary.
    return {
      height: keyboardOpen ? baseline : visible,
      keyboardOpen,
    };
  }

  const [metrics, setMetrics] = useState(() => {
    if (typeof window === 'undefined') {
      return {
        height: 0,
        keyboardOpen: false,
      };
    }
    return resolveViewportMetrics();
  });

  useEffect(() => {
    const update = () => {
      const next = resolveViewportMetrics();
      // Ignore tiny viewport fluctuations that cause jumpy keyboard-time relayout.
      setMetrics((prev) => {
        const heightStable = Math.abs(prev.height - next.height) <= 1;
        const keyboardStable = prev.keyboardOpen === next.keyboardOpen;
        return heightStable && keyboardStable ? prev : next;
      });
    };
    const vv = window.visualViewport;

    update();
    window.addEventListener('resize', update);

    if (vv) {
      vv.addEventListener('resize', update);
      // 'scroll' fires when visualViewport.offsetTop changes (e.g. keyboard push on iOS).
      vv.addEventListener('scroll', update);
    }

    return () => {
      window.removeEventListener('resize', update);
      if (vv) {
        vv.removeEventListener('resize', update);
        vv.removeEventListener('scroll', update);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const nextHeight = `${metrics.height}px`;
    const docEl = document.documentElement;
    const body = document.body;

    docEl.style.setProperty('--app-vh', nextHeight);
    if (body) {
      body.style.setProperty('--app-vh', nextHeight);
    }

    return () => {
      docEl.style.removeProperty('--app-vh');
      if (body) {
        body.style.removeProperty('--app-vh');
      }
    };
  }, [metrics.height]);

  return metrics;
}

function detectStandaloneMode() {
  if (typeof window === 'undefined') return false;

  const nav = window.navigator;
  const iosStandalone = Boolean(nav.standalone);
  const displayModeStandalone = window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || window.matchMedia('(display-mode: minimal-ui)').matches;

  return iosStandalone || displayModeStandalone;
}

function useIsStandaloneApp() {
  const [isStandalone, setIsStandalone] = useState(() => detectStandaloneMode());

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const update = () => setIsStandalone(detectStandaloneMode());
    const standaloneMql = window.matchMedia('(display-mode: standalone)');

    update();

    if (typeof standaloneMql.addEventListener === 'function') {
      standaloneMql.addEventListener('change', update);
      return () => standaloneMql.removeEventListener('change', update);
    }

    standaloneMql.addListener(update);
    return () => standaloneMql.removeListener(update);
  }, []);

  return isStandalone;
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
  const { keyboardOpen } = useAppViewportHeight();
  const layoutRef = useRef(null);
  const touchStartYRef = useRef(null);
  const navBottomOffsetPx = keyboardOpen ? 8 : NAV_BOTTOM_GAP_PX;
  const activeTabIndex = Math.max(0, TAB_ITEMS.findIndex((tab) => tab.id === activeTab));

  function findScrollableAncestor(startNode, boundaryNode) {
    let target = startNode;

    while (target && target !== boundaryNode) {
      if (target.scrollHeight > target.clientHeight || target.scrollWidth > target.clientWidth) {
        const style = window.getComputedStyle(target);
        if (
          style.overflowY === 'auto'
          || style.overflowY === 'scroll'
          || style.overflowX === 'auto'
          || style.overflowX === 'scroll'
        ) {
          return target;
        }
      }
      target = target.parentElement;
    }

    return null;
  }

  useEffect(() => {
    const root = layoutRef.current;
    if (!root) return undefined;

    const handleTouchStart = (e) => {
      touchStartYRef.current = e.touches?.[0]?.clientY ?? null;
    };

    const handleTouchMove = (e) => {
      const scrollableAncestor = findScrollableAncestor(e.target, root);

      // If we couldn't find a scrollable ancestor, prevent viewport-level scroll.
      if (!scrollableAncestor) {
        e.preventDefault();
        return;
      }

      // With keyboard open, block scroll-chaining when inner scrollers hit edges.
      if (keyboardOpen) {
        const currentY = e.touches?.[0]?.clientY;
        const startY = touchStartYRef.current;

        if (typeof currentY === 'number' && typeof startY === 'number') {
          const deltaY = currentY - startY;
          const maxScrollTop = Math.max(0, scrollableAncestor.scrollHeight - scrollableAncestor.clientHeight);
          const atTop = scrollableAncestor.scrollTop <= 0;
          const atBottom = scrollableAncestor.scrollTop >= maxScrollTop - 1;

          if ((deltaY > 0 && atTop) || (deltaY < 0 && atBottom)) {
            e.preventDefault();
          }
        }

        touchStartYRef.current = currentY ?? touchStartYRef.current;
      }
    };

    const handleTouchEnd = () => {
      touchStartYRef.current = null;
    };

    root.addEventListener('touchstart', handleTouchStart, { passive: true });
    root.addEventListener('touchmove', handleTouchMove, { passive: false });
    root.addEventListener('touchend', handleTouchEnd, { passive: true });
    root.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      root.removeEventListener('touchstart', handleTouchStart);
      root.removeEventListener('touchmove', handleTouchMove);
      root.removeEventListener('touchend', handleTouchEnd);
      root.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [keyboardOpen]);

  return (
    <div
      ref={layoutRef}
      className="flex min-h-0 flex-col"
      style={{
        minHeight: 'var(--app-vh, 100dvh)',
        height: 'var(--app-vh, 100dvh)',
        maxHeight: 'var(--app-vh, 100dvh)',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        overflow: 'visible',
        overscrollBehavior: 'none',
        WebkitOverflowScrolling: 'touch',
        borderTop: '1px solid white',
        borderBottom: '1px solid white',
      }}
    >
      {/* Main content — leave room for the nav bar via padding so nothing hides under it */}
      <main
        className="min-h-0 flex-1"
        style={{
          overflow: 'hidden',
          overscrollBehavior: 'none',
          WebkitOverflowScrolling: 'auto',
          borderTop: '1px solid white',
          borderBottom: '1px solid white',
          height: '100%',
          maxHeight: '100%',
        }}
      >
        {children}
      </main>

      {/* ── Bottom Navigation Bar ── */}
      <nav
        aria-label="Main navigation"
        className="flex shrink-0 self-center select-none"
        style={{
          position: 'relative',
          backgroundColor: 'rgba(13, 13, 15, 0.75)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          border: '1px solid rgba(255,255,255,0.10)',
          borderRadius: 9999,
          boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
          padding: '2px',
          marginLeft: NAV_SIDE_MARGIN_PX,
          marginRight: NAV_SIDE_MARGIN_PX,
          marginTop: NAV_TOP_GAP_PX,
          marginBottom: `${navBottomOffsetPx - NAV_SAFE_AREA_EXTEND_PX}px`,
          width: `calc(100% - ${NAV_SIDE_MARGIN_PX * 2}px)`,
        }}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1 bottom-1 rounded-full transition-transform duration-300 ease-out"
          style={{
            left: 2,
            width: 'calc((100% - 4px) / 5)',
            background: 'rgba(255,255,255,0.10)',
            transform: `translateX(${activeTabIndex * 100}%)`,
          }}
        />
        {TAB_ITEMS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              aria-label={tab.label}
              aria-current={isActive ? 'page' : undefined}
              style={{
                background: 'transparent',
                border: 'none',
                outline: 'none',
                borderRadius: 9999,
              }}
              className={[
                'flex-1 flex flex-col items-center justify-center gap-0.5 py-[3px]',
                'min-h-[50px] transition-colors cursor-pointer overflow-visible',
                'relative z-10',
                isActive ? 'text-vscode-accent' : 'text-vscode-text-muted',
              ].join(' ')}
            >
              <TabIcon id={tab.id} isActive={isActive} />
              <span className="text-[10px] leading-tight font-medium">{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
