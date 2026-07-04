#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/release.sh VERSION
  scripts/release.sh VERSION --continue
  scripts/release.sh VERSION --no-finalize-changelog
  scripts/release.sh VERSION --finalize-changelog

Examples:
  scripts/release.sh 1.2.8
  scripts/release.sh 1.2.8 --continue
  scripts/release.sh 1.2.8 --no-finalize-changelog

Without --continue, prepares a release candidate PR, finalizes CHANGELOG.md, and waits for review.
After you merge that PR, press Enter and the script completes the release.
With --continue, resumes after the release candidate PR is already merged.
With --no-finalize-changelog, expects CHANGELOG.md to already have the release heading and links.
With --finalize-changelog, updates CHANGELOG.md for the release preparation PR.
EOF
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

require_clean_main() {
  if [[ "$(git branch --show-current)" != "main" ]]; then
    die "release must run from main"
  fi

  git fetch origin main --tags

  if [[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]]; then
    die "local main must match origin/main"
  fi

  if [[ -n "$(git status --porcelain)" ]]; then
    die "working tree must be clean"
  fi
}

sync_clean_main() {
  if [[ "$(git branch --show-current)" != "main" ]]; then
    die "release must run from main"
  fi

  if [[ -n "$(git status --porcelain)" ]]; then
    die "working tree must be clean"
  fi

  git fetch origin main --tags
  git merge --ff-only origin/main
}

require_signing_key() {
  local signing_key

  signing_key="$(git config --get user.signingkey)"
  if [[ -z "$signing_key" ]]; then
    die "git user.signingkey is not configured"
  fi

  gpg --list-secret-keys "$signing_key" >/dev/null
}

finalize_changelog() {
  node - "$VERSION" <<'NODE'
const fs = require('fs');

const version = process.argv[2];
const repoUrl = 'https://github.com/thekbb/expand-aws-iam-wildcards';
const date = process.env.RELEASE_DATE || new Date().toISOString().slice(0, 10);
const tag = `v${version}`;
const changelogPath = 'CHANGELOG.md';
let changelog = fs.readFileSync(changelogPath, 'utf8');

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

if (!/^## \[UNRELEASED\]$/m.test(changelog)) {
  fail('CHANGELOG.md is missing an [UNRELEASED] heading');
}

const versionHeadingPattern = new RegExp(`^## \\[${escapeRegExp(version)}\\](?:\\s|-|$)`, 'm');
if (versionHeadingPattern.test(changelog)) {
  fail(`CHANGELOG.md already has a ${version} heading`);
}

const versionLinkPattern = new RegExp(`^\\[${escapeRegExp(version)}\\]:\\s`, 'm');
if (versionLinkPattern.test(changelog)) {
  fail(`CHANGELOG.md already has a ${version} link`);
}

const unreleasedLinkPattern = new RegExp(
  `^\\[Unreleased\\]: ${escapeRegExp(repoUrl)}/compare/v([0-9]+\\.[0-9]+\\.[0-9]+)\\.\\.\\.HEAD$`,
  'm',
);
const unreleasedLink = changelog.match(unreleasedLinkPattern);
if (!unreleasedLink) {
  fail('CHANGELOG.md is missing the expected [Unreleased] compare link');
}

const previousVersion = unreleasedLink[1];
changelog = changelog.replace(
  /^## \[UNRELEASED\]\n/m,
  `## [UNRELEASED]\n\n## [${version}] - ${date}\n`,
);

changelog = changelog.replace(
  unreleasedLinkPattern,
  `[Unreleased]: ${repoUrl}/compare/${tag}...HEAD\n[${version}]: ${repoUrl}/compare/v${previousVersion}...${tag}`,
);

fs.writeFileSync(changelogPath, changelog);
NODE
}

find_new_workflow_run() {
  local workflow=$1
  local run_name=$2
  local previous_run_id=$3
  local branch=${4:-}
  local run_id=''
  local -a list_args

  list_args=(--workflow "$workflow" --event workflow_dispatch --limit 50)
  if [[ -n "$branch" ]]; then
    list_args+=(--branch "$branch")
  fi

  for _ in {1..30}; do
    sleep 2
    run_id="$(
      gh run list "${list_args[@]}" \
        --json databaseId,displayTitle --jq ".[] | select(.displayTitle == \"$run_name\") | .databaseId" \
        | head -n 1
    )"

    if [[ -n "$run_id" && "$run_id" != "$previous_run_id" ]]; then
      printf '%s\n' "$run_id"
      return 0
    fi
  done

  return 1
}

latest_workflow_run_id() {
  local workflow=$1
  local run_name=$2
  local branch=${3:-}
  local -a list_args

  list_args=(--workflow "$workflow" --event workflow_dispatch --limit 50)
  if [[ -n "$branch" ]]; then
    list_args+=(--branch "$branch")
  fi

  gh run list "${list_args[@]}" \
    --json databaseId,displayTitle --jq ".[] | select(.displayTitle == \"$run_name\") | .databaseId" \
    | head -n 1
}

