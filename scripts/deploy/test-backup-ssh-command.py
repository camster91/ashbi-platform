import importlib.util
from pathlib import Path
import unittest
import sys

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location('backup_command', Path(__file__).with_name('backup-ssh-command.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


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


if __name__ == '__main__':
    unittest.main()
