#!/usr/bin/env bash
set -e

SESSION="budget"
ROOT="$(cd "$(dirname "$0")" && pwd)"

if [ -f "$ROOT/.env" ]; then
  set -a && source "$ROOT/.env" && set +a
fi

if [ -f "$ROOT/frontend/.env" ]; then
  set -a && source "$ROOT/frontend/.env" && set +a
fi

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "Attaching to existing tmux session '$SESSION'..."
  tmux attach-session -t "$SESSION"
  exit 0
fi

tmux new-session -d -s "$SESSION" -x "$(tput cols)" -y "$(tput lines)"

# Start Redis container if not already running
if ! docker ps --format '{{.Names}}' | grep -q '^budget-redis$'; then
  echo "Starting Redis container..."
  docker run -d --name budget-redis -p 6379:6379 --rm redis:7-alpine
fi

# Start rq-dashboard container if not already running
if ! docker ps --format '{{.Names}}' | grep -q '^budget-rq-dashboard$'; then
  echo "Starting rq-dashboard container..."
  docker run -d --name budget-rq-dashboard -p 9181:9181 --rm \
    eoranged/rq-dashboard --redis-url redis://host.docker.internal:6379
fi

# Create pane layout: three stacked horizontal splits
tmux split-window -v -t "$SESSION:0.0"   # 0.0=top, 0.1=bottom
tmux split-window -v -t "$SESSION:0.1"   # 0.0=top, 0.1=middle, 0.2=bottom

# Send commands
tmux send-keys -t "$SESSION:0.0" "cd '$ROOT' && source venv/bin/activate && uvicorn budget.main:app --reload" Enter
tmux send-keys -t "$SESSION:0.1" "cd '$ROOT' && source venv/bin/activate && NO_PROXY=* watchfiles --filter python 'rq worker enrichment' budget" Enter
tmux send-keys -t "$SESSION:0.2" "cd '$ROOT/frontend' && npm run dev" Enter

tmux select-pane -t "$SESSION:0.0"
tmux attach-session -t "$SESSION"
