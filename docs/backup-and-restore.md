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

The drill decrypts into a root-only temporary directory, verifies every manifest checksum and the PostgreSQL catalog, then restores into a disposable PostgreSQL 16 + pgvector container with no network and tmpfs storage. The image defaults to the same `pgvector/pgvector:pg16` capability used in production and can be pinned with `ASHBI_RESTORE_IMAGE`. It verifies representative organization, user, client, project, invoice, internal-note, and attachment counts without printing tenant content. Cleanup removes both plaintext and the disposable database.

Record the archive checksum, start/end timestamps, achieved RPO/RTO, sanitized counts, result, and follow-ups on #282. A successful same-host drill proves archive usability, not regional disaster recovery; off-host encrypted replication and independently approved key custody remain required.
