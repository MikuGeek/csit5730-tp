#!/usr/bin/env bash
set -euo pipefail

if [[ $# -gt 1 || $(uname -m) != x86_64 || $(uname -s) != Linux ]]; then
    echo "Usage on x86-64 Linux: tt-bundle [output.tar.gz]" >&2
    exit 2
fi

archive=$(realpath -m -- "${1:-build/tracetriage-debian-amd64.tar.gz}")
if [[ -e "$archive" || -L "$archive" ]]; then
    echo "Refusing to overwrite $archive" >&2
    exit 2
fi
mkdir -p -- "$(dirname -- "$archive")"
staging=$(mktemp -d)
trap 'rm -rf -- "$staging"' EXIT
mkdir -p "$staging/build" "$staging/ids" "$staging/src/ids"
cp -- Makefile "$staging/src/"
cp -- ids/{event.h,probes.bpf.c,reader.c,workload.c} "$staging/src/ids/"
image=localhost/tracetriage-builder:debian13-amd64

podman build --platform linux/amd64 --tag "$image" -f Containerfile . >&2
podman run --rm --network none --platform linux/amd64 \
    -v "$staging/src:/src:ro" -v "$staging/build:/out:rw" "$image" \
    make BUILD_DIR=/out all >&2

readelf -l "$staging/build/reader" | grep -F '/lib64/ld-linux-x86-64.so.2' >&2
readelf -d "$staging/build/reader" | grep -F 'libbpf.so.1' >&2
cp -- ids/*.py "$staging/ids/"
tar --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner --mode='u+rw,go=rX' \
    -C "$staging" -cf - build/reader build/workload ids | gzip -n > "$staging/deploy.tar.gz"
(set -o noclobber; cat "$staging/deploy.tar.gz" > "$archive")
printf '%s\n' "$archive"
