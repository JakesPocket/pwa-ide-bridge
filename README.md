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