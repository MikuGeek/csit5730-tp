{ pkgs, lib, ... }:

let
  clang = pkgs.llvmPackages.clang-unwrapped;
  node = pkgs.nodejs_22;
  typstArchive = package: hash: pkgs.fetchurl {
    url = "https://packages.typst.org/preview/${package}.tar.gz";
    inherit hash;
  };
  unpackPreview = name: version: hash: ''
    mkdir -p "$out/preview/${name}/${version}"
    tar -xzf ${typstArchive "${name}-${version}" hash} -C "$out/preview/${name}/${version}"
  '';
  slidePackages = pkgs.runCommand "tracetriage-typst-packages" { } (lib.concatStrings [
    (unpackPreview "touying" "0.8.0" "sha256-f+nu7sxWFPIe5k/+lcFB02qxrgtOyWHm6r8Tq4de9cE=")
    (unpackPreview "uniwarn" "0.1.1" "sha256-aCR0MtqxsWXBYFVBHA8OwVSmPX/PXvD2WQYmlpXTaOo=")
    (unpackPreview "lilaq" "0.6.0" "sha256-QeeDnp5Or1wLXsk/I9OHIzvOQ5/iJjJrBsL6AfL8JR8=")
    (unpackPreview "fletcher" "0.5.8" "sha256-phiDpK9MqSOjfFl5AOZ09A2tP3vePyo9j+gELmyopms=")
    (unpackPreview "cetz" "0.3.4" "sha256-T0tajTEdUZ50mUCnZv5QUh5AwEESnhyRrwxC5h8wdRQ=")
    (unpackPreview "oxifmt" "0.2.1" "sha256-FvrCkjAyxZcn3gHoTULKxF6HkNoo31bv/KSfTeQbCdk=")
    (unpackPreview "elembic" "1.1.1" "sha256-46jsayrV9D2TrjHdV0LeclbFdxlnVjYXnNgY8mynu4g=")
    (unpackPreview "tiptoe" "0.4.0" "sha256-G+dywzWQKnVUtRZKWkFFv9iGhnrBsmR4t01eS/nraz8=")
    (unpackPreview "zero" "0.6.1" "sha256-h//sDVkVUatdFGXEBYLkRBh23Y9w74ii1Xcpf1l3do8=")
  ]);
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
  languages.typst = {
    enable = true;
  };

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

  scripts.tt-slides = {
    description = "Compile the Touying course presentation to build/slides/tracetriage.pdf";
    exec = inRoot + ''
      mkdir -p build/slides
      exec typst compile --ignore-system-fonts --font-path ${pkgs.ibm-plex}/share/fonts \
        --package-path ${slidePackages} \
        slides/main.typ build/slides/tracetriage.pdf
    '';
  };

  enterTest = ''
    set -e
    tt-build -B all
    tt-test
  '';
}
