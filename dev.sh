#!/usr/bin/env bash
set -e

SESSION="budget"
ROOT="$(cd "$(dirname "$0")" && pwd)"

if [ -f "$ROOT/.env" ]; then
  set -a && source "$ROOT/.env" && set +a
fi

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "Attaching to existing tmux session '$SESSION'..."
  tmux attach-session -t "$SESSION"
  exit 0
fi

tmux new-session -d -s "$SESSION" -x "$(tput cols)" -y "$(tput lines)"

# Left pane — API
tmux send-keys -t "$SESSION:0.0" "cd '$ROOT' && source venv/bin/activate && uvicorn budget.main:app --reload" Enter

# Right pane — Frontend
tmux split-window -h -t "$SESSION:0"
tmux send-keys -t "$SESSION:0.1" "cd '$ROOT/frontend' && npm run dev" Enter

tmux select-pane -t "$SESSION:0.0"
tmux attach-session -t "$SESSION"
