"""Validate a single-platform gzip OCI export and write a minimal canonical artifact.

Offline only: no Docker, network, registry, extraction, deployment or credentials.
"""
import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import tarfile

MANIFEST = 'application/vnd.oci.image.manifest.v1+json'
INDEX = 'application/vnd.oci.image.index.v1+json'
CONFIG = 'application/vnd.oci.image.config.v1+json'
LAYER = 'application/vnd.oci.image.layer.v1.tar+gzip'
MAX_ARCHIVE = 8 * 1024**3
MAX_METADATA = 1024**2
MAX_RAW_LAYER = 2 * 1024**3


def require(condition, message):
    if not condition:
        raise ValueError(message)


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def sha(data):
    return 'sha256:' + hashlib.sha256(data).hexdigest()


def checksum(file):
    h = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024**2), b''):
            h.update(chunk)
    return h.hexdigest()


def no_links(file):
    for part in [file, *file.parents]:
        require(not part.is_symlink(), 'Symlink path forbidden')


def catalog(archive):
    rows = archive.getmembers()
    names = [row.name for row in rows]
    require(len(names) == len(set(names)), 'Duplicate archive member')
    require(len(names) <= 512, 'Too many archive members')
    require(all(row.isfile() or row.isdir() for row in rows), 'Archive links/special files forbidden')
    require(all(not row.name.startswith('/') and '\\' not in row.name and all(part not in ('', '..', '.') for part in row.name.rstrip('/').split('/')) for row in rows), 'Unsafe archive member')
    return {row.name for row in rows if row.isfile()}


def unique_object(pairs):
    require(len(pairs) == len({key for key, _ in pairs}), 'Duplicate JSON object key')
    return dict(pairs)


def metadata(archive, name):
    member = archive.getmember(name)
    require(member.isfile() and member.size <= MAX_METADATA, 'Invalid bounded metadata')
    data = archive.extractfile(member).read()
    return data, json.loads(data, object_pairs_hook=unique_object)


def blob_name(descriptor):
    require(re.fullmatch(r'sha256:[a-f0-9]{64}', descriptor.get('digest', '')) is not None, 'Invalid blob identity')
    require(type(descriptor.get('size')) is int and descriptor['size'] > 0, 'Invalid blob size')
    return 'blobs/sha256/' + descriptor['digest'][7:]


def blob_metadata(archive, descriptor, media_type):
    require(descriptor.get('mediaType') == media_type, 'Unexpected blob media type')
    name = blob_name(descriptor)
    data, value = metadata(archive, name)
    require(len(data) == descriptor['size'] and sha(data) == descriptor['digest'], 'Blob metadata identity mismatch')
    return data, value


def add(archive, name, data):
    member = tarfile.TarInfo(name)
    member.size, member.mode, member.mtime = len(data), 0o644, 0
    archive.addfile(member, io.BytesIO(data))


