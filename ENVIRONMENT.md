# Reproducible Development and Deployment

## Local Environment

- **Bootstrap:** x86-64 Linux, a working Nix installation, and devenv 2.4.0 (the tested CLI). No system-wide language toolchains or compiler packages are needed. The first build needs access to Nix caches and the lockfile's upstream sources; the Debian bundle also needs registry and Debian snapshot access on first build.
- **Pinned:** `devenv.lock` fixes nixpkgs and the devenv modules, including Node.js 22, Python 3.13, GCC, Clang with a BPF target, kernel headers, libbpf, bpftool, and Podman. `package-lock.json` fixes the analyst dependency versions and tarball integrity hashes. Nix installs the dependency tree into its store without running npm lifecycle scripts.
- **Local tests:** Python stdlib and Node's test runner; the Pi test doubles do not reach a VPS or model service. Rootless Podman is only used when building a Debian bundle and must be supported by the local Linux host (user namespaces and suitable storage). No Docker daemon is needed.

From the repo root:

```sh
devenv test
devenv shell
tt-setup
tt-build
tt-test
tt-semantic --split dev
```

`tt-build` writes native binaries to `build/native/`; they may reference the Nix store. `tt-setup` links only the Nix-managed `node_modules`. If you previously ran `npm ci`, move your existing `node_modules` directory outside the repo before using `tt-setup`. For optional direnv activation, run `direnv allow` after reviewing `.envrc`. Outside the shell, prefix individual tasks with `devenv shell --`, e.g. `devenv shell -- tt-test`.

## Build the Slides

```sh
devenv shell -- tt-slides
```

This compiles [`slides/main.typ`](./slides/main.typ) to `build/slides/tracetriage.pdf`. The [Material-themed slides](./slides/theme.typ) use IBM Plex Serif from the locked nixpkgs input. The compiler ignores system fonts. Nix pins Touying, Fletcher and CeTZ (architecture and flow diagrams), Lilaq (measurements), and their required dependencies by hash. Compilation needs no package downloads, VPS, raw results, or model credentials. See the [ten-minute speaker guide](./slides/talk.md) and [project skill](./.agents/skills/tracetriage-slides/SKILL.md).

The checked-in [Pre Alpha PDF](./slides/exports/tracetriage-pre-alpha.pdf) is a snapshot. Normal builds leave it untouched.

## Build a Debian Bundle

```sh
devenv shell -- tt-bundle
tar -tzf build/tracetriage-debian-amd64.tar.gz
```

- The archive contains the reader, loopback workload, and Python modules. It does not contain Node, the Nix store, private keys, or captured results.
- `Containerfile` pins the Debian base image by digest and APT to timestamped repositories. A non-networked container step compiles only the project C sources; the bundle checks that the reader uses the Debian x86-64 loader and `libbpf.so.1`. Use a different archive path as the optional argument to `tt-bundle` when rebuilding; it refuses to overwrite existing files.
- Use `devenv update` when intentionally refreshing Nix inputs and commit the changed lockfile. The OCI digest and APT snapshot are separate pins and should be reviewed together before rebuilding an updated Debian bundle.

## Target Checklist

The VPS is supplied externally. Use **Debian 13 x86-64**, Python 3.10 or newer, and `libbpf1` (Debian 13 supplies compatible versions). The kernel must expose BTF at `/sys/kernel/btf/vmlinux`, the three tracepoints, and writable cgroup v2. The runner needs root and permission to load BPF and attach tracepoints; root inside a restricted container may not suffice. IPv4 and IPv6 loopback must work. No Nix, compiler, Node, or model API access is needed on the VPS.

Transfer the bundle using your existing SSH configuration or equivalent. Authenticate the host key through a trusted channel. Do not embed private keys in commands, repository files, or `devenv.nix`. On the VPS, as root, extract into an empty directory and run:

```sh
tar -xzf tracetriage-debian-amd64.tar.gz
python3 -m ids.preflight
python3 -m ids.experiment --functional-only --output results/smoke
python3 -m ids.corpus_capture --cases 144 --output results/semantic-vps
```

Preflight does not attach a probe. The scoped smoke test verifies that attachment really works and checks all three local rules. To measure overhead, omit `--functional-only` and use a fresh output directory. Both runners use a temporary cgroup; no system service is installed. Copy the resulting JSONL and optional labels back for replay. Keep raw results local; `results/` is ignored by Git.

## Optional Live Inference

`devenv shell -- tt-semantic --capture results/semantic-vps/capture.jsonl` runs the deterministic evaluation without a model. To reproduce live replay, export `TRIAGE_BASE_URL` and `TRIAGE_MODEL` in the analyst shell and supply `TRIAGE_API_KEY` through your local secret manager if required. Then add `--live`. The endpoint can be a local OpenAI-compatible service or an HTTPS provider. Hosted model availability and outputs are not pinned by Nix; they affect only live replay, never the default build, local IDS, or deterministic tests.
