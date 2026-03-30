# PocketIDE

## Dev Launcher (Frontend + Backend)

Use one command to start both services and auto-clear stale listeners:

```bash
./scripts/dev-up.sh
```

What it does:

- Frees stale listeners on ports `3000` (backend) and `5173` (frontend).
- Starts `PocketIDE-Server` and `PocketIDE` together.
- Prints local and LAN URLs for desktop/iPhone testing.
- Stops both processes cleanly on `Ctrl+C`.

## Logs

- The bridge service writes logs to `bridge/logs/bridge-YYYY-MM-DD.log`.
- The main backend writes logs to `../PocketIDE-Server/logs/server-YYYY-MM-DD.log`.
- Override with `LOG_DIR` and `LOG_FILE` environment variables when needed.

## Chat Execution

- Local mode is still used for interactive prompts.
- Heavy/long-running prompts are auto-routed to Cloud tasks so they can continue in the background.
- Cloud task history is shown in the Tasks tab.