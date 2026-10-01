"""Root-only SSH backup gate. Prints proof only; plaintext stays on the VPS."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile
from datetime import datetime, timezone


def run():
    sha, nonce = sys.argv[1:]
    assert os.geteuid() == 0
    assert re.fullmatch(r'[a-f0-9]{40}', sha) and re.fullmatch(r'[a-f0-9]{32}', nonce)
    script = Path('/opt/ashbi-platform/scripts/backup-vps.sh')
    # Reviewed live script equals the repository backup script (LF bytes).
    assert hashlib.sha256(script.read_bytes()).hexdigest() == '8b95a0c0291e0ab4ba8960dc80da93148a59b91441c38ccb7b09ffef2f24b627'
    result = subprocess.run(['bash', str(script)], capture_output=True, text=True, timeout=600, check=True)
    fields = dict(line.split('=', 1) for line in result.stdout.splitlines() if line.startswith('BACKUP_'))
    archive = Path(fields['BACKUP_ARCHIVE'])
    assert archive.parent == Path('/opt/ashbi-platform/backups/encrypted')
    assert re.fullmatch(r'ashbi-full-\d{8}_\d{6}-[a-z0-9]{7}\.tar\.age', archive.name)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    assert digest == fields['BACKUP_SHA256'] and archive.stat().st_size == int(fields['BACKUP_BYTES'])
    with tempfile.TemporaryDirectory(prefix='.release-verify-', dir='/opt/ashbi-platform/backups') as directory:
        plain = Path(directory) / 'backup.tar'
        subprocess.run(['age', '--decrypt', '-i', '/root/.config/ashbi-backup/identity.txt', '-o', str(plain), str(archive)], capture_output=True, check=True, timeout=120)
        with tarfile.open(plain) as bundle:
            # Inspect members directly; never extract archive paths.
            members = {item.name: item for item in bundle.getmembers() if item.isfile()}
            for required in ['./database.dump', './runtime/environment', './manifest.sha256']:
                assert required in members
            manifest = bundle.extractfile(members['./manifest.sha256']).read().decode()
            verified = set()
            for line in manifest.splitlines():
                expected, name = line.split('  ', 1)
                assert re.fullmatch(r'[a-f0-9]{64}', expected) and name in members
                assert hashlib.sha256(bundle.extractfile(members[name]).read()).hexdigest() == expected
                verified.add(name)
            assert verified == set(members) - {'./manifest.sha256'}
            dump = Path(directory) / 'database.dump'
            dump.write_bytes(bundle.extractfile(members['./database.dump']).read())
            os.chmod(dump, 0o600)
            catalog = subprocess.run(['pg_restore', '-l', str(dump)], capture_output=True, text=True, check=True, timeout=60).stdout
            assert ' TABLE DATA public ' in catalog
    return {'status': 'ok', 'releaseSha': sha, 'nonce': nonce, 'archive': str(archive), 'sha256': digest,
            'bytes': archive.stat().st_size, 'completedAt': datetime.now(timezone.utc).isoformat(),
            'manifestVerified': True, 'databaseCatalogVerified': True}


if __name__ == '__main__':
    try:
        print(json.dumps(run()))
    except Exception:
        # Command errors can contain credentials or archive data; suppress them.
        print(json.dumps({'status': 'failed', 'reason': 'Production backup verification failed'}))
        sys.exit(1)