wait_for_published_release() {
  local tag=$1
  local is_draft=''
  local is_immutable=''

  for _ in {1..60}; do
    if is_draft="$(gh release view "$tag" --json isDraft --jq '.isDraft' 2>/dev/null)" \
      && is_immutable="$(gh release view "$tag" --json isImmutable --jq '.isImmutable' 2>/dev/null)"; then
      if [[ "$is_draft" == "false" && "$is_immutable" == "true" ]]; then
        return 0
      fi
    fi

    sleep 5
  done

  return 1
}

prepare_release() {
  local previous_run_id
  local run_id
  local pr_url

  echo "Running release preflight for $TAG"

  gh auth status >/dev/null
  require_clean_main
  require_signing_key

  if [[ "$FINALIZE_CHANGELOG" == "true" ]]; then
    grep -q "^## \\[UNRELEASED\\]" CHANGELOG.md || die "CHANGELOG.md is missing an [UNRELEASED] entry"
  else
    grep -q "^## \\[$VERSION\\] - " CHANGELOG.md || die "CHANGELOG.md is missing a dated $VERSION entry"
    grep -q "^\\[$VERSION\\]: .*v${VERSION}$" CHANGELOG.md || die "CHANGELOG.md is missing the $VERSION compare link"
  fi

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

  previous_run_id="$(latest_workflow_run_id prepare-release.yml "$PREPARE_RUN_NAME")"
  gh workflow run prepare-release.yml -f version="$VERSION" -f finalize_changelog="$FINALIZE_CHANGELOG"
  run_id="$(find_new_workflow_run prepare-release.yml "$PREPARE_RUN_NAME" "$previous_run_id")" \
    || die "could not find the newly dispatched Prepare Release workflow run"

  gh run watch "$run_id" --exit-status

  pr_url="$(gh pr list --head "$BRANCH" --base main --json url --jq '.[0].url // empty')"
  if [[ -z "$pr_url" ]]; then
    die "Prepare Release completed, but no release preparation PR was found for $BRANCH"
  fi

  cat <<EOF

Release preparation PR is ready:
$pr_url

Review and merge the release preparation PR before continuing.

If this script is still running, press Enter after the PR is merged.
To resume later instead, run:
scripts/release.sh $VERSION --continue

Release state:
  version:   $VERSION
  tag:       $TAG
  major tag: $MAJOR_TAG
  branch:    $BRANCH
EOF

  if [[ ! -t 0 ]]; then
    echo
    echo "No interactive terminal detected; run scripts/release.sh $VERSION --continue after merging the PR."
    return 0
  fi

  read -r -p "Press Enter after the release preparation PR is merged, or Ctrl-C to resume later with --continue. "
  continue_release
}

ensure_version_tag() {
  local release_sha=$1
  local local_tag_commit=''
  local remote_tag_commit=''

  if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
    local_tag_commit="$(git rev-parse "$TAG^{commit}")"
    if [[ "$local_tag_commit" != "$release_sha" ]]; then
      die "local tag $TAG points to $local_tag_commit, expected $release_sha"
    fi
  fi

  if remote_ref_exists "refs/tags/$TAG"; then
    remote_tag_commit="$(git ls-remote --tags origin "refs/tags/$TAG^{}" | awk '{print $1}')"
    if [[ -z "$remote_tag_commit" ]]; then
      remote_tag_commit="$(git ls-remote --refs --tags origin "refs/tags/$TAG" | awk '{print $1}')"
    fi

    if [[ "$remote_tag_commit" != "$release_sha" ]]; then
      die "remote tag $TAG points to $remote_tag_commit, expected $release_sha"
    fi

    echo "Release tag already exists on origin: $TAG"
    return 0
  fi

  if ! git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
    git tag -s "$TAG" "$release_sha" -m "$TAG"
  fi

  git push origin "refs/tags/$TAG"
}

ensure_draft_release() {
  local release_json
  local is_draft

  if release_json="$(gh release view "$TAG" --json isDraft,isImmutable,tagName,url 2>/dev/null)"; then
    is_draft="$(gh release view "$TAG" --json isDraft --jq '.isDraft')"
    if [[ "$is_draft" == "true" ]]; then
      echo "Draft release already exists for $TAG"
      printf '%s\n' "$release_json"
      return 0
    fi

    echo "Release already exists for $TAG"
    printf '%s\n' "$release_json"
    return 0
  fi

  gh release create "$TAG" --draft --verify-tag --generate-notes
  gh release view "$TAG" --json isDraft,tagName,url
}

verify_and_publish_release() {
  local previous_run_id
  local run_id
  local is_draft
  local is_immutable

  is_draft="$(gh release view "$TAG" --json isDraft --jq '.isDraft')"
  is_immutable="$(gh release view "$TAG" --json isImmutable --jq '.isImmutable')"

  if [[ "$is_draft" == "false" && "$is_immutable" == "true" ]]; then
    echo "Release $TAG is already published and immutable"
    return 0
  fi

  echo "Dispatching Verify Draft Release for $TAG"

  previous_run_id="$(latest_workflow_run_id verify-draft-release.yml "$VERIFY_RUN_NAME" "$TAG")"
  gh workflow run verify-draft-release.yml --ref "$TAG" -f tag="$TAG"
  run_id="$(find_new_workflow_run verify-draft-release.yml "$VERIFY_RUN_NAME" "$previous_run_id" "$TAG")" \
    || die "could not find the newly dispatched Verify Draft Release workflow run"

  gh run watch "$run_id" --exit-status

  echo "Waiting for $TAG to be published and immutable"
  wait_for_published_release "$TAG" || die "release $TAG was not published as immutable; inspect Publish Verified Release runs"
}

