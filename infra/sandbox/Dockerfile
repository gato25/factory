# One fresh container per run, non-root, destroyed at the end (FR-046, FR-047).
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/*

# Both agent engines live here, never in our own services (research.md D6).
RUN curl -fsSL https://claude.ai/install.sh | bash -s -- --bin-dir /usr/local/bin || true
RUN curl -fsSL https://pen.dev/install.sh | bash -s -- --bin-dir /usr/local/bin || true

# Non-root: an agent runs arbitrary code against a customer repository.
RUN useradd --create-home --shell /bin/bash factory \
    && mkdir -p /work && chown factory:factory /work

USER factory
WORKDIR /work

# Credentials arrive as environment at container start and are never written
# into the workspace (Constitution Principle V, FR-083).
ENTRYPOINT ["/bin/bash", "-lc"]
CMD ["sleep infinity"]
