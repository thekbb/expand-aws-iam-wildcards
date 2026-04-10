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
The script runs every verification check it can and exits nonzero if any check fails.

Options:
  --tag       Semver release tag with a leading "v"
  --sha       Full 40-character commit SHA
  --no-color  Disable ANSI color output
  --help      Show this help text

Environment:
  REPO_URL           Git remote to verify against
  GITHUB_REPOSITORY  Optional owner/repo override for release API checks
  GITHUB_API_URL     Optional GitHub API base URL override
  GITHUB_TOKEN       Optional token for private repos or higher API rate limits
EOF
}

fail() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

compact_message() {
  local text="$1"

  text="${text//$'\n'/ }"
  printf '%s' "$text" | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//'
}

extract_signature_summary() {
  local output="$1"
  local summary=''

  summary="$(printf '%s\n' "$output" | grep -m1 'Good signature from' || true)"
  if [[ -n "$summary" ]]; then
    printf '%s' "$summary"
    return
  fi

  printf '%s' "$(compact_message "$output")"
}

format_status() {
  local status="$1"
  local text=''
  local color=''
  local reset=''

  case "$status" in
    PASS)
      text='OK'
      color=$'\033[32m'
      ;;
    FAIL)
      text='FAIL'
      color=$'\033[31m'
      ;;
    SKIP)
      text='SKIP'
      color=$'\033[33m'
      ;;
    *)
      fail "unknown status: $status" ;;
  esac

  if ((use_color)); then
    reset=$'\033[0m'
    printf '%s%s%s' "$color" "$text" "$reset"
  else
    printf '%s' "$text"
  fi
}

emit_result() {
  local status="$1"
  local label="$2"
  local detail="${3:-}"
  local display_status=''

  case "$status" in
    PASS) ;;
    FAIL) overall_failed=1 ;;
    SKIP) ;;
    *) fail "unknown status: $status" ;;
  esac

  display_status="$(format_status "$status")"

  if [[ -n "$detail" ]]; then
    printf '[%s] %s: %s\n' "$display_status" "$label" "$detail"
  else
    printf '[%s] %s\n' "$display_status" "$label"
  fi
}

parse_github_repo() {
  local remote_url="$1"
  local host=''
  local path=''

  case "$remote_url" in
    https://*/*|http://*/*)
      remote_url="${remote_url#http://}"
      remote_url="${remote_url#https://}"
      host="${remote_url%%/*}"
      path="${remote_url#*/}"
      ;;
    ssh://git@*/*)
      remote_url="${remote_url#ssh://git@}"
      host="${remote_url%%/*}"
      path="${remote_url#*/}"
      ;;
    git@*:*/*)
      remote_url="${remote_url#git@}"
      host="${remote_url%%:*}"
      path="${remote_url#*:}"
      ;;
    *)
      return 1
      ;;
  esac

  host="${host##*@}"
  path="${path%.git}"

  [[ "$path" == */* ]] || return 1

  github_host="$host"
  github_owner="${path%%/*}"
  github_repo="${path#*/}"
  github_repo="${github_repo%%/*}"

  [[ -n "$github_host" && -n "$github_owner" && -n "$github_repo" ]] || return 1
}

resolve_github_repo() {
  local remote_url="$REPO_URL"

  if [[ -n "${GITHUB_REPOSITORY:-}" ]]; then
    github_owner="${GITHUB_REPOSITORY%%/*}"
    github_repo="${GITHUB_REPOSITORY#*/}"
    github_host='github.com'
    [[ -n "$github_owner" && -n "$github_repo" && "$github_repo" != "$GITHUB_REPOSITORY" ]] || return 1
    return 0
  fi

  if [[ -e "$REPO_URL" ]] && git -C "$REPO_URL" rev-parse --git-dir >/dev/null 2>&1; then
    remote_url="$(git -C "$REPO_URL" remote get-url origin 2>/dev/null || true)"
  fi

  parse_github_repo "$remote_url"
}

