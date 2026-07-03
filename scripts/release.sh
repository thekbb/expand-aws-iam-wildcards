#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 VERSION"
  echo
  echo "Prepares a release candidate PR for VERSION, for example: $0 1.2.7"
}

die() {
  echo "error: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

remote_ref_exists() {
  local ref=$1
  local exit_code

  git ls-remote --exit-code origin "$ref" >/dev/null 2>&1 && return 0
  exit_code=$?

  if [[ "$exit_code" -eq 2 ]]; then
    return 1
  fi

  die "failed to check remote ref: $ref"
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ "$#" -ne 1 ]]; then
  usage >&2
  exit 2
fi

VERSION=$1

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  die "expected version input like 1.2.3"
fi

TAG="v$VERSION"
MAJOR_TAG="v${VERSION%%.*}"
BRANCH="release-candidate/$TAG"
RUN_NAME="Prepare $TAG"

require_command gh
require_command git
require_command gpg
require_command grep
require_command head

echo "Running release preflight for $TAG"

gh auth status >/dev/null

if [[ "$(git branch --show-current)" != "main" ]]; then
  die "release preparation must run from main"
fi

git fetch origin main --tags

if [[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]]; then
  die "local main must match origin/main"
fi

if [[ -n "$(git status --porcelain)" ]]; then
  die "working tree must be clean"
fi

signing_key="$(git config --get user.signingkey)"
if [[ -z "$signing_key" ]]; then
  die "git user.signingkey is not configured"
fi

gpg --list-secret-keys "$signing_key" >/dev/null

grep -q "^## \\[$VERSION\\]" CHANGELOG.md || die "CHANGELOG.md is missing an entry for $VERSION"

if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  die "local tag already exists: $TAG"
fi

if remote_ref_exists "refs/tags/$TAG"; then
  die "remote tag already exists: $TAG"
fi

if remote_ref_exists "refs/heads/$BRANCH"; then
  die "remote release candidate branch already exists: $BRANCH"
fi

echo "Dispatching Prepare Release for $TAG"

previous_run_id="$(
  gh run list --workflow prepare-release.yml --event workflow_dispatch --limit 50 \
    --json databaseId,displayTitle --jq ".[] | select(.displayTitle == \"$RUN_NAME\") | .databaseId" \
    | head -n 1
)"

gh workflow run prepare-release.yml -f version="$VERSION"

run_id=''
for _ in {1..30}; do
  sleep 2
  run_id="$(
    gh run list --workflow prepare-release.yml --event workflow_dispatch --limit 50 \
      --json databaseId,displayTitle --jq ".[] | select(.displayTitle == \"$RUN_NAME\") | .databaseId" \
      | head -n 1
  )"

  if [[ -n "$run_id" && "$run_id" != "$previous_run_id" ]]; then
    break
  fi
done

if [[ -z "$run_id" || "$run_id" == "$previous_run_id" ]]; then
  die "could not find the newly dispatched Prepare Release workflow run"
fi

gh run watch "$run_id" --exit-status

pr_url="$(gh pr list --head "$BRANCH" --base main --json url --jq '.[0].url // empty')"
if [[ -z "$pr_url" ]]; then
  die "Prepare Release completed, but no release preparation PR was found for $BRANCH"
fi

cat <<EOF

Release preparation PR is ready:
$pr_url

Stop here. Review and merge the release preparation PR before creating the signed release tag.

Release state:
  version:   $VERSION
  tag:       $TAG
  major tag: $MAJOR_TAG
  branch:    $BRANCH
EOF
