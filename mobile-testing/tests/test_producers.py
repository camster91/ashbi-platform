import argparse
import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("producer", ROOT / "scripts/mobile_testing.py")
mobile = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mobile)


class ProducerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.binary = self.root / "app.ipa"
        self.binary.write_bytes(b"fabricated binary; OS signature inspection is mocked in these unit tests")
        self.config = {"schema": 1, "repository": "example/app", "identifiers": {"ios": "com.example.app"}, "required_checks": ["source-checks", "native-build", "signing"], "source_branches": ["testing"], "build_workflows": {"ios": [".github/workflows/build.yml"]}}
        self.env = {"GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": "example/app", "GITHUB_SHA": "a" * 40, "GITHUB_RUN_ID": "42", "GITHUB_RUN_ATTEMPT": "2", "GITHUB_REF": "refs/heads/testing", "GITHUB_WORKFLOW_REF": "example/app/.github/workflows/build.yml@refs/heads/testing"}
        self.args = argparse.Namespace(platform="ios", artifact=str(self.binary), version="1.0.0", build_number="7", source_checks_result="success", output_dir=str(self.root / "candidate"))

    def record(self, signature_ok=True):
        with patch.dict(os.environ, self.env, clear=True), patch.object(mobile, "command", return_value="a" * 40), patch.object(mobile, "inspect_ios") as inspect:
            if not signature_ok:
                inspect.side_effect = mobile.CandidateError("Signature failed")
            mobile.record_candidate(self.config, self.args)
            inspect.assert_called_once()

    def test_success_records_the_verified_binary_and_exact_run_attempt(self):
        self.record()
        directory = self.root / "candidate"
        receipt = json.loads((directory / "mobile-testing-receipt.json").read_text())
        self.assertEqual(receipt["build_run_attempt"], "2")
        self.assertEqual(receipt["source_commit"], "a" * 40)
        self.assertEqual(receipt["artifact"]["sha256"], mobile.digest(directory / "app.ipa"))
        self.assertEqual((directory / "app.ipa").read_bytes(), self.binary.read_bytes())

    def test_failed_os_signature_inspection_cannot_create_a_receipt(self):
        with self.assertRaises(mobile.CandidateError):
            self.record(signature_ok=False)
        self.assertFalse((self.root / "candidate").exists())

    def test_failed_source_check_cannot_create_a_receipt(self):
        self.args.source_checks_result = "failure"
        with self.assertRaises(mobile.CandidateError):
            self.record()
        self.assertFalse((self.root / "candidate").exists())

    def test_wrong_producer_context_is_rejected(self):
        for key, value in [("GITHUB_ACTIONS", "false"), ("GITHUB_SHA", "b" * 40), ("GITHUB_REF", "refs/pull/1/merge"), ("GITHUB_WORKFLOW_REF", "attacker/app/.github/workflows/build.yml@refs/heads/testing"), ("GITHUB_WORKFLOW_REF", "example/app/.github/workflows/other.yml@refs/heads/testing"), ("GITHUB_RUN_ATTEMPT", "")]:
            with self.subTest(key=key, value=value):
                original = self.env.copy()
                self.env[key] = value
                with self.assertRaises(mobile.CandidateError):
                    self.record()
                self.env = original

    def test_used_output_directory_is_not_replaced(self):
        directory = self.root / "candidate"
        directory.mkdir()
        (directory / "keep").write_text("existing")
        with self.assertRaises(mobile.CandidateError):
            self.record()
        self.assertEqual((directory / "keep").read_text(), "existing")

    def test_build_limit_and_version_validation(self):
        for key, value in [("build_number", "2100000001"), ("build_number", "0"), ("version", "latest")]:
            with self.subTest(key=key, value=value):
                original = copy.copy(self.args)
                setattr(self.args, key, value)
                with self.assertRaises(mobile.CandidateError):
                    self.record()
                self.args = original


