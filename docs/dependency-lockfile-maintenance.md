# Dependency lockfile maintenance

## Browser proxy optional peer (#546)

The root development chain is `@lhci/cli` -> `lighthouse` -> `puppeteer-core`
-> overridden `@puppeteer/browsers@3.2.3`. That browser package declares an
**optional peer** `proxy-agent >=8.0.1`; Lighthouse CI also needs
`proxy-agent ^6.4.0`. These are distinct compatible placements, not an upgrade
of Lighthouse CI's proxy API.

The lockfiles on Dependabot PRs #567 and #568 omitted the optional version 8
peer and its transitive packages. On Node 22.23.2/npm 10.9.8, their manifests
and lockfiles reproduce `npm ci` EUSAGE before application tests run. npm's
ideal tree adds version 8 under the overridden browser package because the
existing ancestor version 6 cannot satisfy that peer. The first errors are
missing `proxy-agent@8.0.2` and `agent-base@9.0.0`; twelve packages are missing.
This identifies the conflicting dependency edge. It does not establish which
internal Dependabot resolver step pruned it, or prove that npm version pinning
would repair Dependabot.

Declare `proxy-agent@8.0.2` explicitly in root **devDependencies** to supply
the browser peer as a required development dependency. npm then keeps version 8
at the root and Lighthouse CI's version 6 separately. It no longer depends on
preserving an optional peer-only subtree. Do not remove this declaration merely
because application source does not import it: it supplies the browser tooling's
peer. Do not remove the browser override or disable peer checking to make CI pass.
The production package graph is unchanged by this repair; there are no runtime
package upgrades or new production dependencies.

Local validation used Node 22.23.2/npm 10.9.8 in an ordinary scratch directory:
the stale #567 pair failed the no-scripts dry run with the twelve missing-package
errors, while the repaired pair passed an actual no-scripts clean install (1,039
packages) and `npm ls --all --omit=dev`. All 696 non-development lock entries
retained their package paths, versions, resolved URLs and integrity values.
The regenerated development tree also moves `socks` from 2.8.9 to 2.8.10;
other package name/version pairs are unchanged. Hosted required CI remains
necessary before acceptance; no live Dependabot run is claimed here.

## Updating safely

Start from current main, and change only the intended package versions. Do not
merge a stale bot lockfile or run a broad `npm update` to resolve unrelated work.
If a bot lockfile fails, use npm to regenerate it with the matching manifest:

```sh
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
npm ci --ignore-scripts --no-audit --no-fund
```

Run these in a disposable ordinary directory containing copies of root
`package.json`, `package-lock.json` and `.npmrc`, with that directory as the
working directory. Never install into a shared/junction `node_modules` directory.
For a lockfile-only repair, compare all non-development locked package paths and
versions with main. Copy back only the reviewed manifest/lockfile. From the
reviewed repository checkout, run the committed regression:

```sh
node --test src/tests/unit/dependency-proxy-peer-lock.test.js
```

Then run the normal required CI, including its clean install, native dependency
setup, tests and build. A no-scripts install proves lock consistency, not app
runtime behavior.

The committed regression verifies the explicit peer, both version placements,
and complete required proxy dependency closures, including a deliberately missing
transitive dependency. It does not replace clean `npm ci` or test a live Dependabot
service. Recreated bot PRs still require their own current-main CI evidence.

The version upgrades proposed by stale #567/#568 are deliberately separate from
this resolver repair. Regenerate or replace those PRs on repaired main, preserve
matching Playwright tool/runtime versions, review their dependency changes and
required checks, then close superseded PRs with that evidence. This change does
not alter bot configuration, permissions, grouping, release gates or access.
