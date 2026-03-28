const DEFAULT_LOCAL_SERVER = 'http://localhost:3000';
const BACKEND_SERVER_PORT = '3000';

function inferCodespaceServerUrl() {
  if (typeof window === 'undefined') return null;

  const { hostname, protocol } = window.location;
  const match = hostname.match(/^(.*)-\d+(\..+)$/);

  if (!match) return null;

  const [, prefix, suffix] = match;
  return `${protocol}//${prefix}-${BACKEND_SERVER_PORT}${suffix}`;
}

function resolveServerBaseUrl() {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SERVER_URL) {
    return import.meta.env.VITE_SERVER_URL;
  }

  if (typeof window === 'undefined') {
    return DEFAULT_LOCAL_SERVER;
  }

  const { hostname, protocol } = window.location;

  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return DEFAULT_LOCAL_SERVER;
  }

  const inferredCodespaceUrl = inferCodespaceServerUrl();
  if (inferredCodespaceUrl) {
    return inferredCodespaceUrl;
  }

  // On LAN/mobile access (e.g. 10.x.x.x), target the same host on backend port.
  return `${protocol}//${hostname}:${BACKEND_SERVER_PORT}`;
}

export const SERVER_BASE_URL = resolveServerBaseUrl();
export const SOCKET_URL = SERVER_BASE_URL;

export function apiUrl(pathname) {
  return `${SERVER_BASE_URL}${pathname}`;
}
