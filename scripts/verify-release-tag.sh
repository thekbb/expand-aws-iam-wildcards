#!/usr/bin/env bash

set -euo pipefail

repository="${1:-}"
tag="${2:-}"
expected_fingerprint='353AAFB21CE81D843634AD3EDE52EEA6AF0D8779'

if [[ -z "$repository" ]]; then
  echo 'Expected a repository directory.' >&2
  exit 2
fi

if [[ ! "$tag" =~ ^v([0-9]+|[0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
  echo "Expected a semantic version or major release tag, got: ${tag:-missing}" >&2
  exit 2
fi

object_type="$(git -C "$repository" cat-file -t "$tag" 2>/dev/null || true)"
if [[ "$object_type" != 'tag' ]]; then
  echo "Expected $tag to be an annotated tag." >&2
  exit 1
fi

if ! verification="$(git -C "$repository" verify-tag --raw "$tag" 2>&1)"; then
  printf '%s\n' "$verification" >&2
  exit 1
fi

signer_fingerprints="$(
  awk '
    $1 == "[GNUPG:]" && $2 == "VALIDSIG" {
      print ($12 == "" ? $3 : $12)
    }
  ' <<<"$verification"
)"
signer_count="$(awk 'NF { count += 1 } END { print count + 0 }' <<<"$signer_fingerprints")"

if [[ "$signer_count" -ne 1 || "$signer_fingerprints" != "$expected_fingerprint" ]]; then
  echo "Release tag $tag was not signed by the approved release key." >&2
  echo "Expected fingerprint: $expected_fingerprint" >&2
  echo "Received fingerprint: ${signer_fingerprints:-missing}" >&2
  exit 1
fi

echo "Verified $tag with release signing key $expected_fingerprint."
