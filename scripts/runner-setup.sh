#!/usr/bin/env bash
# Rootless setup for the Agent Desk runner pod (uid 10001, no sudo, no Docker socket, no Nix, no user namespaces).
# Runs in the cloned repo (cwd = repo root). Node 22, git and curl are already in the runner image.
# Idempotent: rerun it any time (for example with a bigger profile); finished steps are skipped.
#
# RUNNER_SETUP_PROFILE picks how much to install (docs/runbooks/runner-pod.md):
#   minimal  pnpm, .env, dependencies. Enough for `pnpm test:unit` minus the worker's Temporal tests.
#   test     (default) + Postgres binaries and the Temporal CLI / test server, so `pnpm test` and the e2e
#            stack (scripts/runner-stack.sh) run offline with no container engine.
#   full     + Playwright Chromium (headless shell) and the system libraries it needs, for the web e2e suites.
#
# RUNNER_ENABLE_SERENA=1 also installs Serena (semantic code tools) for Claude Code, for any profile
# (scripts/runner-serena.sh). Unset or 0 = off.
# Everything lands under $HOME (RUNNER_TOOLS_DIR, default ~/.local/opt/runner-tools). Every download is pinned and
# sha256-checked before it is unpacked; a mismatch stops the script. Debian packages come through apt, which checks
# them against the signed archive index. Afterwards: `source scripts/runner-env.sh`.
set -euo pipefail

profile="${RUNNER_SETUP_PROFILE:-test}"
case "$profile" in
  minimal | test | full) ;;
  *)
    echo "runner-setup: RUNNER_SETUP_PROFILE must be minimal, test or full" >&2
    exit 64
    ;;
esac

case "${RUNNER_ENABLE_SERENA:-0}" in
  0 | 1) ;;
  *)
    echo "runner-setup: RUNNER_ENABLE_SERENA must be unset, 0 or 1" >&2
    exit 64
    ;;
esac

BIN="$HOME/.local/bin"
TOOLS="${RUNNER_TOOLS_DIR:-$HOME/.local/opt/runner-tools}"
mkdir -p "$BIN"
export PATH="$BIN:$PATH"
start_s=$SECONDS
step() { echo "==> [$((SECONDS - start_s))s] $*"; }

# --- Pins (bump a version together with its sha256 values; a stale pin fails closed) ---
PG_VERSION=18.6.0-beta.19 # npm @embedded-postgres/linux-<arch> (zonky PostgreSQL 18 build)
TEMPORAL_CLI_VERSION=1.10.1 # matches the dev server @temporalio/testing 1.25.0 picks by default
TEMPORAL_TEST_SERVER_VERSION=1.40.0 # time-skipping server, released with sdk-java
PLAYWRIGHT_VERSION=1.65.0 # must equal the playwright version apps/web installs
CHROMIUM_BUILD=158.0.8127.18
CHROMIUM_REVISION=1254
# Sets the sha256 pins for one CPU architecture.
select_pins() {
  case "$1" in
    arm64)
      PG_SHA256=2894f8d2b71f1eca8920ca9e76ed1fd6e9ea60f35dcfc743003df5d2f231f5e0
      TEMPORAL_CLI_SHA256=2f748e9411b37c9cabb57f1f08e37765388c12b5534432c7aea28b593df9145d
      TEMPORAL_TEST_SERVER_SHA256=1d712f6f1de8a97454185d335752d0f9ea8267797c340b55569312251f6670e9
      CHROMIUM_SHA256=b136462898353d94c7fab50f9cdaa6d8f0d4c190153916936aa0a03353a26bf2
      ;;
    amd64)
      PG_SHA256=ae8a5b7a7c66f8ad7105da6106e7edec4f7a51534fc50d7f9114be9a6e81ec1e
      TEMPORAL_CLI_SHA256=4c1500e2ce2d4de136e5fe8852d9b7f82eb62f19b6b383b3e0c040519a9d20b1
      TEMPORAL_TEST_SERVER_SHA256=524465a96274831e004326f6e2f2a5f3ef9aaed72c2069cf16c1d64b8b1ec3ca
      CHROMIUM_SHA256=18352d22cb0cdf520cbff2ad8c41391f0e02a72886cb53b0fde4bdfc4bd075d6
      ;;
  esac
}
# Chromium's shared libraries missing from node:22-slim (bookworm), a font (headless Chromium aborts when fontconfig
# finds none), and unzip to unpack the browser.
CHROMIUM_DEBS=(libglib2.0-0 libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 libdbus-1-3 libx11-6
  libxcomposite1 libxdamage1 libxext6 libxfixes3 libxrandr2 libgbm1 libxcb1 libxkbcommon0 libasound2 libfontconfig1
  fonts-liberation unzip)

step "1/4 Tooling check (profile: $profile)"
node -v
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if (a<22 || (a===22 && b<9)) { console.error("need Node >= 22.9"); process.exit(1) }'

step "2/4 pnpm via corepack (into \$HOME, not /usr/local)"
PNPM_VERSION="$(node -p 'require("./package.json").packageManager.split("@")[1]')"
corepack enable --install-directory "$BIN" pnpm
corepack prepare "pnpm@${PNPM_VERSION}" --activate
pnpm -v