move_major_tag() {
  local release_sha=$1
  local old_major_tag
  local remote_major_commit

  old_major_tag="$(git ls-remote --refs --tags origin "refs/tags/$MAJOR_TAG" | awk '{print $1}')"

  git tag -s -f "$MAJOR_TAG" "$TAG^{commit}" -m "$MAJOR_TAG"

  if [[ -n "$old_major_tag" ]]; then
    git push --force-with-lease="refs/tags/$MAJOR_TAG:$old_major_tag" origin "refs/tags/$MAJOR_TAG"
  else
    git push origin "refs/tags/$MAJOR_TAG"
  fi

  remote_major_commit="$(git ls-remote --tags origin "refs/tags/$MAJOR_TAG^{}" | awk '{print $1}')"
  if [[ "$remote_major_commit" != "$release_sha" ]]; then
    die "remote major tag $MAJOR_TAG points to $remote_major_commit, expected $release_sha"
  fi
}

continue_release() {
  local pr_state
  local release_sha
  local package_version
  local lockfile_version
  local changelog

  echo "Continuing release for $TAG"

  gh auth status >/dev/null
  sync_clean_main
  require_signing_key

  pr_state="$(gh pr list --state all --head "$BRANCH" --base main --json state --jq '.[0].state // empty')"
  if [[ -z "$pr_state" ]]; then
    die "could not find a release preparation pull request for $BRANCH"
  fi

  if [[ "$pr_state" != "MERGED" ]]; then
    die "$BRANCH pull request must be merged before continuing; current state: $pr_state"
  fi

  release_sha="$(gh pr list --state all --head "$BRANCH" --base main --json mergeCommit --jq '.[0].mergeCommit.oid // empty')"
  if [[ ! "$release_sha" =~ ^[0-9a-f]{40}$ ]]; then
    die "could not resolve release preparation PR merge commit"
  fi

  git merge-base --is-ancestor "$release_sha" origin/main \
    || die "release commit $release_sha is not reachable from origin/main"

  package_version="$(git show "$release_sha:package.json" | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).version")"
  lockfile_version="$(git show "$release_sha:package-lock.json" | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).version")"

  if [[ "$package_version" != "$VERSION" ]]; then
    die "package.json at $release_sha has version $package_version, expected $VERSION"
  fi

  if [[ "$lockfile_version" != "$VERSION" ]]; then
    die "package-lock.json at $release_sha has version $lockfile_version, expected $VERSION"
  fi

  changelog="$(git show "$release_sha:CHANGELOG.md")"
  if ! grep -q "^## \\[$VERSION\\] - " <<<"$changelog"; then
    die "CHANGELOG.md at $release_sha is missing a dated $VERSION heading"
  fi

  if ! grep -q "^\\[$VERSION\\]: .*v${VERSION}$" <<<"$changelog"; then
    die "CHANGELOG.md at $release_sha is missing the $VERSION compare link"
  fi

  ensure_version_tag "$release_sha"
  ensure_draft_release
  verify_and_publish_release

  ./verify-release.sh --tag "$TAG"
  move_major_tag "$release_sha"

  cat <<EOF

Release complete:
  version:   $VERSION
  tag:       $TAG
  major tag: $MAJOR_TAG
  commit:    $release_sha
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ "$#" -lt 1 || "$#" -gt 3 ]]; then
  usage >&2
  exit 2
fi

VERSION=$1
MODE=prepare
FINALIZE_CHANGELOG=true

for arg in "${@:2}"; do
  case "$arg" in
    --continue)
      MODE=post_merge
      ;;
    --finalize-changelog)
      MODE=finalize_changelog
      ;;
    --no-finalize-changelog)
      FINALIZE_CHANGELOG=false
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$MODE" != "prepare" && "$FINALIZE_CHANGELOG" == "false" ]]; then
  die "--no-finalize-changelog is only valid for the default release preparation mode"
fi

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  die "expected version input like 1.2.3"
fi

TAG="v$VERSION"
MAJOR_TAG="v${VERSION%%.*}"
BRANCH="release-candidate/$TAG"
require_command awk
require_command git
require_command grep
require_command head
require_command node

if [[ "$MODE" == "finalize_changelog" ]]; then
  finalize_changelog
  exit 0
fi

PREPARE_RUN_NAME="Prepare $TAG"
VERIFY_RUN_NAME="Verify $TAG"

require_command gh
require_command gpg

if [[ "$MODE" == "post_merge" ]]; then
  continue_release
else
  prepare_release
fi
