FROM docker.io/library/debian@sha256:a72b4433de1cf7d6bae0c4cee74d0547f58601a643b3375f070c51600d63b6b2
RUN rm -f /etc/apt/sources.list.d/debian.sources && \
    printf '%s\n' \
      'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/20261123T000000Z/ trixie main' \
      'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/20261123T000000Z/ trixie-security main' \
      > /etc/apt/sources.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends bpftool clang gcc libc6-dev libbpf-dev linux-libc-dev make && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /src
CMD ["make", "all"]
