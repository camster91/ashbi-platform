# Soft-delete policy

`src/services/soft-delete.service.js` is the sole registry and interception
implementation for application soft deletion. The global Prisma client,
tenant-scoped clients, background jobs, and interactive transactions all use
that idempotent wrapper.

## Default behavior

- Every schema model with nullable `deletedAt DateTime?` must appear in
  `SOFT_DELETE_MODELS`; the unit suite fails when the schema and registry differ.
- `findFirst`, `findFirstOrThrow`, `findUnique`, `findUniqueOrThrow`, `findMany`,
  `count`, `aggregate`, and `groupBy` add `deletedAt: null`, including calls with
  no `where` input.
- `delete` and `deleteMany` become `update` and `updateMany` operations that set
  `deletedAt` to the current time.
- Tenant scoping composes with the deletion filter; neither policy replaces the
  other's criteria. Both remain active inside callback transactions.

## Privileged lifecycle paths

Restore and purge code must opt in visibly with an explicit, defined
`where.deletedAt` condition. `WITH_DELETED` exposes the underlying client for
reviewed administrative code, but request routes should prefer explicit
conditions so tenant scoping remains in force.

Permanent purge is restricted to the trash retention job and authenticated
trash administration. `TrashedItem.deletedAt` is required lifecycle metadata,
not a soft-delete marker, so `TrashedItem` is deliberately outside the registry.

## Verification

Run:

```sh
node --test src/tests/unit/soft-delete-policy.test.js src/tests/unit/tenant-policy.test.js
```

The tests cover schema classification, all read and delete families, bypass
rules, idempotency, tenant composition, and callback transactions. Database
integration coverage additionally requires `TENANT_INTEGRATION_DATABASE_URL`.
