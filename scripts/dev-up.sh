#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SERVER_DIR="$(cd "${FRONTEND_DIR}/../PocketCode-Server" && pwd)"

if [[ ! -d "${SERVER_DIR}" ]]; then
  echo "[dev-up] Could not find PocketCode-Server at: ${SERVER_DIR}"
  exit 1
fi

free_port() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"

  if [[ -z "${pids}" ]]; then
    return
  fi

  echo "[dev-up] Releasing TCP port ${port} (PID(s): ${pids//$'\n'/, })"
  while IFS= read -r pid; do
    [[ -z "${pid}" ]] && continue
    kill "${pid}" 2>/dev/null || true
  done <<< "${pids}"

  sleep 1

  local still
  still="$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "${still}" ]]; then
    echo "[dev-up] Force-killing stubborn PID(s) on ${port}: ${still//$'\n'/, }"
    while IFS= read -r pid; do
      [[ -z "${pid}" ]] && continue
      kill -9 "${pid}" 2>/dev/null || true
    done <<< "${still}"
  fi
}

cleanup() {
  if [[ "${CLEANED_UP:-0}" == "1" ]]; then
    return
  fi
  CLEANED_UP=1
  SHUTTING_DOWN=1

  echo
  echo "[dev-up] Shutting down..."
  if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "${BACKEND_PID}" 2>/dev/null; then
    kill "${BACKEND_PID}" 2>/dev/null || true
  fi
  if [[ -n "${FRONTEND_PID:-}" ]] && kill -0 "${FRONTEND_PID}" 2>/dev/null; then
    kill "${FRONTEND_PID}" 2>/dev/null || true
  fi
}

trap cleanup INT TERM EXIT

free_port 3000
free_port 5173

echo "[dev-up] Starting backend (PocketCode-Server) on :3000"
(
  cd "${SERVER_DIR}"
  node index.js
) &
BACKEND_PID=$!

sleep 1
if ! kill -0 "${BACKEND_PID}" 2>/dev/null; then
  echo "[dev-up] Backend failed to start."
  exit 1
fi

echo "[dev-up] Starting frontend (PocketCode) on :5173"
(
  cd "${FRONTEND_DIR}"
  npm run dev
) &
FRONTEND_PID=$!

sleep 1
if ! kill -0 "${FRONTEND_PID}" 2>/dev/null; then
  echo "[dev-up] Frontend failed to start."
  exit 1
fi

IP_ADDR="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
echo "[dev-up] Ready"
echo "[dev-up] Local:  http://localhost:5173"
if [[ -n "${IP_ADDR}" ]]; then
  echo "[dev-up] iPhone: http://${IP_ADDR}:5173"
fi

while true; do
  if [[ "${SHUTTING_DOWN:-0}" == "1" ]]; then
    exit 0
  fi

  if ! kill -0 "${BACKEND_PID}" 2>/dev/null; then
    echo "[dev-up] Backend exited."
    exit 1
  fi
  if ! kill -0 "${FRONTEND_PID}" 2>/dev/null; then
    echo "[dev-up] Frontend exited."
    exit 1
  fi
  sleep 1
done