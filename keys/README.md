# Release Signing Key

Commit the armored public key used to sign release tags as:

```text
keys/release-signing-key.asc
```

This lets consumers import the public key directly from the repository before running
`./verify-release.sh`.

## Maintainer Workflow

1. Identify the signing key you already use for release tags:

   ```bash
   gpg --list-secret-keys --keyid-format=long
   ```

1. Export the public half of that key in ASCII-armored form:

   ```bash
   gpg --armor --export <YOUR_KEY_FINGERPRINT> > keys/release-signing-key.asc
   ```

1. Check the exported key before committing it:

   ```bash
   gpg --show-keys --fingerprint keys/release-signing-key.asc
   ```

1. Commit `keys/release-signing-key.asc` and reference its fingerprint in the README.

## Consumer Workflow

```bash
gpg --import keys/release-signing-key.asc
./verify-release.sh --tag v1.1.10
```

If you also publish the same key on GitHub or public keyservers, users have an extra way to
cross-check the fingerprint. The repository copy should still be the canonical file referenced
by the release verification docs.
