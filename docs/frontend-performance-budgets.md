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
`npm run check:frontend-budgets`. Browser performance targets remain LCP <= 2.5s,
CLS <= 0.1, and INP <= 200ms at the 75th percentile once representative RUM is
available. Those field targets are not claimed from bundle checks alone.
