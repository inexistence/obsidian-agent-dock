#!/bin/sh
set -eu

repo_root="$(git rev-parse --show-toplevel)"
hooks_dir="$repo_root/.git/hooks"

mkdir -p "$hooks_dir"
cp "$repo_root/scripts/git-hooks/commit-msg" "$hooks_dir/commit-msg"
chmod +x "$hooks_dir/commit-msg"

printf 'Installed git hooks in %s\n' "$hooks_dir"
