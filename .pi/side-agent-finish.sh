#!/bin/bash
# Merges the subagent work and cleans up
WORKTREE_DIR=$1
BRANCH_NAME=$(basename "$WORKTREE_DIR")

if [ -z "$WORKTREE_DIR" ]; then
  echo "Usage: ./side-agent-finish.sh <worktree_dir>"
  exit 1
fi

cd "$WORKTREE_DIR" || exit
git add .
git commit -m "Automated agent task completion" || true

cd - || exit
git merge "$BRANCH_NAME"
git worktree remove "$WORKTREE_DIR"
git branch -d "$BRANCH_NAME"

echo "Worktree $WORKTREE_DIR merged and removed."
