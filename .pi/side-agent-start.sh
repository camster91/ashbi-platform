#!/bin/bash
# Creates a git worktree and starts a subagent
BRANCH_NAME="agent-task-$(date +%s)"
WORKTREE_DIR="../$BRANCH_NAME"

git worktree add -b "$BRANCH_NAME" "$WORKTREE_DIR" main
cp .env "$WORKTREE_DIR/" 2>/dev/null || true

echo "Worktree created at $WORKTREE_DIR"
echo "To start the subagent, run:"
echo "cd $WORKTREE_DIR && pi 'Execute the task defined in spec.md'"