class DestinationTests(unittest.TestCase):
    def setUp(self):
        self.config = {"upload_environments": {"ios": "testflight-upload"}}
        self.env = {"BETA_PLATFORM": "ios"}
        self.payload = {"name": "testflight-upload", "protection_rules": [{"type": "required_reviewers", "reviewers": [{"type": "User", "reviewer": {"login": "camster91", "id": 33962910}}]}]}

    def test_preexisting_owner_review_is_required(self):
        self.assertEqual(mobile.validate_destination(self.payload, self.config, self.env), "testflight-upload")
        self.payload["protection_rules"] = []
        with self.assertRaises(mobile.CandidateError):
            mobile.validate_destination(self.payload, self.config, self.env)

    def test_different_environment_or_reviewer_is_rejected(self):
        wrong = copy.deepcopy(self.payload)
        wrong["name"] = "unprotected"
        with self.assertRaises(mobile.CandidateError):
            mobile.validate_destination(wrong, self.config, self.env)
        wrong = copy.deepcopy(self.payload)
        wrong["protection_rules"][0]["reviewers"][0]["reviewer"]["id"] = 1
        with self.assertRaises(mobile.CandidateError):
            mobile.validate_destination(wrong, self.config, self.env)

    def test_expected_apple_team_is_not_overridden(self):
        with patch.dict(os.environ, {"IOS_TEAM_ID": "WRONGTEAM1"}, clear=True):
            with self.assertRaises(mobile.CandidateError):
                mobile.configure_identity({"apple_team_id": "EXPECTED12"})

    def test_latest_source_check_and_app_identity_are_verified(self):
        valid = {"id": 1, "name": "Native", "app": {"id": 15368}, "status": "completed", "conclusion": "success"}
        mobile.validate_source_checks([valid], ["Native"])
        for changed in [{**valid, "id": 2, "conclusion": "failure"}, {**valid, "id": 2, "app": {"id": 9}}]:
            with self.assertRaises(mobile.CandidateError):
                mobile.validate_source_checks([valid, changed], ["Native"])


class BuildInputTests(unittest.TestCase):
    def test_explicit_build_is_paired_with_source_version(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "package.json").write_text('{"version":"4.0.0"}')
            values = mobile.resolve_build_inputs({"minimum_build_number": 400}, "534", root=root)
            self.assertEqual(values["MARKETING_VERSION"], "4.0.0")
            self.assertEqual(values["MOBILE_BUILD_NUMBER"], "534")
            for value in [None, "", "0", "0399", "399", "2100000001", "534\n"]:
                with self.subTest(value=value):
                    with self.assertRaises(mobile.CandidateError):
                        mobile.resolve_build_inputs({"minimum_build_number": 400}, value, root=root)
            with self.assertRaises(mobile.CandidateError):
                mobile.resolve_build_inputs({}, "534", version_assertion="5.0.0", root=root)


class DoctorTests(unittest.TestCase):
    def test_contract_tests_cannot_hide_missing_app_ids_and_producers(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            config = {"repository": "example/app", "identifiers": {"ios": None, "android": "com.example.app"}, "build_workflows": {"ios": [], "android": []}}
            report = mobile.doctor(config, root=root)
            self.assertEqual(report["state"], "producer-integration-needed")
            self.assertEqual(len(report["platforms"]["ios"]["remaining_local_work"]), 3)
            self.assertEqual(report["signing_store_and_device_acceptance"], "not-verified-by-doctor")
            (root / ".github/workflows").mkdir(parents=True)
            (root / ".github/workflows/signed.yml").write_text("fixture")
            (root / "mobile-testing").mkdir()
            (root / "mobile-testing/Gemfile.lock").write_text("fixture")
            config["identifiers"]["ios"] = "com.example.app"
            config["build_workflows"] = {p: [".github/workflows/signed.yml"] for p in ["ios", "android"]}
            self.assertEqual(mobile.doctor(config, root=root)["state"], "local-pipeline-configured")


if __name__ == "__main__":
    unittest.main()
