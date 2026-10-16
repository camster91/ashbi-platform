# Hosted image artifact preparation

`Build release image artifact` is a manual **build-only** workflow. It checks out
exactly its main-branch run SHA, builds the existing Dockerfile for Linux amd64,
verifies the embedded application/OCI revision and image architecture, and saves
one minimal OCI gzip archive with `metadata.json` and `SHA256SUMS` for three days. It has
only `contents: read`; it has no registry push, production environment, deployment
credentials, server connection or deployment step. Existing release gates,
disabled registry workflow and the reviewed SSH controller are unchanged.

Artifacts inherit the repository's existing GitHub access policy. The Ashbi
repository is public; this source-only image artifact is not private. It contains
already-committed source and locked public dependencies, not production data,
credentials or backups. This workflow does not create a public container-registry
package or change repository visibility/access settings. Existing secret-leak
scanning runs on the clean checkout before the image build.

Once the reviewed implementation is merged and the exact main revision passes
required CI, dispatch the workflow for main. After download, verify `SHA256SUMS`,
archive bytes and the exact metadata revision, builder run, config identity and manifest engine ID. On the VPS separately
check transfer integrity and space for extraction/image loading, obtain a fresh
verified encrypted off-server backup, then use the unchanged archive mode of
`scripts/deploy-vps-direct.sh` with metadata's revision, image, imageId and
archiveSha256. The builder does not establish deployment readiness or authorize
cache pruning. Retain normal rollback and strict public/worker revision checks.

The build uses a clean checkout and `.dockerignore` excludes `.env`/`.env.*`.
No production environment file, uploaded data, mailbox connection or provider key
is supplied. The runner's image inspection file is not included in the artifact.


## Canonical OCI gzip format (metadata version 2)

The builder directly exports linux/amd64 OCI with gzip layers and disables build
attestations and SBOM attachments. It does not load the image into the runner's
Docker engine. `scripts/deploy/prepare-oci-artifact.py` validates the actual
export offline, then writes `ashbi-platform-<full SHA>-oci-gzip.tar`: one platform
manifest, its unchanged config, its referenced gzip layers, canonical `index.json`
and `oci-layout`. Nested indexes, unused blobs, additional platforms, duplicate
members, outer archive links/traversal and identity mismatches are rejected.
Each gzip layer's compressed SHA/size and uncompressed rootfs diff ID are checked.
The APP_REVISION environment entry and OCI revision label must match the run SHA.
Canonicalization changes archive layout/index annotations, never config or layer
bytes. Rootfs layer order is retained before config/manifest/index in the archive.

Metadata `schemaVersion: 2` and `archiveFormat: oci-gzip` distinguish this artifact
from previous classic Docker saves. `imageId` and `engineImageId` are the OCI
manifest digest used by the tested Docker 29 containerd image store; the separate
`configIdentity` is the unchanged config digest. Consumers must validate format
and target-runtime identity semantics, not reuse the classic config ID as the
engine ID. The tested runtime is Docker 29.5.3/containerd 2.2.4; the workflow does
not establish compatibility with another runtime. `size` is the sum of raw layer
tar bytes, explicitly **not** extracted disk allocation. `builderRunId`, repository,
revision and source-export checksum retain source/build traceability.

This format does not promise a constant archive size, available disk space or
resident base reuse. Before deployment independently verify the actual host,
compressed resident blob digests/bytes, committed snapshot chain/parents and a
true OCI import/extraction budget with metadata headroom and operating reserve.
Changing encoding cannot authorize pruning or replacing production configuration.
The artifact builder has no SSH, registry or deployment capability. Existing
classic artifacts remain historical; their metadata is not silently reinterpreted.

Run the synthetic validator regression through the normal unit suite or directly
with `python3 -B scripts/deploy/test_prepare_oci_artifact.py`. These tests do not
build/load an image or prove a hosted workflow or production deployment.