collect_release_metadata() {
  local lookup_tag="$1"
  local api_base=''
  local api_url=''
  local release_file="$tmp_dir/release.json"
  local http_status=''
  local compact_json=''
  local -a curl_args=()

  release_lookup_state='FAIL'
  release_lookup_detail=''
  immutable_state='SKIP'
  immutable_detail='release metadata unavailable'

  if ! resolve_github_repo; then
    release_lookup_detail='unable to derive GitHub owner/repo; set GITHUB_REPOSITORY=owner/repo'
    immutable_detail='GitHub repository could not be determined'
    return
  fi

  if [[ -n "${GITHUB_API_URL:-}" ]]; then
    api_base="${GITHUB_API_URL%/}"
  elif [[ "$github_host" == 'github.com' ]]; then
    api_base='https://api.github.com'
  else
    api_base="https://${github_host}/api/v3"
  fi

  api_url="${api_base}/repos/${github_owner}/${github_repo}/releases/tags/${lookup_tag}"
  curl_args=(
    -sS
    -o
    "$release_file"
    -w
    '%{http_code}'
    -H
    'Accept: application/vnd.github+json'
    -H
    'X-GitHub-Api-Version: 2026-03-10'
  )

  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    curl_args+=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
  fi

  if ! http_status="$(curl "${curl_args[@]}" "$api_url")"; then
    release_lookup_detail="failed to query GitHub release metadata at ${api_url}"
    immutable_detail='GitHub release metadata request failed'
    return
  fi

  case "$http_status" in
    200)
      release_lookup_state='PASS'
      release_lookup_detail="published release ${lookup_tag} exists on GitHub"
      compact_json="$(tr -d '[:space:]' < "$release_file")"
      if [[ "$compact_json" == *'"immutable":true'* ]]; then
        immutable_state='PASS'
        immutable_detail="release ${lookup_tag} is marked immutable by GitHub"
      else
        immutable_state='FAIL'
        immutable_detail="release ${lookup_tag} is not marked immutable by GitHub"
      fi
      ;;
    404)
      release_lookup_detail="published GitHub release not found for ${lookup_tag}"
      immutable_detail='published release not found'
      ;;
    *)
      release_lookup_detail="GitHub release metadata request failed with HTTP ${http_status} at ${api_url}"
      immutable_detail='GitHub release metadata request failed'
      ;;
  esac
}

tag=''
sha=''
github_host=''
github_owner=''
github_repo=''
overall_failed=0
use_color=1

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
    --no-color)
      use_color=0
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

if [[ ! -t 1 ]]; then
  use_color=0
fi

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

fetch_ok=0
fetch_output=''
if fetch_output="$(git -C "$tmp_dir" fetch -q --tags origin \
  "refs/heads/main:refs/remotes/origin/main" 2>&1)"; then
  fetch_ok=1
  emit_result PASS 'Fetch remote refs' "$REPO_URL"
else
  emit_result FAIL 'Fetch remote refs' "$(compact_message "$fetch_output")"
fi

requested_tag="$tag"
requested_sha="$sha"
resolved_tag=''
resolved_sha=''

if [[ -n "$requested_tag" ]]; then
  if ((fetch_ok)); then
    if git -C "$tmp_dir" show-ref --tags --verify --quiet "refs/tags/$requested_tag"; then
      emit_result PASS 'Release tag exists' "$requested_tag"
      if resolved_sha="$(git -C "$tmp_dir" rev-parse "$requested_tag^{commit}" 2>/dev/null)"; then
        emit_result PASS 'Tag resolves to commit' "${requested_tag} -> ${resolved_sha}"
        resolved_tag="$requested_tag"
      else
        emit_result FAIL 'Tag resolves to commit' "unable to resolve ${requested_tag}^{commit}"
      fi
    else
      emit_result FAIL 'Release tag exists' "tag not found: ${requested_tag}"
      emit_result SKIP 'Tag resolves to commit' 'release tag is missing'
    fi
  else
    emit_result SKIP 'Release tag exists' 'remote refs were not fetched'
    emit_result SKIP 'Tag resolves to commit' 'remote refs were not fetched'
  fi
