#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'HELP'
Usage: ./scripts/start.sh [--host ADDRESS] [docker compose up options]

Detect the host's LAN IPv4 address and start SongList with Docker Compose.
Defaults to: docker compose up --build -d
An exported PUBLIC_HOST or --host overrides automatic detection.
ADMIN_PASSWORD can still be configured in .env.

Examples:
  ./scripts/start.sh
  ./scripts/start.sh --no-build
  ./scripts/start.sh --host 192.168.1.50
HELP
}

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  --host)
    if [[ -z "${2:-}" ]]; then
      echo "--host requires an IPv4 address." >&2
      exit 1
    fi
    export PUBLIC_HOST="$2"
    shift 2
    ;;
esac

detect_host() {
  local platform release
  platform="$(uname -s)"
  release="$(uname -r)"
  case "$platform:$release" in
    *[Mm]icrosoft*|MINGW*|MSYS*|CYGWIN*)
      # WSL's default route describes its virtual network. Ask Windows for
      # the address on a physical interface with an IPv4 default gateway.
      command -v powershell.exe >/dev/null 2>&1 || return 1
      powershell.exe -NoProfile -NonInteractive -Command '
        $ErrorActionPreference = "Stop"
        $config = Get-NetIPConfiguration | Where-Object {
          $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq "Up" -and
          $_.InterfaceAlias -notlike "vEthernet*"
        } | Sort-Object { $_.NetIPv4Interface.InterfaceMetric } | Select-Object -First 1
        if (-not $config) { exit 1 }
        $config.IPv4Address | Select-Object -First 1 -ExpandProperty IPAddress
      ' | tr -d '\r'
      ;;
    Linux:*)
      command -v ip >/dev/null 2>&1 || return 1
      # This only queries routing; it does not send packets to this address.
      ip -4 route get 1.1.1.1 | awk '{for (i=1; i<NF; i++) if ($i == "src") {print $(i+1); exit}}'
      ;;
    Darwin:*)
      local interface
      interface="$(route -n get default | awk '$1 == "interface:" {print $2; exit}')"
      [[ -n "$interface" ]] || return 1
      ipconfig getifaddr "$interface"
      ;;
    *) return 1 ;;
  esac
}

if [[ -z "${PUBLIC_HOST:-}" ]]; then
  PUBLIC_HOST="$(detect_host)" || {
    echo "Could not detect the host's LAN address. Retry with --host YOUR_LAN_IP." >&2
    exit 1
  }
fi

# Never advertise a loopback, link-local, or malformed address as the LAN host.
if [[ ! "$PUBLIC_HOST" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
  echo "Expected a LAN IPv4 address; use --host YOUR_LAN_IP." >&2
  exit 1
fi
IFS=. read -r first second third fourth <<< "$PUBLIC_HOST"
for octet in "$first" "$second" "$third" "$fourth"; do
  if (( 10#$octet > 255 )); then
    echo "Invalid IPv4 address: $PUBLIC_HOST" >&2
    exit 1
  fi
done
if (( 10#$first == 0 || 10#$first == 127 || 10#$first >= 224 || (10#$first == 169 && 10#$second == 254) )); then
  echo "Detected address is not a usable LAN address. Retry with --host YOUR_LAN_IP." >&2
  exit 1
fi

export PUBLIC_HOST
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"
echo "Starting SongList with host address $PUBLIC_HOST"
exec docker compose up --build -d "$@"
