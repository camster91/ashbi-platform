# Frontend performance budgets

Public login, password recovery, capability-token portals, booking, intake,
estimate, and authenticated client-portal pages are independent lazy chunks.
Direct links show an accessible reduced-motion-aware loading state while the
selected route loads; no other public page chunk is part of the initial graph.

The production manifest is checked after every frontend build:

| Artifact | Raw transfer ceiling |
| --- | ---: |
| Application entry JavaScript | 120 KB |
| Entry plus all static JavaScript imports | 480 KB |
| Entry CSS | 95 KB |
| Any JavaScript chunk | 200 KB |
| Each public-route chunk | 60 KB |

Raw byte limits are deterministic and intentionally stricter than compressed
transfer size accounting. A limit change requires an explained code review and
a fresh production artifact comparison; do not raise a ceiling merely to make a
build pass.

Run `npm run build` or, against an existing artifact,
`npm run check:frontend-budgets`.

`npm run test:lighthouse` performs three mobile and three desktop lab runs of
the production login entry and fails when the median exceeds these budgets:

| Lighthouse measurement | Budget |
| --- | ---: |
| Performance score | >= 0.90 |
| Accessibility score | >= 0.95 |
| Best-practices score | >= 0.95 |
| SEO score | >= 0.90 |
| Largest Contentful Paint | <= 2.5 s |
| Cumulative Layout Shift | <= 0.10 |
| Total Blocking Time | <= 200 ms |

Lighthouse's Total Blocking Time is a lab responsiveness guard, not a claim
about Interaction to Next Paint. The production field target remains INP <=
200 ms at the 75th percentile once representative, privacy-reviewed RUM is
available. Lab budgets and field targets must not be presented as equivalent.

`npm run test:pwa-offline` verifies that the active production service worker
serves a controlled, previously visited login route and its static assets
offline while API requests remain network-only and return an offline response
rather than cached private data.
