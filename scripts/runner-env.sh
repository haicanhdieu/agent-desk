# shellcheck shell=bash
# Source me (`. scripts/runner-env.sh`) after scripts/runner-setup.sh. Exports what the tests need to use the
# rootless tools in $HOME instead of Docker and runtime downloads. Only exports what is installed, so it is safe to
# source after a minimal setup or on a machine without the tools (then it changes nothing but PATH).

_rt_tools="${RUNNER_TOOLS_DIR:-$HOME/.local/opt/runner-tools}"
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) export PATH="$HOME/.local/bin:$PATH" ;; esac

if [ -x "$_rt_tools/postgresql/bin/postgres" ]; then
  # startPg() (packages/db/src/testing.ts) runs one throwaway server per call from these binaries.
  export TEST_PG_MODE=local
  export TEST_PG_BIN_DIR="$_rt_tools/postgresql/bin"
fi
if [ -x "$_rt_tools/temporal-cli/temporal" ]; then
  export TEMPORAL_CLI_PATH="$_rt_tools/temporal-cli/temporal"
fi
if [ -x "$_rt_tools/temporal-test-server/temporal-test-server" ]; then
  export TEMPORAL_TEST_SERVER_PATH="$_rt_tools/temporal-test-server/temporal-test-server"
fi
if [ -d "$_rt_tools/syslibs" ]; then
  # Chromium's shared libraries, unpacked from Debian packages (no root). Only libraries the image lacks.
  _rt_multiarch="$(uname -m)-linux-gnu"
  _rt_libs="$_rt_tools/syslibs/usr/lib/$_rt_multiarch:$_rt_tools/syslibs/lib/$_rt_multiarch"
  case ":${LD_LIBRARY_PATH:-}:" in
    *":$_rt_libs:"*) ;;
    *) export LD_LIBRARY_PATH="$_rt_libs${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" ;;
  esac
  if [ -f "$_rt_tools/syslibs/fonts.conf" ]; then export FONTCONFIG_FILE="$_rt_tools/syslibs/fonts.conf"; fi
  export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
  unset _rt_multiarch _rt_libs
fi
unset _rt_tools