step "3/4 Env file"
[ -f .env ] || cp .env.example .env

step "4/4 Install dependencies"
pnpm install --frozen-lockfile

if [ "${RUNNER_ENABLE_SERENA:-0}" = 1 ]; then
  step "Serena (opt-in)"
  bash scripts/runner-serena.sh
fi

if [ "$profile" = minimal ]; then
  step "Ready (minimal). Next: pnpm typecheck && pnpm test:unit"
  exit 0
fi

if [ "$(uname -s)" != Linux ]; then
  echo "runner-setup: test tools are only installed on Linux (the runner pod); use devbox + Docker here." >&2
  exit 0
fi
case "$(uname -m)" in
  aarch64 | arm64) arch=arm64 ;;
  x86_64 | amd64) arch=amd64 ;;
  *)
    echo "runner-setup: unsupported CPU $(uname -m)" >&2
    exit 1
    ;;
esac
select_pins "$arch"

mkdir -p "$TOOLS"
work="$(mktemp -d "$TOOLS/.download.XXXXXX")"
trap 'rm -rf "$work"' EXIT

# fetch <url> <sha256> <file>: download into the scratch dir and refuse anything that does not match the pin.
fetch() {
  local url="$1" want="$2" out="$work/$3" got
  curl -fsSL --proto '=https' --tlsv1.2 --retry 3 -o "$out" "$url"
  got="$(sha256sum "$out" | cut -d' ' -f1)"
  if [ "$got" != "$want" ]; then
    echo "runner-setup: sha256 mismatch for $url (want $want, got $got); refusing to install" >&2
    exit 1
  fi
}

# finish <staged dir> <dest dir> <link>: moves a verified, unpacked payload into place, marks it complete and points
# the stable symlink $TOOLS/<link> (what runner-env.sh uses) at it.
finish() {
  local staged="$1" dest="$2" link="$3"
  rm -rf "$dest"
  mv "$staged" "$dest"
  touch "$dest/.complete"
  ln -sfn "$(basename "$dest")" "$TOOLS/$link"
}

step "5/7 PostgreSQL $PG_VERSION binaries"
pg_dir="$TOOLS/postgresql-$PG_VERSION"
if [ -f "$pg_dir/.complete" ]; then
  echo "already installed"
else
  npm_arch=$([ "$arch" = amd64 ] && echo x64 || echo arm64)
  fetch "https://registry.npmjs.org/@embedded-postgres/linux-$npm_arch/-/linux-$npm_arch-$PG_VERSION.tgz" \
    "$PG_SHA256" pg.tgz
  mkdir -p "$work/pg"
  tar -xzf "$work/pg.tgz" -C "$work/pg" --no-same-owner package/native
  # The package ships its library symlinks as a JSON list (npm tarballs cannot hold symlinks).
  node -e '
    const fs = require("fs"), path = require("path");
    const root = process.argv[1];
    for (const { source, target } of JSON.parse(fs.readFileSync(path.join(root, "native/pg-symlinks.json"), "utf8"))) {
      const s = path.resolve(root, source), t = path.resolve(root, target);
      if (!s.startsWith(root + "/native/") || !t.startsWith(root + "/native/")) throw new Error("symlink outside package");
      fs.rmSync(t, { force: true });
      fs.symlinkSync(path.relative(path.dirname(t), s), t);
    }' "$work/pg/package"
  finish "$work/pg/package/native" "$pg_dir" postgresql
fi
"$TOOLS/postgresql/bin/postgres" --version

step "6/7 Temporal CLI $TEMPORAL_CLI_VERSION and test server $TEMPORAL_TEST_SERVER_VERSION"
cli_dir="$TOOLS/temporal-cli-$TEMPORAL_CLI_VERSION"
if [ -f "$cli_dir/.complete" ]; then
  echo "temporal CLI already installed"
else
  fetch "https://temporal.download/assets/temporalio/cli/releases/download/v$TEMPORAL_CLI_VERSION/temporal_cli_${TEMPORAL_CLI_VERSION}_linux_$arch.tar.gz" \
    "$TEMPORAL_CLI_SHA256" cli.tgz
  mkdir -p "$work/cli"
  tar -xzf "$work/cli.tgz" -C "$work/cli" --no-same-owner temporal
  finish "$work/cli" "$cli_dir" temporal-cli
fi
ln -sfn "$TOOLS/temporal-cli/temporal" "$BIN/temporal"
tts_dir="$TOOLS/temporal-test-server-$TEMPORAL_TEST_SERVER_VERSION"
if [ -f "$tts_dir/.complete" ]; then
  echo "temporal test server already installed"
else
  tts_name="temporal-test-server_${TEMPORAL_TEST_SERVER_VERSION}_linux_$arch"
  fetch "https://temporal.download/assets/temporalio/sdk-java/releases/download/v$TEMPORAL_TEST_SERVER_VERSION/$tts_name.tar.gz" \
    "$TEMPORAL_TEST_SERVER_SHA256" tts.tgz
  mkdir -p "$work/tts"
  tar -xzf "$work/tts.tgz" -C "$work/tts" --no-same-owner --strip-components=1 "$tts_name/temporal-test-server"
  chmod 0755 "$work/tts/temporal-test-server"
  finish "$work/tts" "$tts_dir" temporal-test-server
