#!/usr/bin/python3
"""Forced SSH command for a recovery-only key; no shell or arbitrary files."""
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import sys

ARCHIVE_ROOT = Path('/opt/ashbi-platform/backups/encrypted')
VERIFIER = Path('/usr/local/libexec/ashbi-ci-backup-verify.py')


def parse_command(command):
    args = shlex.split(command)
    if len(args) == 3 and args[0] == 'ashbi-backup' and re.fullmatch(r'[a-f0-9]{40}', args[1]) and re.fullmatch(r'[a-f0-9]{32}', args[2]):
        return 'backup', args[1:]
    if len(args) == 3 and args[:2] == ['scp', '-f']:
        archive = PurePosixPath(args[2])
        if archive.parent == PurePosixPath(str(ARCHIVE_ROOT).replace('\\', '/')) and re.fullmatch(r'ashbi-full-\d{8}_\d{6}-[a-z0-9]{7}\.tar\.age', archive.name):
            return 'download', [str(archive)]
    raise ValueError('Command outside backup scope')


def main():
    operation, args = parse_command(os.environ.get('SSH_ORIGINAL_COMMAND', ''))
    # Do not inherit caller-provided backup variables or executable paths.
    environment = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': '/root', 'LANG': 'C.UTF-8'}
    if operation == 'backup':
        info = VERIFIER.stat()
        if info.st_uid != 0 or info.st_mode & 0o022 or VERIFIER.is_symlink():
            raise ValueError('Unsafe verifier ownership')
        os.execve('/usr/bin/python3', ['python3', str(VERIFIER), *args], environment)
    archive = Path(args[0])
    info = archive.stat()
    if archive.is_symlink() or archive.resolve() != archive or not archive.is_file() or info.st_uid != 0 or info.st_mode & 0o077:
        raise ValueError('Unsafe archive ownership')
    os.execve('/usr/bin/scp', ['scp', '-f', str(archive)], environment)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Backup SSH request rejected', file=sys.stderr)
        sys.exit(1)
