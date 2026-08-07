# Credential exposure assessment: prospect seeding helper

## Status

The prospect seeding helper introduced a literal production login credential in commit
`3855c6d84f803515a08ff52803cf743c3f9abaeb` on 2026-05-11. The commit remains reachable
from the repository's history. The current-file remediation removes the literal, stops
logging token prefixes, and requires runtime injection through `ASHBI_EMAIL` and
`ASHBI_PASSWORD`.

The repository had 212 later commits before remediation. Rewriting history is not part
of this change because it would invalidate existing clones and requires coordinated
approval. The disclosed credential must be treated as compromised even after the
current file is fixed.

## Required production response

- [ ] Change the affected account password in the production identity system.
- [ ] Revoke all existing sessions and tokens for the affected account.
- [ ] Update the approved automation secret store with the replacement credential.
- [ ] Run the helper with injected test credentials and confirm logs contain no secret
      or token material.
- [ ] Record who completed the rotation, when it completed, and the revocation evidence.
- [ ] Decide whether to coordinate a repository history rewrite after all rotations are
      complete. History removal is defense in depth, not a substitute for rotation.

Do not place the replacement credential, token, or screenshots containing either value
in this document, an issue, a pull request, or CI output.
