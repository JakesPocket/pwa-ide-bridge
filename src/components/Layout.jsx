import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { readText } from '../utils/persist';
import copilotIcon from '../assets/icons/providers/copilot.svg';
import codexIcon from '../assets/icons/providers/codex.svg';
import localIcon from '../assets/icons/providers/local.svg';

// ─── Nav bar spacing ──────────────────────────────────────────────────────────
// Tweak these to adjust gaps around the floating nav bar per display mode.
const NAV_TOP_GAP_PX = 8;
const NAV_SIDE_MARGIN_PX = 16;

const NAV_SPACING_BROWSER_PX = {
  bottomGap: 0,
  bottomDangerPush: 0,
};

const NAV_SPACING_STANDALONE_PX = {
  bottomGap: 0,
  bottomDangerPush: 13,
};

const NAV_SPACING_KEYBOARD_OPEN_BROWSER_PX = {
  bottomGap: 0,
  bottomDangerPush: 34,
};

const NAV_SPACING_KEYBOARD_OPEN_STANDALONE_PX = {
  bottomGap: 0,
  bottomDangerPush: 34,
};

const IOS_LAUNCH_CORNER_RADIUS_PX = 52;
const LAUNCH_BG_COLOR = '#000000';
const RUNTIME_BG_COLOR = 'var(--color-vscode-bg)';
const LAUNCH_SHELL_TRANSITION = 'background-color 360ms ease-out, border-radius 420ms cubic-bezier(0.22, 1, 0.36, 1)';
// ─────────────────────────────────────────────────────────────────────────────

