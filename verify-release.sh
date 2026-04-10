#!/usr/bin/env bash

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/thekbb/expand-aws-iam-wildcards.git}"
TAG_REGEX='^v[0-9]+\.[0-9]+\.[0-9]+$'
SHA_REGEX='^[0-9a-fA-F]{40}$'

usage() {
  cat <<'EOF'
Usage:
  ./verify-release.sh --tag v1.2.3
  ./verify-release.sh --sha 0123456789abcdef0123456789abcdef01234567

Exactly one of --tag or --sha is required.

Options:
  --tag  Semver release tag with a leading "v"
  --sha  Full 40-character commit SHA
  --help Show this help text

Environment:
  REPO_URL  Git remote to verify against
EOF
}

fail() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

tag=''
sha=''

while (($# > 0)); do
  case "$1" in
    --tag)
      shift
      (($# > 0)) || fail '--tag requires a value'
      tag="$1"
      ;;
    --sha)
      shift
      (($# > 0)) || fail '--sha requires a value'
      sha="$1"
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
  shift
done

if [[ -n "$tag" && -n "$sha" ]]; then
  fail 'provide exactly one of --tag or --sha'
fi

if [[ -z "$tag" && -z "$sha" ]]; then
  fail 'provide exactly one of --tag or --sha'
fi

if [[ -n "$tag" && ! "$tag" =~ $TAG_REGEX ]]; then
  fail '--tag must be a semver release like v1.2.3'
fi

if [[ -n "$sha" && ! "$sha" =~ $SHA_REGEX ]]; then
  fail '--sha must be a full 40-character commit SHA'
fi

sha="$(printf '%s' "$sha" | tr 'A-F' 'a-f')"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

git -C "$tmp_dir" init -q
git -C "$tmp_dir" remote add origin "$REPO_URL"
git -C "$tmp_dir" fetch -q --tags origin \
  "refs/heads/main:refs/remotes/origin/main"

if [[ -n "$tag" ]]; then
  git -C "$tmp_dir" show-ref --tags --verify --quiet "refs/tags/$tag" \
    || fail "tag not found: $tag"
  sha="$(git -C "$tmp_dir" rev-parse "$tag^{commit}")"
else
  git -C "$tmp_dir" cat-file -e "$sha^{commit}" 2>/dev/null \
    || fail "commit not found: $sha"

  matching_tags=()
  while IFS= read -r candidate_tag; do
    [[ -n "$candidate_tag" ]] || continue
    matching_tags+=("$candidate_tag")
  done < <(git -C "$tmp_dir" tag --points-at "$sha" --list 'v[0-9]*.[0-9]*.[0-9]*')

  if ((${#matching_tags[@]} == 0)); then
    fail "no semver release tag points to $sha"
  fi

  if ((${#matching_tags[@]} > 1)); then
    fail "multiple semver tags point to $sha: ${matching_tags[*]}"
  fi

  tag="${matching_tags[0]}"
fi

git -C "$tmp_dir" verify-tag "$tag"
resolved_sha="$(git -C "$tmp_dir" rev-parse "$tag^{commit}")"
[[ "$resolved_sha" == "$sha" ]] || fail "tag $tag resolves to $resolved_sha, not $sha"
git -C "$tmp_dir" merge-base --is-ancestor "$sha" origin/main \
  || fail "$sha is not reachable from origin/main"

printf 'Verified %s -> %s\n' "$tag" "$sha"
