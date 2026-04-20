import { useEffect, useState } from 'react';
import { connectionStatusManager } from '../utils/connectionStatus';

const ConnectionOverlay = () => {
  const [connectionState, setConnectionState] = useState(connectionStatusManager.getStatus());
  const [showSuccess, setShowSuccess] = useState(false);
  const [hasEverConnected, setHasEverConnected] = useState(false);

  useEffect(() => {
    const unsubscribe = connectionStatusManager.subscribe((status) => {
      setConnectionState(status);

      // When we transition to connected, show success message
      if (status.status === 'connected') {
        if (hasEverConnected) {
          // Only show "Connected!" if we were previously disconnected
          setShowSuccess(true);
          setTimeout(() => setShowSuccess(false), 3000);
        } else {
          // First connection - just mark it
          setHasEverConnected(true);
        }
      }
    });

    return unsubscribe;
  }, [hasEverConnected]);

  const { status } = connectionState;

  // Don't show overlay if connected and not showing success message
  if (status === 'connected' && !showSuccess) {
    return null;
  }

  const getMessage = () => {
    if (showSuccess) {
      return {
        title: 'Connected!',
        subtitle: '',
        showSpinner: false,
      };
    }

    switch (status) {
      case 'connecting':
        return {
          title: 'Connecting to server...',
          subtitle: '',
          showSpinner: true,
        };
      case 'disconnected':
        return {
          title: 'Connection lost',
          subtitle: 'Attempting to reconnect...',
          showSpinner: true,
        };
      case 'offline':
        return {
          title: 'You are offline',
          subtitle: 'Check your internet connection',
          showSpinner: false,
        };
      default:
        return {
          title: 'Connecting...',
          subtitle: '',
          showSpinner: true,
        };
    }
  };

  const { title, subtitle, showSpinner } = getMessage();

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{
        backgroundColor: 'rgba(24, 24, 24, 0.98)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div className="flex flex-col items-center gap-6 px-8 py-12">
        {/* Spinner */}
        {showSpinner && (
          <div className="relative w-16 h-16">
            <div
              className="absolute inset-0 rounded-full border-4 border-vscode-accent opacity-20"
            />
            <div
              className="absolute inset-0 rounded-full border-4 border-transparent border-t-vscode-accent animate-spin"
              style={{
                animationDuration: '1s',
              }}
            />
          </div>
        )}

        {/* Success checkmark */}
        {showSuccess && (
          <div className="w-16 h-16 flex items-center justify-center">
            <svg
              className="w-16 h-16 text-vscode-accent"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
        )}

        {/* Title */}
        <div className="text-center">
          <h2 className="text-xl font-medium text-vscode-text mb-2">
            {title}
          </h2>
          {subtitle && (
            <p className="text-sm text-vscode-text-muted">
              {subtitle}
            </p>
          )}
        </div>

        {/* Offline icon */}
        {status === 'offline' && (
          <div className="mt-2">
            <svg
              className="w-12 h-12 text-vscode-text-muted"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414"
              />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
};

export default ConnectionOverlay;