else
  if ((fetch_ok)); then
    if git -C "$tmp_dir" cat-file -e "$requested_sha^{commit}" 2>/dev/null; then
      emit_result PASS 'Commit exists' "$requested_sha"
      resolved_sha="$requested_sha"
    else
      emit_result FAIL 'Commit exists' "commit not found: ${requested_sha}"
    fi

    if [[ -n "$resolved_sha" ]]; then
      matching_tags=()
      while IFS= read -r candidate_tag; do
        [[ -n "$candidate_tag" ]] || continue
        matching_tags+=("$candidate_tag")
      done < <(git -C "$tmp_dir" tag --points-at "$resolved_sha" --list 'v[0-9]*.[0-9]*.[0-9]*')

      if ((${#matching_tags[@]} == 0)); then
        emit_result FAIL 'Unique release tag for commit' "no semver release tag points to ${resolved_sha}"
      elif ((${#matching_tags[@]} > 1)); then
        emit_result FAIL 'Unique release tag for commit' "multiple semver tags point to ${resolved_sha}: ${matching_tags[*]}"
      else
        resolved_tag="${matching_tags[0]}"
        emit_result PASS 'Unique release tag for commit' "${resolved_tag} -> ${resolved_sha}"
      fi
    else
      emit_result SKIP 'Unique release tag for commit' 'commit could not be resolved'
    fi

    if [[ -n "$resolved_tag" && -n "$resolved_sha" ]]; then
      tag_commit="$(git -C "$tmp_dir" rev-parse "$resolved_tag^{commit}" 2>/dev/null || true)"
      if [[ -n "$tag_commit" && "$tag_commit" == "$resolved_sha" ]]; then
        emit_result PASS 'Tag resolves to expected commit' "${resolved_tag} -> ${resolved_sha}"
      elif [[ -n "$tag_commit" ]]; then
        emit_result FAIL 'Tag resolves to expected commit' "${resolved_tag} resolves to ${tag_commit}, not ${resolved_sha}"
      else
        emit_result FAIL 'Tag resolves to expected commit' "unable to resolve ${resolved_tag}^{commit}"
      fi
    else
      emit_result SKIP 'Tag resolves to expected commit' 'release tag could not be determined'
    fi
  else
    emit_result SKIP 'Commit exists' 'remote refs were not fetched'
    emit_result SKIP 'Unique release tag for commit' 'remote refs were not fetched'
    emit_result SKIP 'Tag resolves to expected commit' 'remote refs were not fetched'
  fi
fi

if [[ -n "$resolved_tag" ]] && ((fetch_ok)); then
  verify_output=''
  if verify_output="$(git -C "$tmp_dir" verify-tag "$resolved_tag" 2>&1)"; then
    emit_result PASS 'Tag signature is valid' "$(extract_signature_summary "$verify_output")"
  else
    emit_result FAIL 'Tag signature is valid' "$(compact_message "$verify_output")"
  fi
else
  emit_result SKIP 'Tag signature is valid' 'release tag could not be determined'
fi

api_tag="$resolved_tag"
if [[ -z "$api_tag" && -n "$requested_tag" ]]; then
  api_tag="$requested_tag"
fi

if [[ -n "$api_tag" ]]; then
  collect_release_metadata "$api_tag"
  emit_result "$release_lookup_state" 'Published GitHub release exists' "$release_lookup_detail"
  emit_result "$immutable_state" 'GitHub release is immutable' "$immutable_detail"
else
  emit_result SKIP 'Published GitHub release exists' 'release tag could not be determined'
  emit_result SKIP 'GitHub release is immutable' 'release tag could not be determined'
fi

if [[ -n "$resolved_sha" ]] && ((fetch_ok)); then
  if git -C "$tmp_dir" merge-base --is-ancestor "$resolved_sha" origin/main; then
    emit_result PASS 'Commit is reachable from origin/main' "$resolved_sha"
  else
    emit_result FAIL 'Commit is reachable from origin/main' "${resolved_sha} is not reachable from origin/main"
  fi
else
  emit_result SKIP 'Commit is reachable from origin/main' 'commit could not be resolved'
fi

if ((overall_failed)); then
  overall_status="$(format_status FAIL)"
  printf '\n'
  if [[ -n "$resolved_tag" && -n "$resolved_sha" ]]; then
    printf 'Overall: %s (%s -> %s)\n' "$overall_status" "$resolved_tag" "$resolved_sha"
  else
    printf 'Overall: %s\n' "$overall_status"
  fi
  exit 1
fi

overall_status="$(format_status PASS)"
printf '\n'
printf 'Overall: %s (%s -> %s)\n' "$overall_status" "$resolved_tag" "$resolved_sha"
