#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

is_truthy() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

require_env() {
  local key="$1"
  if [[ -z "${!key:-}" ]]; then
    echo "缺少必需环境变量：$key" >&2
    exit 1
  fi
}

check_node() {
  if ! command -v node >/dev/null 2>&1; then
    echo "未找到 node，请先在青龙依赖管理中安装 Node.js 18 或更高版本。" >&2
    exit 1
  fi

  if ! node -e 'const major = Number(process.versions.node.split(".")[0]); process.exit(major >= 18 ? 0 : 1)' >/dev/null 2>&1; then
    echo "当前 Node.js 版本过低：$(node -v)。请使用 Node.js 18 或更高版本。" >&2
    exit 1
  fi
}

install_deps() {
  if [[ -x node_modules/.bin/tsx ]]; then
    return
  fi

  echo "首次运行，正在安装项目依赖..."
  if command -v pnpm >/dev/null 2>&1; then
    pnpm install --frozen-lockfile
    return
  fi

  if command -v corepack >/dev/null 2>&1; then
    corepack enable >/dev/null 2>&1 || true
    corepack pnpm install --frozen-lockfile
    return
  fi

  if command -v npm >/dev/null 2>&1; then
    npm install
    return
  fi

  echo "未找到 pnpm、corepack 或 npm，无法安装依赖。" >&2
  exit 1
}

prepare_data() {
  local default_data_dir
  if [[ -d /ql/data ]]; then
    default_data_dir="/ql/data/taygedo-auto-attendance"
  else
    default_data_dir="$PROJECT_ROOT/data"
  fi

  export TAYGEDO_DATA_DIR="${TAYGEDO_DATA_DIR:-$default_data_dir}"
  export TAYGEDO_ACCOUNTS_FILE="${TAYGEDO_ACCOUNTS_FILE:-$TAYGEDO_DATA_DIR/accounts.json}"
  export TAYGEDO_STATE_DIR="${TAYGEDO_STATE_DIR:-$TAYGEDO_DATA_DIR/state}"
  export TAYGEDO_CREDENTIAL_KEY_PATH="${TAYGEDO_CREDENTIAL_KEY_PATH:-$TAYGEDO_DATA_DIR/credential-key}"
  export TAYGEDO_ACCOUNT_STORE="${TAYGEDO_ACCOUNT_STORE:-file}"
  export TAYGEDO_STATE_STORE="${TAYGEDO_STATE_STORE:-file}"

  mkdir -p "$TAYGEDO_DATA_DIR" "$TAYGEDO_STATE_DIR"

  if [[ -n "${TAYGEDO_ACCOUNTS:-}" ]]; then
    if [[ ! -s "$TAYGEDO_ACCOUNTS_FILE" ]] || is_truthy "${TAYGEDO_ACCOUNTS_OVERWRITE:-}"; then
      printf '%s\n' "$TAYGEDO_ACCOUNTS" > "$TAYGEDO_ACCOUNTS_FILE"
      chmod 600 "$TAYGEDO_ACCOUNTS_FILE" || true
      echo "已从 TAYGEDO_ACCOUNTS 初始化账号文件：$TAYGEDO_ACCOUNTS_FILE"
    fi
  fi
}

run_cli() {
  node_modules/.bin/tsx src/runtimes/local-cli.ts "$@"
}

run_attendance() {
  local extra_args=()
  if is_truthy "${TAYGEDO_FORCE_RUN:-}"; then
    extra_args+=(--force)
  fi

  run_cli attendance \
    --accounts-file "$TAYGEDO_ACCOUNTS_FILE" \
    --state-dir "$TAYGEDO_STATE_DIR" \
    "${extra_args[@]}" \
    "$@"
}

run_login() {
  local mode="${TAYGEDO_LOGIN_MODE:-password}"
  local account_id="${TAYGEDO_LOGIN_ACCOUNT_ID:-${TAYGEDO_ACCOUNT_ID:-}}"
  local args=(login --mode "$mode")

  require_env TAYGEDO_LOGIN_PHONE
  args+=(--phone "$TAYGEDO_LOGIN_PHONE")

  if [[ "$mode" != "send-code" ]]; then
    if [[ -z "$account_id" ]]; then
      echo "缺少必需环境变量：TAYGEDO_LOGIN_ACCOUNT_ID" >&2
      exit 1
    fi
    args+=(--account-id "$account_id")
  fi

  args+=(--accounts-file "$TAYGEDO_ACCOUNTS_FILE")

  if [[ -n "${TAYGEDO_LOGIN_ACCOUNT_NAME:-}" ]]; then
    args+=(--account-name "$TAYGEDO_LOGIN_ACCOUNT_NAME")
  fi
  if [[ -n "${TAYGEDO_LOGIN_PASSWORD:-}" ]]; then
    args+=(--password "$TAYGEDO_LOGIN_PASSWORD")
  fi
  if [[ -n "${TAYGEDO_LOGIN_CAPTCHA:-}" ]]; then
    args+=(--captcha "$TAYGEDO_LOGIN_CAPTCHA")
  fi
  if [[ -n "${TAYGEDO_LOGIN_DEVICE_ID:-}" ]]; then
    args+=(--device-id "$TAYGEDO_LOGIN_DEVICE_ID")
  fi
  if is_truthy "${TAYGEDO_LOGIN_NEW_DEVICE:-}"; then
    args+=(--new-device)
  fi
  if [[ -z "${TAYGEDO_CREDENTIAL_KEY:-}" && -n "${TAYGEDO_CREDENTIAL_KEY_PATH:-}" ]]; then
    args+=(--credential-key-file "$TAYGEDO_CREDENTIAL_KEY_PATH")
  fi

  run_cli "${args[@]}" "$@"
}

run_device() {
  run_cli device --accounts-file "$TAYGEDO_ACCOUNTS_FILE" "$@"
}

main() {
  check_node
  install_deps
  prepare_data

  local command="${1:-${TAYGEDO_QL_COMMAND:-attendance}}"
  if [[ $# -gt 0 ]]; then
    shift
  fi

  case "$command" in
    attendance|run) run_attendance "$@" ;;
    login) run_login "$@" ;;
    device) run_device "$@" ;;
    *)
      echo "用法：bash scripts/qinglong.sh [attendance|login|device]" >&2
      exit 1
      ;;
  esac
}

main "$@"