fi
temporal --version

if [ "$profile" != full ]; then
  step "Ready (test). Next: source scripts/runner-env.sh && pnpm test"
  exit 0
fi

step "7/7 Playwright Chromium $CHROMIUM_BUILD (headless shell) and its system libraries"
pw_have="$(node -p 'require(require.resolve("playwright/package.json", { paths: ["apps/web"] })).version')"
if [ "$pw_have" != "$PLAYWRIGHT_VERSION" ]; then
  echo "runner-setup: apps/web uses playwright $pw_have but the Chromium pin is for $PLAYWRIGHT_VERSION;" \
    "update the CHROMIUM_* pins in scripts/runner-setup.sh" >&2
  exit 1
fi
syslibs="$TOOLS/syslibs"
# Named after the package list, so changing CHROMIUM_DEBS installs a fresh copy.
syslibs_dir="$syslibs-$(printf '%s\n' "${CHROMIUM_DEBS[@]}" | sha256sum | cut -c1-12)"
if [ -f "$syslibs_dir/.complete" ]; then
  echo "system libraries already installed"
else
  # apt with its state and cache under $HOME: download only (no root), then unpack the debs without installing.
  apt_dir="$work/apt"
  mkdir -p "$apt_dir/lists/partial" "$apt_dir/cache/archives/partial" "$work/syslibs"
  # The image's docker-clean hooks would try to empty the root-owned /var/cache/apt; drop them for this apt.
  printf '#clear APT::Update::Post-Invoke;\n#clear DPkg::Post-Invoke;\n' >"$apt_dir/apt.conf"
  apt_opts=(-c "$apt_dir/apt.conf" -o "Dir::State::Lists=$apt_dir/lists" -o "Dir::Cache=$apt_dir/cache"
    -o Debug::NoLocking=1 -o "APT::Sandbox::User=$(id -un)")
  apt-get "${apt_opts[@]}" update -qq
  apt-get "${apt_opts[@]}" install -qq -y --download-only --no-install-recommends "${CHROMIUM_DEBS[@]}" >/dev/null
  for deb in "$apt_dir"/cache/archives/*.deb; do dpkg -x "$deb" "$work/syslibs"; done
  # Fontconfig's own config points at /usr/share/fonts; this one points at the unpacked fonts (FONTCONFIG_FILE in
  # runner-env.sh). The paths are this script's own install dirs, never input.
  printf '%s\n' '<?xml version="1.0"?>' '<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">' '<fontconfig>' \
    "  <dir>$syslibs_dir/usr/share/fonts</dir>" "  <cachedir>$syslibs_dir/fontconfig-cache</cachedir>" \
    '</fontconfig>' >"$work/syslibs/fonts.conf"
  finish "$work/syslibs" "$syslibs_dir" syslibs
fi
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
shell_dir="$PLAYWRIGHT_BROWSERS_PATH/chromium_headless_shell-$CHROMIUM_REVISION"
if [ -f "$shell_dir/INSTALLATION_COMPLETE" ]; then
  echo "chromium headless shell already installed"
else
  cft_arch=$([ "$arch" = amd64 ] && echo linux64 || echo linux-arm64)
  fetch "https://cdn.playwright.dev/builds/cft/$CHROMIUM_BUILD/$cft_arch/chrome-headless-shell-$cft_arch.zip" \
    "$CHROMIUM_SHA256" chromium.zip
  mkdir -p "$work/chromium"
  LD_LIBRARY_PATH="$syslibs/usr/lib/$(uname -m)-linux-gnu" \
    "$syslibs/usr/bin/unzip" -q "$work/chromium.zip" -d "$work/chromium"
  # Playwright treats a browser dir with these markers as installed (same as `playwright install`).
  touch "$work/chromium/INSTALLATION_COMPLETE" "$work/chromium/DEPENDENCIES_VALIDATED"
  mkdir -p "$PLAYWRIGHT_BROWSERS_PATH"
  rm -rf "$shell_dir"
  mv "$work/chromium" "$shell_dir"
fi
# shellcheck source=scripts/runner-env.sh
. scripts/runner-env.sh
# Render text, not just launch: without fonts Chromium starts fine and aborts on the first page with text.
node -e '
  const { chromium } = require(require.resolve("playwright", { paths: ["apps/web"] }));
  (async () => {
    const b = await chromium.launch();
    const p = await b.newPage();
    await p.setContent("<h1>Agent Desk</h1>");
    await p.screenshot();
    console.log("chromium", b.version(), "renders", JSON.stringify(await p.textContent("h1")));
    await b.close();
  })().catch((e) => { console.error(String(e).split("\n").slice(0, 8).join("\n")); process.exit(1); });'

step "Ready (full). Next: source scripts/runner-env.sh && pnpm test; e2e: docs/runbooks/runner-pod.md"
