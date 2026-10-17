import importlib.util
from pathlib import Path
import unittest
import sys
import hashlib
import subprocess
import tempfile
from unittest.mock import patch, Mock

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location('backup_command', Path(__file__).with_name('backup-ssh-command.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
verify_spec = importlib.util.spec_from_file_location('backup_verify', Path(__file__).with_name('verify-production-backup.py'))
verifier = importlib.util.module_from_spec(verify_spec)
verify_spec.loader.exec_module(verifier)


class CommandScope(unittest.TestCase):
    def test_allowed_recovery_operations(self):
        self.assertEqual(module.parse_command('ashbi-backup '+'a'*40+' '+'b'*32), ('backup', ['a'*40, 'b'*32]))
        path = '/opt/ashbi-platform/backups/encrypted/ashbi-full-20261001_010000-c81024e.tar.age'
        self.assertEqual(module.parse_command('scp -f '+path), ('download', [path]))

    def test_shell_plaintext_upload_and_traversal_are_rejected(self):
        for command in ['', 'sh', 'id', 'cat /root/.ssh/id_ed25519', 'scp -f /root/.config/ashbi-backup/identity.txt',
                        'scp -t /opt/ashbi-platform/backups/encrypted/new', 'scp -f /opt/ashbi-platform/backups/encrypted/../environment',
                        'ashbi-backup aaa bbb', 'ashbi-backup '+'a'*40+' '+'b'*32+'; id', 'scp -r -f /opt/ashbi-platform/backups/encrypted']:
            with self.assertRaises(ValueError, msg=command):
                module.parse_command(command)


class MatchingEngineCatalog(unittest.TestCase):
    def test_catalog_streams_private_dump_to_current_container_tools(self):
        with tempfile.TemporaryDirectory() as directory:
            dump = Path(directory) / 'database.dump'
            dump.write_bytes(b'PGDMP synthetic private archive')
            observed = {}
            def execute(args, **kwargs):
                observed['args'] = args
                observed['bytes'] = kwargs['stdin'].read()
                self.assertTrue(kwargs['capture_output'])
                self.assertTrue(kwargs['check'])
                self.assertEqual(kwargs['timeout'], 60)
                return Mock(stdout=b'123 TABLE DATA public clients\n')
            with patch.object(verifier.subprocess, 'run', side_effect=execute):
                self.assertIn('TABLE DATA public', verifier.database_catalog(dump))
            self.assertEqual(observed['args'], ['docker', 'exec', '-i', 'ashbi-hub-postgres', 'pg_restore', '-l'])
            self.assertEqual(observed['bytes'], dump.read_bytes())
            self.assertNotIn(str(dump), observed['args'])

    def test_incompatible_catalog_does_not_turn_into_success(self):
        with tempfile.TemporaryDirectory() as directory:
            dump = Path(directory) / 'database.dump'
            dump.write_bytes(b'incompatible archive')
            with patch.object(verifier.subprocess, 'run', side_effect=subprocess.CalledProcessError(1, 'docker', stderr=b'synthetic private error')):
                with self.assertRaises(subprocess.CalledProcessError):
                    verifier.database_catalog(dump)

    def test_missing_dump_never_dispatches_docker(self):
        with patch.object(verifier.subprocess, 'run') as execute:
            with tempfile.TemporaryDirectory() as directory:
                with self.assertRaises(FileNotFoundError):
                    verifier.database_catalog(Path(directory) / 'missing.dump')
            execute.assert_not_called()

    def test_source_pin_matches_reviewed_backup_and_rejects_drift_before_backup(self):
        source = Path(__file__).resolve().parents[1] / 'backup-vps.sh'
        expected = hashlib.sha256(source.read_bytes()).hexdigest()
        self.assertIn(expected, Path(verifier.__file__).read_text(encoding='utf-8'))
        fake = Mock()
        fake.read_bytes.return_value = b'unreviewed script'
        with patch.object(verifier.os, 'geteuid', return_value=0, create=True), patch.object(verifier.sys, 'argv', ['verify', 'a'*40, 'b'*32]), patch.object(verifier, 'Path', return_value=fake), patch.object(verifier.subprocess, 'run') as execute:
            with self.assertRaises(AssertionError):
                verifier.run()
            execute.assert_not_called()

    def test_matching_source_pin_reaches_only_the_reviewed_backup_command(self):
        source = Path(__file__).resolve().parents[1] / 'backup-vps.sh'
        fake = Mock()
        fake.read_bytes.return_value = source.read_bytes()
        with patch.object(verifier.os, 'geteuid', return_value=0, create=True), patch.object(verifier.sys, 'argv', ['verify', 'a'*40, 'b'*32]), patch.object(verifier, 'Path', return_value=fake), patch.object(verifier.subprocess, 'run', side_effect=RuntimeError('stop after reviewed command')) as execute:
            with self.assertRaisesRegex(RuntimeError, 'stop after reviewed command'):
                verifier.run()
            self.assertEqual(execute.call_args.args[0], ['bash', str(fake)])
            self.assertEqual(execute.call_args.kwargs['timeout'], 600)


if __name__ == '__main__':
    unittest.main()
