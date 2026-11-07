#!/usr/bin/env bash
set -euo pipefail
# Optional local Windows/WSL test helper. No sudo or system installation.
# Redis is built from a pinned official source release inside ignored workspace state.
workspace="$(cd "$(dirname "$0")/.." && pwd)"
build_dir="$workspace/.local-services/redis"
mkdir -p "$build_dir"
if [ ! -x "$build_dir/redis-7.4.2/src/redis-server" ]; then
  curl --fail --location --connect-timeout 10 --max-time 60 \
    https://download.redis.io/releases/redis-7.4.2.tar.gz -o "$build_dir/source.tar.gz"
  tar -xzf "$build_dir/source.tar.gz" -C "$build_dir"
  make -C "$build_dir/redis-7.4.2" -j2 MALLOC=libc BUILD_TLS=no
fi
"$build_dir/redis-7.4.2/src/redis-server" --version
