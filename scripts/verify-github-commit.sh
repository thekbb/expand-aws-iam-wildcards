#!/usr/bin/env bash

set -euo pipefail

repository="${1:-}"
sha="${2:-}"

if [[ ! "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  echo "Expected repository in owner/name form, got: ${repository:-missing}" >&2
  exit 2
fi

if [[ ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Expected a full lowercase commit SHA, got: ${sha:-missing}" >&2
  exit 2
fi

owner="${repository%%/*}"
name="${repository#*/}"
# shellcheck disable=SC2016 # GraphQL variables must be passed literally.
signature_query='
query($owner: String!, $name: String!, $oid: GitObjectID!) {
  repository(owner: $owner, name: $name) {
    object(oid: $oid) {
      ... on Commit {
        oid
        signature {
          __typename
          isValid
          signer { login }
          state
          wasSignedByGitHub
          ... on GpgSignature { keyId }
        }
      }
    }
  }
}'
signature_filter='
.data.repository.object
| [
    .oid,
    .signature.__typename,
    .signature.isValid,
    .signature.state,
    .signature.wasSignedByGitHub,
    .signature.signer.login,
    .signature.keyId
  ]
| @tsv'

signature_record="$(gh api graphql \
  -f query="$signature_query" \
  -f owner="$owner" \
  -f name="$name" \
  -f oid="$sha" \
  --jq "$signature_filter")"
expected_record="$sha"$'\tGpgSignature\ttrue\tVALID\ttrue\tweb-flow\tB5690EEEBB952194'

if [[ "$signature_record" != "$expected_record" ]]; then
  echo "Commit $sha does not have the approved GitHub web-flow signature." >&2
  echo "Received: ${signature_record:-missing}" >&2
  exit 1
fi

echo "Verified GitHub web-flow signature for $sha."
