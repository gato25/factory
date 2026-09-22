# The execution service, as a container — for hosting it, not for developing
# it (docs/operations.md, "Hosting the runner in a container").
#
# What a container gives the runner that a bare `bun src/index.ts` does not:
# something that restarts it when it dies, a memory ceiling of its own so a
# runaway on the machine cannot take the orchestrator down with it, rotated
# logs, a health check, and pinned versions of bun and the Docker CLI. What it
# does NOT change is where runs execute: this image drives sandboxes on the
# HOST's Docker daemon, through the socket compose mounts into it, so runs
# stay one fresh container each (constitution: one fresh sandbox per run).
# That is docker-out-of-docker; there is no daemon in here and nothing here
# is privileged.
#
# `EXECUTION_HOST=docker` is the only mode this image supports. `process`
# would need git, Node and the Claude CLI in this image and would run every
# agent inside the runner's own container — one shared sandbox for every run,
# which is the arrangement the constitution forbids.
#
#   docker compose -f infra/runner/compose.yml --env-file .env up -d --build
#
# Bun, at the version `.bun-version` pins for everyone else.
FROM oven/bun:1.3.11-slim AS base

# The Docker CLI and nothing else of Docker, from the official CLI image:
# pinned, verified below, and no package repository to add. The daemon it
# talks to is the host's, through the mounted socket.
COPY --from=docker:29.3.1-cli /usr/local/bin/docker /usr/local/bin/docker

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && docker --version

WORKDIR /srv/factory

# The workspace, pruned to what the runner is: its own package, the shared
# package it depends on, and the manifests of the two workspaces it does not
# — those are in the lockfile, and `--frozen-lockfile` wants to see them.
# Nothing of the web application's source or dependencies is here.
COPY package.json bun.lock bunfig.toml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared packages/shared
COPY apps/runner apps/runner
RUN bun install --production --frozen-lockfile \
    && rm -rf /root/.bun/install/cache

# Where runs are written down, so a restart resumes them, and where the
# process host would make workspaces. Both are volumes in compose; they are
# made here, owned by the user below, so an EMPTY named volume inherits that
# ownership rather than arriving root-owned and unwritable.
RUN mkdir -p /srv/factory/state /srv/factory/runs \
    && chown -R bun:bun /srv/factory

# Non-root, and specifically uid 1000: the sandbox image runs as 1000 too,
# so a workspace directory this service makes and bind-mounts into a step's
# container (`isolate.ts`) is writable there. Any other uid and every write
# inside an isolated step fails with a permission error. The Docker socket
# is a different matter — its group is the host's, and compose adds this
# user to it with `group_add`.
USER bun

ENV NODE_ENV=production \
    EXECUTION_HOST=docker \
    RUNNER_PORT=8080 \
    FACTORY_STATE_DIR=/srv/factory/state \
    FACTORY_WORK_DIR=/srv/factory/runs

EXPOSE 8080

# Liveness, unauthenticated, from inside: `/health` answers anyone, and a
# container whose runner does not answer it is restarted by its policy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD bun -e "fetch('http://localhost:' + (process.env.RUNNER_PORT || 8080) + '/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

WORKDIR /srv/factory/apps/runner
CMD ["bun", "src/index.ts"]
