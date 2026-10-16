# Hosted image artifact preparation

`Build release image artifact` is a manual **build-only** workflow. It checks out
exactly its main-branch run SHA, builds the existing Dockerfile for Linux amd64,
verifies the embedded application/OCI revision and image architecture, and saves
one Docker archive with `metadata.json` and `SHA256SUMS` for three days. It has
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
archive bytes and the exact metadata revision/image ID. On the VPS separately
check transfer integrity and space for extraction/image loading, obtain a fresh
verified encrypted off-server backup, then use the unchanged archive mode of
`scripts/deploy-vps-direct.sh` with metadata's revision, image, imageId and
archiveSha256. The builder does not establish deployment readiness or authorize
cache pruning. Retain normal rollback and strict public/worker revision checks.

The build uses a clean checkout and `.dockerignore` excludes `.env`/`.env.*`.
No production environment file, uploaded data, mailbox connection or provider key
is supplied. The runner's image inspection file is not included in the artifact.
