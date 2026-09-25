# Credential exposure assessment: prospect seeding helper

## Status

The former prospect seeding helper introduced a literal production login credential in commit
`3855c6d84f803515a08ff52803cf743c3f9abaeb` on 2026-05-11. The commit remains reachable
from the repository's history. The current-file remediation removes the literal, stops
logging token prefixes. The helper itself was removed on 2026-08-09 because its
cold-email routes had already been deliberately removed in commit `8fb0f05`; retaining
an executable script for nonexistent endpoints was unsafe and misleading.

The repository had 212 later commits before remediation. Rewriting history is not part
of this change because it would invalidate existing clones and requires coordinated
approval. The disclosed credential must be treated as compromised even after the
current file is fixed.

## Completed production response (2026-08-09)

- [x] The affected production account password was replaced with a cryptographically
      random value and its bcrypt hash was updated at 2026-08-09T01:47:16Z.
- [x] The account session version was incremented during rotation, invalidating all
      previously issued user JWTs. A production login and authenticated `/api/auth/me`
      request both returned 200 using the replacement, no token appeared in the JSON
      body, and the verification session was logged out and revoked. The account
      remained active.
- [x] The replacement is held in GitHub's encrypted `ASHBI_EMAIL` and
      `ASHBI_PASSWORD` repository secrets and in a root-only, mode-0600 VPS recovery
      file. No value was emitted to logs or committed.
- [x] The obsolete helper was removed instead of exercising it against deleted routes.
      Current secret scanning rejects representative JSON login passwords and the
      current tree passes the leak gate.
- [x] Six unique Discord webhook URLs found in reachable history were checked; all six
      returned 404 and were already revoked. Production Discord webhook variables are
      intentionally unset because the integration is not active.
- [x] History will not be rewritten. The exposure remains documented and reachable,
      but the credential and all sessions were rotated. Rewriting hundreds of commits
      and every surviving branch would disrupt clones without improving the completed
      revocation. This can be revisited only as a separately coordinated repository
      migration.

## Second exposure: `PRODUCTION_DEPLOYMENT.md` (found 2026-08-23)

Issue #296 was reopened on 2026-08-23 after a current-tree regression was confirmed
on `main` at `6522707`: the superseded `PRODUCTION_DEPLOYMENT.md` still contained
"change default password" instructions with explicit login material for two named
staff accounts.

- **Introduced:** commit `6e09e464344ee010ee840e44517f9d1df9f44638` (2026-03-27),
  carried forward by later documentation syncs. This predates the prospect helper
  exposure above, and it was missed by the 2026-08-09 assessment because the leak
  gate only matched JSON `"password"` literals, not Markdown prose.
- **Value:** a sanitized comparison (equality check only, no value printed) shows
  the documented value is the same single credential that the prospect helper
  disclosed, i.e. the value rotated on 2026-08-09T01:47:16Z. It was, however,
  documented for two accounts, while the recorded rotation covered one account.
- **Removed from the current tree:** commit
  `7b9c7459ce8ad0b8b85f5ed2587d572de9df1fd4` (2026-08-23) replaced the instructions
  with "obtain bootstrap credentials from the approved secret store" guidance.
- **Scanner regression:** commits `c35617e`, `284cb50`, `4cd605a` (2026-08-23) and
  `c2ba8ed` (2026-09-02) added a "documented login credential" pattern to
  `scripts/check-secrets.mjs`, with CI fixtures that reject Markdown login material
  (including a former placeholder-prefix bypass) without echoing matched values.
- **History:** the material remains reachable in history from `6e09e46` through
  `7b9c745^`. The earlier no-rewrite decision applies; a rewrite still needs separate
  approval.

Open items before #296 can be reclosed:

- [ ] Confirm the second documented account does not accept the historical value
      (rotate its password and increment its session version if it does), recording
      operator, time and evidence without values or account identifiers.
- [ ] Re-run the sanitized current-tree scan (`npm run check:secrets`) on `main` and
      record the result.

Do not place the replacement credential, token, or screenshots containing either value
in this document, an issue, a pull request, or CI output.
