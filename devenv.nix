{ pkgs, lib, ... }:

let
  clang = pkgs.llvmPackages.clang-unwrapped;
  node = pkgs.nodejs_22;
  npmSource = lib.fileset.toSource {
    root = ./.;
    fileset = lib.fileset.unions [ ./package.json ./package-lock.json ];
  };
  analystDeps = pkgs.buildNpmPackage {
    pname = "tracetriage-analyst-deps";
    version = "0.1.0";
    src = npmSource;
    nodejs = node;
    npmDeps = pkgs.importNpmLock { npmRoot = npmSource; };
    npmConfigHook = pkgs.importNpmLock.npmConfigHook;
    npmFlags = [ "--ignore-scripts" ];
    dontNpmBuild = true;
    installPhase = ''
      runHook preInstall
      mkdir -p "$out"
      mv node_modules "$out/node_modules"
      runHook postInstall
    '';
  };
  inRoot = ''
    set -euo pipefail
    cd "$DEVENV_ROOT"
  '';
in
{
  packages = with pkgs; [
    bashInteractive
    binutils
    bpftools
    cacert
    clang
    coreutils
    curl
    file
    git
    gnumake
    gnutar
    gzip
    jq
    libbpf
    linuxHeaders
    node
    openssh
    pkg-config
    podman
    python313
    stdenv.cc
  ];

  env = {
    BPF_CLANG = "${clang}/bin/clang";
    BPF_CPPFLAGS = "-I${pkgs.linuxHeaders}/include -I${lib.getDev pkgs.libbpf}/include${lib.optionalString (pkgs.stdenv.hostPlatform.isGnu) " -I${lib.getDev pkgs.glibc}/include"}";
    TRACETRIAGE_NODE_MODULES = "${analystDeps}/node_modules";
    PYTHONDONTWRITEBYTECODE = "1";
    npm_config_fund = "false";
    npm_config_audit = "false";
  };

  scripts.tt-setup = {
    description = "Link the lockfile-pinned Pi dependencies into a fresh checkout";
    exec = inRoot + ''
      if [[ -L node_modules ]]; then
        current=$(readlink node_modules)
        if [[ "$current" != "$TRACETRIAGE_NODE_MODULES" && "$current" != /nix/store/*/node_modules ]]; then
          echo "Refusing to replace an unmanaged node_modules symlink." >&2
          exit 1
        fi
        ln -sfn "$TRACETRIAGE_NODE_MODULES" node_modules
      elif [[ -e node_modules ]]; then
        echo "Existing node_modules is unmanaged; move it aside before running tt-setup." >&2
        exit 1
      else
        ln -s "$TRACETRIAGE_NODE_MODULES" node_modules
      fi
    '';
  };

  scripts.tt-build = {
    description = "Build native Linux tools; do not deploy these binaries to Debian";
    exec = inRoot + ''
      exec make BUILD_DIR=build/native CLANG="$BPF_CLANG" "$@"
    '';
  };

  scripts.tt-test = {
    description = "Run deterministic Python and Pi tests; no VPS or model API";
    exec = inRoot + ''
      tt-setup
      exec make test "$@"
    '';
  };

  scripts.tt-semantic = {
    description = "Run the semantic benchmark; pass --live to opt in to inference";
    exec = inRoot + ''
      tt-setup
      exec node analyst/semantic-replay.mjs "$@"
    '';
  };

  scripts.tt-bundle = {
    description = "Build and archive Debian-compatible sensor binaries for x86-64";
    exec = inRoot + ''
      exec bash scripts/bundle-debian.sh "$@"
    '';
  };

  enterTest = ''
    set -e
    tt-build -B all
    tt-test
  '';
}
