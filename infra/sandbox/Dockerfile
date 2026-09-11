# The run sandbox: one fresh one per run, released when the run ends, never
# reused (constitution Architectural Invariants; 001 FR-046, FR-047).
#
# This is a LAYER over the sandbox SDK's published base image, not an image of
# our own. The SDK reaches a sandbox only through a control server at
# `/container-server/sandbox`, which is the base image's entrypoint — an image
# that replaces the entrypoint cannot be driven by the SDK at all
# (specs/002-hosted-runner-sandboxes, D10).
#
# The tag MUST match the `@cloudflare/sandbox` version in
# `apps/runner/package.json`. That is not just tidiness: the SDK checks the two
# against each other and refuses a mismatch.
#
# Build for linux/amd64:
#   docker buildx build --platform linux/amd64 -t <registry>/code-factory-sandbox:<tag> infra/sandbox
FROM docker.io/cloudflare/sandbox:0.12.9

# The base is Ubuntu-derived and already carries git, curl, Node and Bun, so
# this layer adds only the two agent engines and the unprivileged user.
USER root

# Both agent engines live here, never in our own services (001 research D6).
#
# No `|| true`. An image missing the Claude CLI builds fine and then fails
# every agent step with an error that says nothing about the image, which is a
# worse outcome than a failed build — so each install is verified and a broken
# one stops the build here.
RUN curl -fsSL https://claude.ai/install.sh | bash -s -- --bin-dir /usr/local/bin \
    && claude --version
RUN curl -fsSL https://pen.dev/install.sh | bash -s -- --bin-dir /usr/local/bin \
    && pen --version

# A step's work runs as this user, and the workspace belongs to it (002 FR-003).
#
# Note what this does NOT do: it does not `USER factory`. The control server
# the SDK talks to is the entrypoint and needs its own privileges, so the
# image cannot simply drop to an unprivileged user the way
# `docker run --user 1000:1000` did. Commands are run as `factory` by the
# execution host instead (002 T025).
#
# That is weaker than what the Docker host gave us — the work is unprivileged
# but the process supervising it is not — and it is recorded as an accepted
# violation in the plan's Complexity Tracking rather than glossed over. T005
# is the spike that confirms the arrangement works at all.
RUN useradd --create-home --shell /bin/bash factory \
    && mkdir -p /work \
    && chown factory:factory /work

# The workspace. Steps hand off through files here, so each step reads what
# earlier steps wrote (constitution Architectural Invariants). Matches WORKDIR
# in apps/runner/src/container/start.ts.
ENV FACTORY_WORKDIR=/work

# Deliberately no ENTRYPOINT and no CMD: both belong to the base image. A
# previous version of this file set `ENTRYPOINT ["/bin/bash","-lc"]` with
# `CMD ["sleep infinity"]`, which builds and deploys perfectly and then hangs
# every request, because nothing is listening for the SDK to talk to.
#
# Credentials arrive as environment when the sandbox is created and are never
# written into the workspace (constitution Principle V; 001 FR-083).
