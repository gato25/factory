# Contract: execution service — launches

All routes are bearer-authenticated like every other route.

## `POST /launches`

```json
{ "clone_url": "https://…", "branch": "factory/142-…", "git_token": "…",
  "command": "npm run dev -- --host 0.0.0.0 --port $PORT", "port": 5173,
  "sandbox": { "image": "…", "cpu": 2, "memory_mb": 4096, "wall_clock_minutes": 90 } }
```

`command` and `port` are optional; absent means detect (FR-004). Answers `202`
`{ "launch_id": "…", "status": "starting" }` immediately (D1).

## `GET /launches/:id`

```json
{ "launch_id": "…", "status": "starting|running|failed|stopped",
  "address": "127.0.0.1:49153", "command": "…", "port": 5173,
  "from": "package.json — Vite, via `npm run dev`", "notes": ["…"],
  "detail": "why it failed or stopped", "log": ["last lines of the project's output"] }
```

Looking counts as activity for the idle period (FR-011). `404` for an unknown id.

## `DELETE /launches/:id`

Destroys the container; `200 { "stopped": true }`. Idempotent: a second call answers
`{ "stopped": false }`.

## Obligations

- The container is created with the port published on `127.0.0.1` only (FR-006).
- The credential is environment for the clone and never written to the workspace (FR-017).
- The container's own `sleep <wall_clock_minutes>` is the hard lifetime cap (FR-012).
- A launch idle for 30 minutes is destroyed by the service's own sweep (FR-011).