def prepare(source_path, output_path, revision, builder, repository):
    require(re.fullmatch(r'[a-f0-9]{40}', revision) is not None, 'Full revision required')
    require(re.fullmatch(r'[1-9][0-9]{4,19}', builder) is not None, 'Builder run identity required')
    require(repository == 'camster91/ashbi-platform', 'Unexpected repository')
    source_path, output_path = Path(source_path).absolute(), Path(output_path).absolute()
    no_links(source_path)
    no_links(output_path)
    require(stat.S_ISREG(source_path.lstat().st_mode) and 0 < source_path.stat().st_size <= MAX_ARCHIVE, 'Invalid source archive')
    require(output_path.name == f'ashbi-platform-{revision}-oci-gzip.tar', 'Unexpected output filename')
    require(output_path.parent.is_dir(), 'Output directory must exist')
    require(source_path != output_path and not output_path.exists(), 'Output must be new')
    require(all(not (output_path.parent / name).exists() for name in ['metadata.json', 'SHA256SUMS']), 'Metadata output must be new')
    image = f'ashbi-platform:{revision}'
    source_hash = checksum(source_path)
    with tarfile.open(source_path, 'r:') as source:
        files = catalog(source)
        _, layout = metadata(source, 'oci-layout')
        require(layout == {'imageLayoutVersion': '1.0.0'}, 'Unsupported OCI layout')
        _, index = metadata(source, 'index.json')
        require(index.get('schemaVersion') == 2 and len(index.get('manifests', [])) == 1, 'Expected one platform manifest without attestations')
        descriptor = index['manifests'][0]
        manifest_bytes, manifest = blob_metadata(source, descriptor, MANIFEST)
        require(manifest.get('schemaVersion') == 2 and manifest.get('mediaType') == MANIFEST and not manifest.get('subject'), 'Unexpected image manifest')
        config_bytes, config = blob_metadata(source, manifest['config'], CONFIG)
        require(config.get('architecture') == 'amd64' and config.get('os') == 'linux', 'Only linux/amd64 is supported')
        platform = descriptor.get('platform')
        require(platform is None or platform == {'architecture': 'amd64', 'os': 'linux'}, 'Conflicting platform descriptor')
        require([value for value in config['config']['Env'] if value.startswith('APP_REVISION=')] == [f'APP_REVISION={revision}'], 'Application revision mismatch')
        require(config['config']['Labels']['org.opencontainers.image.revision'] == revision, 'OCI source revision mismatch')
        layers = manifest['layers']
        diff_ids = config['rootfs']['diff_ids']
        require(config['rootfs']['type'] == 'layers' and 0 < len(layers) <= 128 and len(layers) == len(diff_ids), 'Root filesystem layer mismatch')
        require(all(re.fullmatch(r'sha256:[a-f0-9]{64}', value) is not None for value in diff_ids), 'Invalid diff ID')
        expected = {'oci-layout', 'index.json', blob_name(descriptor), blob_name(manifest['config'])}
        total_raw = 0
        for row, diff_id in zip(layers, diff_ids):
            require(row.get('mediaType') == LAYER, 'All layers must use OCI gzip encoding')
            name = blob_name(row)
            expected.add(name)
            member = source.getmember(name)
            require(member.isfile() and member.size == row['size'], 'Layer size mismatch')
            h = hashlib.sha256()
            with source.extractfile(member) as stream:
                for chunk in iter(lambda: stream.read(1024**2), b''):
                    h.update(chunk)
            require('sha256:' + h.hexdigest() == row['digest'], 'Compressed layer identity mismatch')
            h, raw_bytes = hashlib.sha256(), 0
            with gzip.GzipFile(fileobj=source.extractfile(member)) as stream:
                for chunk in iter(lambda: stream.read(1024**2), b''):
                    h.update(chunk)
                    raw_bytes += len(chunk)
                    require(raw_bytes <= MAX_RAW_LAYER and total_raw + raw_bytes <= MAX_ARCHIVE, 'Uncompressed layer bound exceeded')
            require(raw_bytes > 0 and 'sha256:' + h.hexdigest() == diff_id, 'Root filesystem diff ID mismatch')
            with gzip.GzipFile(fileobj=source.extractfile(member)) as raw_stream:
                with tarfile.open(fileobj=raw_stream, mode='r|') as layer_tar:
                    count = 0
                    for _ in layer_tar:
                        count += 1
                        require(count <= 500000, 'Too many filesystem layer members')
            total_raw += raw_bytes
        require(files == expected, 'Unused or unexpected OCI blobs are forbidden')
        canonical_index = encoded({'schemaVersion': 2, 'mediaType': INDEX, 'manifests': [{
            'mediaType': MANIFEST, 'digest': descriptor['digest'], 'size': descriptor['size'],
            'platform': {'architecture': 'amd64', 'os': 'linux'}, 'annotations': {
                'io.containerd.image.name': 'docker.io/library/' + image,
                'org.opencontainers.image.ref.name': revision}}]})
        # Rootfs layer order first permits already-resident prefix blobs to dedup
        # before new content. Credit is never assumed; the operator must prove it.
        with output_path.open('xb') as out, tarfile.open(fileobj=out, mode='w', format=tarfile.USTAR_FORMAT) as archive:
            add(archive, 'oci-layout', encoded(layout))
            seen = set()
            for row in layers:
                name = blob_name(row)
                if name in seen:
                    continue
                seen.add(name)
                member = tarfile.TarInfo(name)
                member.size, member.mode, member.mtime = row['size'], 0o644, 0
                archive.addfile(member, source.extractfile(name))
            add(archive, blob_name(manifest['config']), config_bytes)
            add(archive, blob_name(descriptor), manifest_bytes)
            add(archive, 'index.json', canonical_index)
        with output_path.open('r+b') as completed:
            os.fsync(completed.fileno())
    require(checksum(source_path) == source_hash, 'Source changed during validation')
    with tarfile.open(output_path, 'r:') as output:
        require(catalog(output) == expected, 'Canonical output membership mismatch')
        require(output.extractfile('index.json').read() == canonical_index, 'Canonical output index mismatch')
        for row in [*layers, manifest['config'], descriptor]:
            h = hashlib.sha256()
            member = output.getmember(blob_name(row))
            with output.extractfile(member) as stream:
                for chunk in iter(lambda: stream.read(1024**2), b''):
                    h.update(chunk)
            require(member.size == row['size'] and 'sha256:' + h.hexdigest() == row['digest'], 'Canonical output blob mismatch')
    archive_hash = checksum(output_path)
    proof = {'schemaVersion': 2, 'archiveFormat': 'oci-gzip', 'revision': revision, 'image': image,
             'imageId': descriptor['digest'], 'engineImageId': descriptor['digest'],
             'engineIdentityPolicy': 'Docker29-containerd-manifest', 'configIdentity': manifest['config']['digest'],
             'size': total_raw, 'sizeMeaning': 'sum of uncompressed layer tar bytes, not disk allocation',
             'architecture': 'amd64', 'os': 'linux', 'archiveSha256': archive_hash, 'archiveBytes': output_path.stat().st_size,
             'builderRunId': builder, 'repository': repository, 'sourceExportSha256': source_hash,
             'diffIds': diff_ids, 'layers': layers}
    metadata_path = output_path.parent / 'metadata.json'
    with metadata_path.open('x', encoding='utf8', newline='\n') as stream:
        stream.write(json.dumps(proof, sort_keys=True, indent=2) + '\n')
    with (output_path.parent / 'SHA256SUMS').open('x', encoding='utf8', newline='\n') as stream:
        stream.write(f'{archive_hash}  {output_path.name}\n{checksum(metadata_path)}  metadata.json\n')
    return proof


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for option in ['input', 'output', 'revision', 'builder-run-id', 'repository']:
        parser.add_argument('--' + option, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(prepare(args.input, args.output, args.revision, args.builder_run_id, args.repository)))
    except Exception:
        raise SystemExit('OCI artifact validation failed; no valid final metadata should be published.') from None
