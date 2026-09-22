# The run sandbox: one fresh container per run, non-root, destroyed at the end
# (constitution Architectural Invariants; 001 FR-046, FR-047).
#
# No ENTRYPOINT and no CMD, and that is load-bearing. The host keeps a
# container alive by running `sleep <seconds>` AS THE COMMAND, so an image
# with an entrypoint of its own would turn that command into arguments for the
# entrypoint — `ENTRYPOINT ["/bin/bash","-lc"]` made `sleep 5400` into bash
# running `sleep` with no operand, and the container exited before the first
# step. A contract test reads this file to make sure neither comes back.
#
#   docker build -t code-factory/sandbox:latest infra/sandbox
FROM node:22-bookworm-slim

# Node and npm come with the base. `git` is what a run actually needs on top;
# `ca-certificates` is what makes the clone and the model calls work at all.
#
# `jq` is here because an agent reaches for it constantly and its absence is
# expensive rather than fatal: a run was observed probing for `jq`, `python3`
# and `bun`, finding none, and then writing every small JSON read as a
# `node -e` one-liner for the rest of the step. One small package removes
# that. Nothing heavier is added on the same argument — a browser is the
# thing agents reach for next, and that one is answered by telling them not
# to rather than by shipping three hundred megabytes into every sandbox.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates jq \
    && rm -rf /var/lib/apt/lists/*

# Both agent engines live here, never in our own services (001 research D6).
#
# From npm, pinned, and each install VERIFIED by running or locating the
# binary. The previous version of this file piped an install script with
# `--bin-dir /usr/local/bin || true` — a flag that does not exist, on a script
# that takes a positional argument, with the failure swallowed. **The Claude
# CLI was never in this image**, and every agent step would have failed with an
# error saying nothing about the cause.
#
# `pen` is verified by presence rather than by running it: `pen --version`
# demands authentication, and there is no credential at build time by design —
# credentials reach a sandbox as environment when the run starts (Principle V).
RUN npm install -g @anthropic-ai/claude-code@2.1.268 @pen.dev/cli@0.3.7 \
    && claude --version \
    && npm ls -g --depth=0 @anthropic-ai/claude-code @pen.dev/cli \
    && command -v pen \
    && npm cache clean --force \
    && rm -rf /root/.npm /tmp/*

# `bun`, because a pipeline's shell steps run whatever the target repository
# uses and that is increasingly bun rather than npm.
#
# This was learned the expensive way in the other direction: a pipeline was
# given `npm ci` for a repository that declares `"packageManager": "bun"` and
# ships a `bun.lock` with no `package-lock.json`, and every run died at
# `npm error The 'npm ci' command can only install with an existing
# package-lock.json`. Correcting the pipeline to bun then meant the image had
# to have it, and the `sandbox` skill — which told agents bun was absent —
# had to stop saying so.
#
# From npm rather than bun.sh's install script: the script wants `curl` and
# `unzip`, neither of which is here for anything else, and the npm package
# fetches the same binary. Pinned and verified, on the same argument as the
# engines above. 1.3 rather than the 1.1 a repository may name, because
# `bun.lock` is a 1.2 format and 1.1 cannot read it.
RUN npm install -g bun@1.3.14 \
    && bun --version \
    && npm cache clean --force \
    && rm -rf /root/.npm /tmp/*

# The workspace, owned by UID 1000 — which is what `container/host.ts` passes
# as `--user 1000:1000`, because an agent runs arbitrary code against a
# customer repository (001 FR-046). The `node` base image already has a user at
# that id, so this grants the workspace rather than creating a second one.
RUN mkdir -p /work && chown 1000:1000 /work

USER 1000:1000
WORKDIR /work
ENV FACTORY_WORKDIR=/work

# A writable HOME, stated rather than inherited.
#
# `host.ts` starts the container with `--user 1000:1000`, a NUMERIC user.
# Docker resolves a home directory from `/etc/passwd` only when the user is
# named, so a numeric one gets `HOME=/` — a directory this uid cannot write.
# Everything in this image keeps state under the home: `bun` its install
# cache, `npm` its own, `claude` its `~/.claude`, `pen` its credentials. Each
# would fail at its first write, and for reasons naming a path rather than a
# permission.
#
# `/home/node` already exists and already belongs to uid 1000 — the base
# image's own `node` user is that id — so this names what is there rather
# than creating anything.
ENV HOME=/home/node

# Deliberately NO ENTRYPOINT and no CMD.
#
# `dockerHost.create` ends its argument list with `<image> sleep <seconds>`, so
# the container's command IS the sleep that keeps it alive for the run's
# wall-clock ceiling. An `ENTRYPOINT ["/bin/bash","-lc"]` — which this file used
# to carry — turns that into `bash -lc sleep <seconds>`, where bash takes
# `sleep` as the script and the number as $0. The result is `sleep` with no
# operand, a non-zero exit, and a container that is gone before the first step
# runs.
