# Production backup and restore contract

Ashbi's direct-VPS release path uses a root-owned systemd timer, not GitHub Actions, to capture PostgreSQL, uploads, generated configuration, and the production environment file in one encrypted archive. The application containers cannot read the age restore identity.

## Initial operating policy

- Scope: PostgreSQL, `/opt/ashbi-platform/data`, and `/opt/ashbi-platform/.env`.
- Schedule/RPO: daily at 02:00 UTC with randomized delay; initial RPO target is 24 hours.
- RTO: initial internal target is four hours after infrastructure is available.
- Retention: 30 days by default, configurable from 7–365 days pending the governance decision in #310.
- Encryption: age recipient encryption before the final archive is made visible; plaintext exists only in a root-only temporary directory and is removed on exit.
- Access: encrypted archives are root-only. The mounted status file is mode 0644 but contains only status, timestamps, revision, byte count, and retention; it contains no archive path, checksum, credentials, or tenant data. The public recipient is stored in `/etc/ashbi-backup`; the restore identity is outside the runtime tree and mode 0600.
- Ownership: a named operations owner and off-host archive destination remain mandatory production-governance gates; they must not be invented in source control.

The job fails non-zero for missing tools, database/container failure, invalid dump catalog, absent configuration, empty output, unsafe paths, invalid retention, or encryption failure. It writes `data/config/backup-status.json` only after the encrypted archive is complete. The API reads this mounted file and reports backup freshness without exposing archive names or checksums. A missing, invalid, or older-than-30-hour status degrades health without taking otherwise healthy dependencies offline. Monitoring must alert when the timer fails or this status becomes older than the RPO.

## Installation

Generate or import an approved age identity, put its public recipient in `/etc/ashbi-backup/recipients.txt`, and keep the identity root-only outside `/opt/ashbi-platform`. Install `scripts/backup-vps.sh` as `/usr/local/sbin/ashbi-backup`, then install the reviewed service/timer units. Do not enable the timer until restore-key custody and the off-host destination are approved.

## Isolated restore drill

Run:

```bash
sudo scripts/restore-drill-vps.sh \
  --archive /opt/ashbi-platform/backups/encrypted/ashbi-full-TIMESTAMP-REVISION.tar.age \
  --identity /root/.config/ashbi-backup/identity.txt
```

The drill decrypts into a root-only temporary directory and verifies every manifest checksum. It defaults to the reviewed PostgreSQL 18 + pgvector image pinned by repository digest in the script, with no network and a parent `/var/lib/postgresql` tmpfs mount. The selected image's binary determines its `PGDATA` and tmpfs mount: PG18 uses `/var/lib/postgresql/18/docker` under the parent mount; a legacy PG16 override retains `/var/lib/postgresql/data` for both, avoiding an extra anonymous image volume. An explicit `ASHBI_RESTORE_IMAGE=pgvector/pgvector:pg16` override remains available for legacy PG16 archives; a newer dump that its catalog reader cannot parse fails before restore. The dump is streamed to the isolated engine's own `pg_restore`, first for catalog inspection and then for an atomic, fail-fast restore. Host PostgreSQL tools are not used. Representative counts print no tenant content; cleanup removes plaintext and the disposable database.

Production backup catalog inspection likewise streams through the selected PostgreSQL container's own tools. The release verifier uses the canonical `ashbi-hub-postgres` container, which must name the current primary after a data-service cutover. No global host PostgreSQL package or PATH change is required. Real PG18 backup/restore and retained PG16 archive compatibility must still be rehearsed before an engine cutover.

Installing this change is a separate operator action: update both `/usr/local/sbin/ashbi-backup` and `/opt/ashbi-platform/scripts/backup-vps.sh`, together with their exact source pin in the installed release verifier. The October 17 installed verifier (`4fa4230d458a877d02bc12696c0a4e133fe40a88ad516985c5cd7eafc5c202e4`) includes additional established migration/schema checks beyond the repository template. Apply the catalog-stream and new backup-source-pin changes to that reviewed installed source while preserving those checks; do not replace it wholesale with this template. Read back and independently review all installed hashes before enabling the new backup path. Historical frozen release helpers keep their historical pins and must not be silently repurposed.

This archive still covers PostgreSQL and runtime files. Redis final snapshot capture remains a separate, explicitly verified cutover operation; these tooling changes do not add Redis backup coverage.

Record the archive checksum, start/end timestamps, achieved RPO/RTO, sanitized counts, result, and follow-ups on #282. A successful same-host drill proves archive usability, not regional disaster recovery; off-host encrypted replication and independently approved key custody remain required.
