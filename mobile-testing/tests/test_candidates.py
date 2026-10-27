import copy
import importlib.util
import io
import json
from pathlib import Path
import stat
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("mobile_testing", ROOT / "scripts/mobile_testing.py")
mobile = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mobile)


class CandidateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.directory = Path(self.tmp.name)
        self.binary = self.directory / "app.ipa"
        self.binary.write_bytes(b"fabricated test binary, never a real release")
        self.env = {"GITHUB_REPOSITORY": "example/app", "BETA_PLATFORM": "ios", "BETA_SOURCE_COMMIT": "a" * 40, "BETA_BUILD_RUN_ID": "42"}
        self.config = {"schema": 1, "repository": "example/app", "identifiers": {"ios": "com.example.app"}, "required_checks": ["source-checks", "native-build", "signing"], "build_workflows": {"ios": [".github/workflows/build.yml"]}}
        self.receipt = {"schema": 1, "repository": "example/app", "source_commit": "a" * 40, "build_run_id": "42", "platform": "ios", "identifier": "com.example.app", "version": "1.0.0", "build_number": "7", "signed": True, "checks": {"source-checks": "passed", "native-build": "passed", "signing": "passed"}, "artifact": {"filename": "app.ipa", "sha256": mobile.digest(self.binary)}}
        self.run = {"id": 42, "head_repository": {"full_name": "example/app"}, "head_sha": "a" * 40, "head_branch": "main", "event": "workflow_dispatch", "status": "completed", "conclusion": "success", "path": ".github/workflows/build.yml"}
        self.repo = {"full_name": "example/app", "archived": False, "default_branch": "main"}

    def verify(self):
        return mobile.validate_receipt(self.config, self.env, self.receipt, self.directory)

    def test_valid_receipt_checks_binary_checksum(self):
        self.assertEqual(self.verify(), self.binary)

    def test_metadata_mismatches_are_rejected(self):
        for key in ["repository", "source_commit", "build_run_id", "platform", "identifier"]:
            with self.subTest(key=key):
                receipt = copy.deepcopy(self.receipt)
                receipt[key] = "different"
                with self.assertRaises(mobile.CandidateError):
                    mobile.validate_receipt(self.config, self.env, receipt, self.directory)

    def test_binary_change_is_rejected(self):
        self.binary.write_bytes(b"changed")
        with self.assertRaises(mobile.CandidateError):
            self.verify()

    def test_unsigned_candidate_is_rejected(self):
        self.receipt["signed"] = False
        with self.assertRaises(mobile.CandidateError):
            self.verify()

    def test_every_required_check_must_pass(self):
        for gate in self.config["required_checks"]:
            with self.subTest(gate=gate):
                self.receipt["checks"][gate] = "pending"
                with self.assertRaises(mobile.CandidateError):
                    self.verify()
                self.receipt["checks"][gate] = "passed"

    def test_missing_app_id_is_rejected(self):
        self.config["identifiers"]["ios"] = None
        with self.assertRaises(mobile.CandidateError):
            self.verify()

    def test_artifact_path_traversal_and_wrong_type_are_rejected(self):
        for filename in ["../app.ipa", "/tmp/app.ipa", "nested/app.ipa", "app.apk", "app.aab", "app.ipa\n", "app\\app.ipa"]:
            with self.subTest(filename=filename):
                self.receipt["artifact"]["filename"] = filename
                with self.assertRaises(mobile.CandidateError):
                    self.verify()

    def test_symlinked_binary_is_rejected(self):
        real = self.directory / "other"
        self.binary.rename(real)
        self.binary.symlink_to(real)
        with self.assertRaises(mobile.CandidateError):
            self.verify()

    def test_invalid_version_or_build_is_rejected(self):
        for key, values in [("version", ["latest", "1.0", "1.0.0-beta"]), ("build_number", [0, "-1", "01", "7\n"])]:
            for value in values:
                with self.subTest(key=key, value=value):
                    receipt = copy.deepcopy(self.receipt)
                    receipt[key] = value
                    with self.assertRaises(mobile.CandidateError):
                        mobile.validate_receipt(self.config, self.env, receipt, self.directory)

    def test_verified_default_branch_build_is_allowed(self):
        mobile.validate_run(self.run, self.repo, self.config, self.env)

    def test_untrusted_runs_are_rejected(self):
        for key, value in [("head_sha", "b" * 40), ("head_branch", "feature"), ("event", "pull_request"), ("status", "in_progress"), ("conclusion", "failure"), ("path", ".github/workflows/other.yml"), ("id", 43), ("head_repository", {"full_name": "attacker/app"})]:
            with self.subTest(key=key):
                run = copy.deepcopy(self.run)
                run[key] = value
                with self.assertRaises(mobile.CandidateError):
                    mobile.validate_run(run, self.repo, self.config, self.env)

    def test_archived_repository_is_rejected(self):
        self.repo["archived"] = True
        with self.assertRaises(mobile.CandidateError):
            mobile.validate_run(self.run, self.repo, self.config, self.env)

    def test_no_build_producer_approved_by_default(self):
        self.config["build_workflows"]["ios"] = []
        with self.assertRaises(mobile.CandidateError):
            mobile.validate_run(self.run, self.repo, self.config, self.env)

    def test_iphone_device_identity_and_versions(self):
        info = {"CFBundleIdentifier": "com.example.app", "CFBundleShortVersionString": "1.0.0", "CFBundleVersion": "7", "CFBundleSupportedPlatforms": ["iPhoneOS"]}
        mobile.validate_ios_info(info, self.receipt)
        for key, value in [("CFBundleIdentifier", "com.other.app"), ("CFBundleShortVersionString", "2.0.0"), ("CFBundleVersion", "8"), ("CFBundleSupportedPlatforms", ["iPhoneSimulator"])]:
            with self.subTest(key=key):
                altered = {**info, key: value}
                with self.assertRaises(mobile.CandidateError):
                    mobile.validate_ios_info(altered, self.receipt)

    def test_android_bundle_identity_versions_and_debug_mode(self):
        template = '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="{package}" android:versionName="{version}" android:versionCode="{code}"><application android:debuggable="{debug}" /></manifest>'
        values = {"package": "com.example.app", "version": "1.0.0", "code": "7", "debug": "false"}
        mobile.validate_android_manifest(template.format(**values), self.receipt)
        for key, value in [("package", "com.other.app"), ("version", "2.0.0"), ("code", "8"), ("debug", "true")]:
            with self.subTest(key=key):
                with self.assertRaises(mobile.CandidateError):
                    mobile.validate_android_manifest(template.format(**{**values, key: value}), self.receipt)

    def test_zip_traversal_and_symlinks_are_rejected(self):
        for name, symlink in [("../outside", False), ("/outside", False), ("dir\\outside", False), ("link", True)]:
            with self.subTest(name=name):
                buffer = io.BytesIO()
                with zipfile.ZipFile(buffer, "w") as z:
                    entry = zipfile.ZipInfo(name)
                    if symlink:
                        entry.external_attr = (stat.S_IFLNK | 0o777) << 16
                    z.writestr(entry, "fabricated")
                buffer.seek(0)
                with zipfile.ZipFile(buffer) as z:
                    with self.assertRaises(mobile.CandidateError):
                        mobile.checked_members(z)

    def test_safe_zip_extraction_preserves_executable_permissions(self):
        zipped = self.directory / "input.zip"
        with zipfile.ZipFile(zipped, "w") as z:
            entry = zipfile.ZipInfo("Payload/App.app/Executable")
            entry.external_attr = (stat.S_IFREG | 0o755) << 16
            z.writestr(entry, "fabricated")
        dest = self.directory / "out"
        mobile.extract_checked(zipped, dest)
        self.assertTrue((dest / "Payload/App.app/Executable").stat().st_mode & stat.S_IXUSR)
