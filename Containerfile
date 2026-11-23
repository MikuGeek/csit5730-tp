FROM docker.io/library/debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    bpftool clang gcc libc6-dev libbpf-dev linux-libc-dev make && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /src
CMD ["make", "all"]
