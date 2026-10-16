"""Synthetic offline regression suite; no Docker daemon or network."""
import gzip
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
import importlib.util
spec = importlib.util.spec_from_file_location('prepare_oci_artifact', Path(__file__).with_name('prepare-oci-artifact.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
prepare, sha, encoded = module.prepare, module.sha, module.encoded
CONFIG, MANIFEST, LAYER = module.CONFIG, module.MANIFEST, module.LAYER

REVISION = 'a' * 40


def fixture(change=None):
    layer = io.BytesIO()
    with tarfile.open(fileobj=layer, mode='w') as archive:
        member = tarfile.TarInfo('app/synthetic.txt')
        member.size = 3
        archive.addfile(member, io.BytesIO(b'QA\n'))
    raw = layer.getvalue()
    compressed = gzip.compress(raw, mtime=0)
    config = {'architecture': 'amd64', 'os': 'linux', 'rootfs': {'type': 'layers', 'diff_ids': [sha(raw)]},
              'config': {'Env': [f'APP_REVISION={REVISION}'], 'Labels': {'org.opencontainers.image.revision': REVISION}}}
    if change:
        change(config)
    config_bytes = encoded(config)
    row = {'mediaType': LAYER, 'digest': sha(compressed), 'size': len(compressed)}
    manifest = {'schemaVersion': 2, 'mediaType': MANIFEST, 'config': {'mediaType': CONFIG, 'digest': sha(config_bytes), 'size': len(config_bytes)}, 'layers': [row]}
    manifest_bytes = encoded(manifest)
    descriptor = {'mediaType': MANIFEST, 'digest': sha(manifest_bytes), 'size': len(manifest_bytes)}
    index = {'schemaVersion': 2, 'manifests': [descriptor]}
    members = {'oci-layout': encoded({'imageLayoutVersion': '1.0.0'}), 'index.json': encoded(index),
               'blobs/sha256/' + sha(config_bytes)[7:]: config_bytes, 'blobs/sha256/' + sha(manifest_bytes)[7:]: manifest_bytes,
               'blobs/sha256/' + row['digest'][7:]: compressed}
    return members, index, manifest


class ArtifactTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / 'input.tar'
        self.output = self.root / f'ashbi-platform-{REVISION}-oci-gzip.tar'

    def tearDown(self):
        self.temp.cleanup()

    def write(self, members, extra=None):
        with tarfile.open(self.source, 'w') as archive:
            for name, data in members.items():
                row = tarfile.TarInfo(name)
                row.size = len(data)
                archive.addfile(row, io.BytesIO(data))
            if extra:
                archive.addfile(extra)

    def prepare(self):
        return prepare(self.source, self.output, REVISION, '123456789', 'camster91/ashbi-platform')

    def test_valid_canonical_identity_traceability_and_checksums(self):
        members, _, manifest = fixture()
        self.write(members)
        proof = self.prepare()
        self.assertEqual(proof['engineImageId'], proof['imageId'])
        self.assertNotEqual(proof['engineImageId'], proof['configIdentity'])
        self.assertEqual(proof['configIdentity'], manifest['config']['digest'])
        self.assertEqual(proof['builderRunId'], '123456789')
        self.assertEqual(proof['archiveBytes'], self.output.stat().st_size)
        self.assertEqual(proof['schemaVersion'], 2)
        self.assertEqual(proof['diffIds'], json.loads(members['blobs/sha256/' + manifest['config']['digest'][7:]])['rootfs']['diff_ids'])
        with tarfile.open(self.output) as archive:
            self.assertEqual(archive.getnames()[1], 'blobs/sha256/' + manifest['layers'][0]['digest'][7:])
            self.assertEqual(set(archive.getnames()), set(members))
            descriptor = json.load(archive.extractfile('index.json'))['manifests'][0]
            self.assertEqual(descriptor['annotations']['io.containerd.image.name'], 'docker.io/library/ashbi-platform:' + REVISION)
        self.assertIn(proof['archiveSha256'] + '  ' + self.output.name, (self.root / 'SHA256SUMS').read_text())
        self.assertEqual(json.loads((self.root / 'metadata.json').read_text()), proof)

    def test_wrong_arch_revision_label_and_diff_id(self):
        mutations = [lambda c: c.update(architecture='arm64'), lambda c: c['config'].update(Env=['APP_REVISION=wrong']),
                     lambda c: c['config']['Labels'].update({'org.opencontainers.image.revision': 'wrong'}),
                     lambda c: c['rootfs'].update(diff_ids=['sha256:' + 'f' * 64])]
        for change in mutations:
            with self.subTest(change=change):
                self.write(fixture(change)[0])
                with self.assertRaises(ValueError):
                    self.prepare()
                self.assertFalse(self.output.exists())

    def test_duplicate_members(self):
        members, _, _ = fixture()
        self.write(members, tarfile.TarInfo('index.json'))
        with self.assertRaises(ValueError):
            self.prepare()

    def test_link_and_traversal_members(self):
        for name, kind in [('link', tarfile.SYMTYPE), ('../escape', tarfile.REGTYPE), ('/absolute', tarfile.REGTYPE), ('bad\\path', tarfile.REGTYPE)]:
            with self.subTest(name=name):
                extra = tarfile.TarInfo(name)
                extra.type = kind
                self.write(fixture()[0], extra)
                with self.assertRaises(ValueError):
                    self.prepare()

    def test_unused_blob(self):
        members, _, _ = fixture()
        members['blobs/sha256/' + 'e' * 64] = b'unused'
        self.write(members)
        with self.assertRaises(ValueError):
            self.prepare()

    def test_multiple_platforms_or_attestations(self):
        members, index, _ = fixture()
        index['manifests'].append(index['manifests'][0])
        members['index.json'] = encoded(index)
        self.write(members)
        with self.assertRaises(ValueError):
            self.prepare()

    def test_corrupt_blob(self):
        members, _, manifest = fixture()
        name = 'blobs/sha256/' + manifest['layers'][0]['digest'][7:]
        members[name] = b'X' + members[name][1:]
        self.write(members)
        with self.assertRaises(ValueError):
            self.prepare()

    def test_nested_index_and_wrong_descriptor_size(self):
        for change in [lambda d: d.update(mediaType='application/vnd.oci.image.index.v1+json'), lambda d: d.update(size=True)]:
            members, index, _ = fixture()
            change(index['manifests'][0])
            members['index.json'] = encoded(index)
            self.write(members)
            with self.assertRaises(ValueError):
                self.prepare()

    def test_output_is_exclusive_and_metadata_is_not_overwritten(self):
        self.write(fixture()[0])
        self.output.write_bytes(b'keep')
        with self.assertRaises(ValueError):
            self.prepare()
        self.assertEqual(self.output.read_bytes(), b'keep')

    def test_duplicate_json_key(self):
        members, _, _ = fixture()
        members['index.json'] = members['index.json'].replace(b'{', b'{"schemaVersion":0,', 1)
        self.write(members)
        with self.assertRaises(ValueError):
            self.prepare()

    def test_gzip_raw_payload_must_be_a_filesystem_tar(self):
        members, index, manifest = fixture()
        old_config_name = 'blobs/sha256/' + manifest['config']['digest'][7:]
        config = json.loads(members.pop(old_config_name))
        config['rootfs']['diff_ids'] = [sha(b'not a tar archive')]
        config_bytes = encoded(config)
        manifest['config'].update(digest=sha(config_bytes), size=len(config_bytes))
        members['blobs/sha256/' + sha(config_bytes)[7:]] = config_bytes
        members.pop('blobs/sha256/' + manifest['layers'][0]['digest'][7:])
        data = gzip.compress(b'not a tar archive', mtime=0)
        manifest['layers'][0].update(digest=sha(data), size=len(data))
        members['blobs/sha256/' + sha(data)[7:]] = data
        members.pop('blobs/sha256/' + index['manifests'][0]['digest'][7:])
        manifest_bytes = encoded(manifest)
        index['manifests'][0].update(digest=sha(manifest_bytes), size=len(manifest_bytes))
        members['blobs/sha256/' + sha(manifest_bytes)[7:]] = manifest_bytes
        members['index.json'] = encoded(index)
        self.write(members)
        with self.assertRaises(tarfile.ReadError):
            self.prepare()

    def test_invalid_provenance(self):
        self.write(fixture()[0])
        with self.assertRaises(ValueError):
            prepare(self.source, self.output, REVISION, '123456789', 'other/repo')
        with self.assertRaises(ValueError):
            prepare(self.source, self.output, 'mutable', '123456789', 'camster91/ashbi-platform')


if __name__ == '__main__':
    unittest.main()