// Follow the current visual viewport so the app shell shrinks with the software
// keyboard and stays aligned if iOS Safari shifts the visible area downward.
function useAppViewportHeight() {
  // Track a baseline visual viewport height for keyboard-open detection.
  const baselineVvHeightRef = useRef(0);
  const stableClosedHeightRef = useRef(0);

  function resolveViewportMetrics() {
    const vv = window.visualViewport;
    if (!vv) {
      const fallbackHeight = Math.max(0, Math.round(window.innerHeight || 0));
      if (fallbackHeight > stableClosedHeightRef.current) {
        stableClosedHeightRef.current = fallbackHeight;
      }
      return {
        height: stableClosedHeightRef.current || fallbackHeight,
        offsetTop: 0,
        keyboardOpen: false,
        keyboardInset: 0,
      };
    }

    const visible = Math.max(0, Math.round(vv.height));
    const offsetTop = Math.max(0, Math.round(vv.offsetTop || 0));
    const innerHeight = Math.max(0, Math.round(window.innerHeight || 0));
    const closedViewportHeight = Math.max(visible + offsetTop, innerHeight);
    if (visible > baselineVvHeightRef.current) {
      baselineVvHeightRef.current = visible;
    }
    const baseline = baselineVvHeightRef.current || visible;
    const keyboardOpen = visible < baseline - 120;
    const keyboardInset = keyboardOpen
      ? Math.max(0, baseline - (visible + offsetTop))
      : 0;

    if (!keyboardOpen && closedViewportHeight > stableClosedHeightRef.current) {
      stableClosedHeightRef.current = closedViewportHeight;
    }

    const resolvedHeight = keyboardOpen
      ? visible
      : Math.max(stableClosedHeightRef.current || 0, closedViewportHeight || 0, visible || 0);
    const resolvedOffsetTop = keyboardOpen ? offsetTop : 0;

    return {
      height: resolvedHeight,
      offsetTop: resolvedOffsetTop,
      keyboardOpen,
      keyboardInset,
    };
  }

  const [metrics, setMetrics] = useState(() => {
    if (typeof window === 'undefined') {
      return {
        height: 0,
        offsetTop: 0,
        keyboardOpen: false,
        keyboardInset: 0,
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
        const offsetTopStable = Math.abs((prev.offsetTop || 0) - (next.offsetTop || 0)) <= 1;
        const keyboardStable = prev.keyboardOpen === next.keyboardOpen;
        const insetStable = Math.abs((prev.keyboardInset || 0) - (next.keyboardInset || 0)) <= 1;
        return heightStable && offsetTopStable && keyboardStable && insetStable ? prev : next;
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

function isIOSDevice() {
  if (typeof navigator === 'undefined') return false;

  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  const maxTouchPoints = Number(navigator.maxTouchPoints || 0);

  return /iPad|iPhone|iPod/i.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1);
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
  const PROVIDER_KEY = 'pocketcode.agent.ai.provider.v1';

  function readProviderFromStorage() {
    const raw = readText(PROVIDER_KEY, 'copilot');
    const normalized = String(raw || '').toLowerCase().trim();
    if (normalized === 'codex' || normalized === 'local') return normalized;
    return 'copilot';
  }

  const [provider, setProvider] = useState(() => {
    return readProviderFromStorage();
  });

  useEffect(() => {
    const timer = setInterval(() => {
      const newProvider = readProviderFromStorage();
      setProvider((prev) => (prev !== newProvider ? newProvider : prev));
    }, 300);
    return () => clearInterval(timer);
  }, []);

  const iconSrc = provider === 'codex'
    ? codexIcon
    : provider === 'local'
      ? localIcon
      : copilotIcon;

  return <img src={iconSrc} alt="provider" className="w-6 h-6 object-contain" aria-hidden="true" />;
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
  { id: 'ai-agent',    label: 'AI Agent'  },
  { id: 'terminal',   label: 'Terminal' },
  { id: 'settings',   label: 'Settings' },
];

function TabIcon({ id, isActive }) {
  if (id === 'extensions') return <IconLayers />;
  if (id === 'editor')     return <IconFile />;
  if (id === 'ai-agent')    return <IconChat />;
  if (id === 'terminal')   return <IconTerminal />;
  if (id === 'settings')   return <IconSettings />;
  return null;
}

export default function Layout({ activeTab, onTabChange, children }) {
  const {
    height: viewportHeight,
    offsetTop: viewportOffsetTop,
    keyboardOpen,
  } = useAppViewportHeight();
  const isStandaloneApp = useIsStandaloneApp();
  const layoutRef = useRef(null);
  const touchStartYRef = useRef(null);
  const navSpacing = keyboardOpen
    ? (isStandaloneApp ? NAV_SPACING_KEYBOARD_OPEN_STANDALONE_PX : NAV_SPACING_KEYBOARD_OPEN_BROWSER_PX)
    : isStandaloneApp
      ? NAV_SPACING_STANDALONE_PX
      : NAV_SPACING_BROWSER_PX;
  const resolvedShellHeight = viewportHeight > 0 ? `${viewportHeight}px` : 'var(--app-full-vh)';
  const resolvedShellOffsetTop = viewportOffsetTop > 0 ? `${viewportOffsetTop}px` : 0;
  const navBottomOffsetPx = `calc(${navSpacing.bottomGap}px + env(safe-area-inset-bottom, 0px))`;
  const navBottomDangerPushPx = navSpacing.bottomDangerPush;
  const activeTabIndex = Math.max(0, TAB_ITEMS.findIndex((tab) => tab.id === activeTab));
  const navMuted = keyboardOpen;

  // ── iOS splash dismissal ──────────────────────────────────────────────────
  // The #ios-splash overlay in index.html covers the app while React mounts
  // and layout settles. Once the viewport has stabilised, fade it out.
  useLayoutEffect(() => {
    const splash = document.getElementById('ios-splash');
    if (!splash) return;

    // Give the layout a few frames to settle before revealing.
    let rafId1;
    let rafId2;
    let timerId;

    rafId1 = requestAnimationFrame(() => {
      rafId2 = requestAnimationFrame(() => {
        // One more small delay to let iOS visual viewport finish resizing.
        timerId = setTimeout(() => {
          splash.classList.add('fade-out');
          // Remove from DOM after the CSS transition completes.
          const removeTimer = setTimeout(() => {
            splash.remove();
          }, 300);
          // Store so we can clean up if unmounted mid-transition (unlikely).
          timerId = removeTimer;
        }, 120);
      });
    });

    return () => {
      if (rafId1) cancelAnimationFrame(rafId1);
      if (rafId2) cancelAnimationFrame(rafId2);
      if (timerId) clearTimeout(timerId);
    };
  }, []);

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

  function isEditableTouchTarget(target) {
    return Boolean(
      target?.closest?.(
        'input,textarea,select,[contenteditable="true"],[contenteditable=""],.cm-editor,.cm-content'
      )
    );
  }

  useEffect(() => {
    const root = layoutRef.current;
    if (!root) return undefined;

    const handleTouchStart = (e) => {
      touchStartYRef.current = e.touches?.[0]?.clientY ?? null;
    };

    const handleTouchMove = (e) => {
      // Let native text selection handles and editable controls manage their own
      // touch interactions. Preventing touchmove here breaks extending textarea
      // selections on iOS.
      if (isEditableTouchTarget(e.target)) {
        return;
      }

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
        minHeight: resolvedShellHeight,
        height: resolvedShellHeight,
        maxHeight: resolvedShellHeight,
        marginTop: resolvedShellOffsetTop,
        backgroundColor: RUNTIME_BG_COLOR,
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 0,
        overflow: 'hidden',
        overscrollBehavior: 'none',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {/* Main content — leave room for the nav bar via padding so nothing hides under it */}
      <main
        className="min-h-0 flex-1"
        style={{
          backgroundColor: RUNTIME_BG_COLOR,
          overflow: 'hidden',
          overscrollBehavior: 'none',
          WebkitOverflowScrolling: 'auto',

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
            backgroundColor: '#181818',
            backdropFilter: navMuted ? 'blur(16px) saturate(150%)' : 'blur(20px) saturate(180%)',
            WebkitBackdropFilter: navMuted ? 'blur(16px) saturate(150%)' : 'blur(20px) saturate(180%)',
            border: navMuted ? '1px solid rgba(255,255,255,0.07)' : '1px solid rgba(255,255,255,0.10)',
            borderRadius: 9999,
            padding: '2px',
            marginLeft: NAV_SIDE_MARGIN_PX,
            marginRight: NAV_SIDE_MARGIN_PX,
            marginTop: NAV_TOP_GAP_PX,
            marginBottom: navBottomDangerPushPx
              ? `calc(${navBottomOffsetPx} - ${navBottomDangerPushPx}px)`
              : navBottomOffsetPx,
            width: `calc(100% - ${NAV_SIDE_MARGIN_PX * 2}px)`,
          }}
        >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute rounded-full transition-transform duration-300 ease-out"
          style={{
            top: 2,
            bottom: 2,
            left: 2,
            width: 'calc((100% - 4px) / 5)',
            background: navMuted ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.10)',
            transform: `translateX(${activeTabIndex * 100}%)`,
          }}
        />
        {TAB_ITEMS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <div
              key={tab.id}
              className={[
                'relative z-10 flex-1',
                keyboardOpen ? 'min-h-[12px]' : 'min-h-[50px]',
              ].join(' ')}
            >
              {keyboardOpen && (
                <button
                  type="button"
                  onClick={() => onTabChange(tab.id)}
                  aria-label={tab.label}
                  aria-current={isActive ? 'page' : undefined}
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: -12,
                    bottom: -12,
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    borderRadius: 9999,
                  }}
                  className="cursor-pointer"
                />
              )}
              <button
                type="button"
                onClick={() => onTabChange(tab.id)}
                aria-label={tab.label}
                aria-current={isActive ? 'page' : undefined}
                style={{
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  borderRadius: 9999,
                  opacity: navMuted ? (isActive ? 0.88 : 0.74) : 1,
                  pointerEvents: keyboardOpen ? 'none' : 'auto',
                }}
                className={[
                  'w-full flex flex-col items-center justify-center transition-colors cursor-pointer overflow-visible',
                  'relative',
                  keyboardOpen ? 'gap-0 py-[3px] min-h-[12px]' : 'gap-0.5 py-[3px] min-h-[50px]',
                  isActive ? 'text-vscode-accent' : 'text-vscode-text-muted',
                ].join(' ')}
              >
                {!keyboardOpen && <TabIcon id={tab.id} isActive={isActive} />}
                <span className={[
                  'font-medium transition-opacity',
                  keyboardOpen ? 'text-[11px] leading-none' : 'text-[10px] leading-tight',
                  navMuted ? 'opacity-75' : 'opacity-100',
                ].join(' ')}>{tab.label}</span>
              </button>
            </div>
          );
        })}
        </nav>
    </div>
  );
}
