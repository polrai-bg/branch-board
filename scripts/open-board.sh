#!/bin/bash
# open: show the local start page. start: run the board, then open it.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1
MODE="${1:-open}"

pick_node() {
  local found
  found="$(/bin/zsh -lc 'command -v node' 2>/dev/null || true)"
  if [ -x "$found" ]; then
    echo "$found"
    return
  fi
  for found in "$HOME/.local/bin/node" /opt/homebrew/bin/node /usr/local/bin/node; do
    if [ -x "$found" ]; then
      echo "$found"
      return
    fi
  done
}

NODE="$(pick_node)"
if [ -z "$NODE" ]; then
  echo "node was not found" >&2
  exit 1
fi
export PATH="$(dirname "$NODE"):$PATH"

if [ "$MODE" = "start" ]; then
  if ! curl -sf -o /dev/null --max-time 1 http://127.0.0.1:3000/; then
    nohup npm run dev >>/tmp/branchboard-dev.log 2>&1 &
    for _ in $(seq 1 40); do
      curl -sf -o /dev/null --max-time 1 http://127.0.0.1:3000/ && break
      sleep 0.5
    done
  fi
  open -a "Google Chrome" "http://127.0.0.1:3000/" || open "http://127.0.0.1:3000/"
else
  open -a "Google Chrome" "$ROOT/launcher/index.html" || open "$ROOT/launcher/index.html"
fi
