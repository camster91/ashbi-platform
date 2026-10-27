#!/usr/bin/env python3
"""Validate and promote an exact signed candidate; never select a latest build."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import plistlib
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
import zipfile

BUNDLETOOL_VERSION = "1.18.3"
BUNDLETOOL_SHA256 = "a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29"
ROOT = Path(__file__).resolve().parents[1]


class CandidateError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise CandidateError(message)


def digest(path):
    checksum = hashlib.sha256()
    with Path(path).open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            checksum.update(block)
    return checksum.hexdigest()


def command(args, **kwargs):
    result = subprocess.run(args, capture_output=True, **kwargs)
    require(result.returncode == 0, f"{Path(args[0]).name} failed; candidate verification stopped.")
    return result.stdout


def environment():
    keys = ["GITHUB_REPOSITORY", "BETA_PLATFORM", "BETA_SOURCE_COMMIT", "BETA_BUILD_RUN_ID", "BETA_ARTIFACT_NAME", "BETA_ARTIFACT_DIR"]
    require(all(os.environ.get(key) for key in keys), "Repository, platform, full commit, build run, artifact name and artifact directory are required.")
    data = {key: os.environ[key] for key in keys}
    require(data["BETA_PLATFORM"] in ("ios", "android"), "Select ios or android.")
    require(bool(re.fullmatch(r"[0-9a-f]{40}", data["BETA_SOURCE_COMMIT"])), "Use a full lowercase commit SHA.")
    require(bool(re.fullmatch(r"[1-9][0-9]*", data["BETA_BUILD_RUN_ID"])), "Use a positive numeric build run ID.")
    require(bool(re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", data["GITHUB_REPOSITORY"])), "Repository identity is invalid.")
    require("\n" not in data["BETA_ARTIFACT_NAME"], "Artifact name is invalid.")
    return data


def check_configuration(config, env):
    require(config.get("schema") == 1, "Unsupported testing configuration.")
    require(config.get("repository") == env["GITHUB_REPOSITORY"], "Configuration belongs to a different repository.")
    identifier = config.get("identifiers", {}).get(env["BETA_PLATFORM"])
    require(isinstance(identifier, str) and re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+", identifier), "Confirm and configure this platform's app identifier before testing.")
    return identifier


def configure_identity(config):
    team = config.get("apple_team_id")
    if team:
        supplied = os.environ.get("IOS_TEAM_ID")
        require(not supplied or supplied == team, "Configured Apple team differs from the verification input.")
        os.environ["IOS_TEAM_ID"] = team


def resolve_build_inputs(config, build_number, version_assertion="", root=ROOT):
    require(isinstance(build_number, str) and re.fullmatch(r"[1-9][0-9]*", build_number), "Choose an explicit unused positive build number.")
    require(int(build_number) <= 2100000000, "Build number exceeds the Android versionCode limit.")
    require(int(build_number) >= config.get("minimum_build_number", 1), "Build number is below the committed source baseline.")
    mobile_root = root / config.get("mobile_root", ".")
    version = json.loads((mobile_root / "package.json").read_text())["version"]
    require(isinstance(version, str) and re.fullmatch(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", version), "Source package version must be canonical major.minor.patch.")
    require(not version_assertion or version_assertion == version, "Requested version must match source package.json.")
    return {"MARKETING_VERSION": version, "CURRENT_PROJECT_VERSION": build_number, "MOBILE_BUILD_NUMBER": build_number, "MOBILE_VERSION_NAME": version}


def doctor(config, root=ROOT):
    platforms = {}
    for platform in ("ios", "android"):
        identifier = config.get("identifiers", {}).get(platform)
        workflows = config.get("build_workflows", {}).get(platform, [])
        issues = []
        if not isinstance(identifier, str) or not identifier:
            issues.append("Confirm the release application identifier.")
        if not workflows:
            issues.append("Connect a reviewed signed-build producer and its candidate receipt.")
        elif any(not (root / path).is_file() for path in workflows):
            issues.append("An approved signed-build workflow file is missing.")
        if not (root / "mobile-testing/Gemfile.lock").is_file():
            issues.append("Retain the locked submission dependencies.")
        platforms[platform] = {"identifier": identifier, "producer_workflows": workflows, "local_integration": "needs-work" if issues else "configured", "remaining_local_work": issues}
    return {"repository": config.get("repository"), "platforms": platforms,
            "state": "producer-integration-needed" if any(p["remaining_local_work"] for p in platforms.values()) else "local-pipeline-configured",
            "signing_store_and_device_acceptance": "not-verified-by-doctor"}


def validate_run(run, repo, config, env):
    require(repo.get("full_name") == env["GITHUB_REPOSITORY"], "Repository lookup returned a different repository.")
    require(not repo.get("archived", True), "Archived repositories are excluded.")
    require(str(run.get("id")) == env["BETA_BUILD_RUN_ID"], "Build run does not match the selected ID.")
    require(run.get("head_repository", {}).get("full_name") == env["GITHUB_REPOSITORY"], "Fork builds are excluded.")
    require(run.get("head_sha") == env["BETA_SOURCE_COMMIT"], "Build run belongs to a different commit.")
    branches = config.get("source_branches", [repo.get("default_branch")])
    require(run.get("head_branch") in branches, "Use a build from an explicitly approved source branch.")
    require(run.get("event") in ("workflow_dispatch", "push"), "Pull-request and untrusted-event candidates are excluded.")
    require(run.get("status") == "completed" and run.get("conclusion") == "success", "Build run must have completed successfully.")
    require(run.get("path") in config.get("build_workflows", {}).get(env["BETA_PLATFORM"], []), "Approve the platform's signed-build workflow in mobile-testing.json first.")


def validate_source_checks(checks, required):
    latest = {}
    for check in checks:
        name = check.get("name")
        if name in required and check.get("id", -1) > latest.get(name, {}).get("id", -1):
            latest[name] = check
    for name in required:
        check = latest.get(name, {})
        require(check.get("app", {}).get("id") == 15368 and check.get("status") == "completed" and check.get("conclusion") == "success", f"Exact-source check has not passed: {name}.")


def github_json(endpoint):
    return json.loads(command(["gh", "api", endpoint], text=True))


def check_run(config, env):
    name = env["GITHUB_REPOSITORY"]
    run = github_json(f"repos/{name}/actions/runs/{env['BETA_BUILD_RUN_ID']}")
    repo = github_json(f"repos/{name}")
    validate_run(run, repo, config, env)
    required = config.get("required_source_checks", [])
    if required:
        pages = json.loads(command(["gh", "api", "--paginate", "--slurp", f"repos/{name}/commits/{env['BETA_SOURCE_COMMIT']}/check-runs?per_page=100"], text=True))
        validate_source_checks([check for page in pages for check in page["check_runs"]], required)
    return run


def validate_destination(payload, config, env):
    name = config.get("upload_environments", {}).get(env["BETA_PLATFORM"], "mobile-testing")
    require(payload.get("name") == name, "Upload environment identity differs from configuration.")
    owner = config.get("release_owner", {"login": "camster91", "id": 33962910})
    rules = [rule for rule in payload.get("protection_rules", []) if rule.get("type") == "required_reviewers"]
    require(len(rules) == 1, "The upload environment must have an existing owner-review rule.")
    reviewers = rules[0].get("reviewers", [])
    require(len(reviewers) == 1 and reviewers[0].get("type") == "User" and reviewers[0].get("reviewer", {}).get("login") == owner["login"] and reviewers[0].get("reviewer", {}).get("id") == owner["id"], "Upload approval must belong to the configured owner.")
    return name


def destination(config, env):
    name = config.get("upload_environments", {}).get(env["BETA_PLATFORM"], "mobile-testing")
    require(isinstance(name, str) and re.fullmatch(r"[A-Za-z0-9_-]+", name), "Configure one explicit upload environment.")
    payload = github_json(f"repos/{env['GITHUB_REPOSITORY']}/environments/{urllib.parse.quote(name, safe='')}")
    approved = validate_destination(payload, config, env)
    # An optional app-specific guard may enforce stricter branch/reviewer policy.
    guard = config.get("environment_guard")
    if guard:
        require(guard == "scripts/native/release_guard.py", "Unsupported environment guard path.")
        command([sys.executable, str(ROOT / guard), "environment", "--environment", name])
    output = os.environ.get("GITHUB_OUTPUT")
    require(output, "GitHub output destination is required.")
    with open(output, "a") as target:
        target.write(f"environment={approved}\n")
    print("Verified the existing owner-protected upload environment; no settings were changed.")


def checked_members(archive):
    members = archive.infolist()
    require(len(members) <= 100000, "Archive has too many entries.")
    require(sum(member.file_size for member in members) <= 8 * 1024**3, "Archive is too large to inspect.")
    seen = set()
    for member in members:
        path = PurePosixPath(member.filename)
        require(not path.is_absolute() and ".." not in path.parts and "\\" not in member.filename, "Archive contains an unsafe path.")
        require(not stat.S_ISLNK(member.external_attr >> 16), "Archive symlinks are not accepted.")
        require(member.filename not in seen, "Archive contains duplicate entries.")
        seen.add(member.filename)
    return members


def extract_checked(source, destination):
    with zipfile.ZipFile(source) as archive:
        members = checked_members(archive)
        archive.extractall(destination)
        for member in members:
            mode = (member.external_attr >> 16) & 0o777
            if mode:
                (Path(destination) / member.filename).chmod(mode)


def download(config, env):
    check_configuration(config, env)
    check_run(config, env)
    name = env["GITHUB_REPOSITORY"]
    # Explicit pagination: the selected artifact need not be on page one.
    pages = json.loads(command(["gh", "api", "--paginate", "--slurp", f"repos/{name}/actions/runs/{env['BETA_BUILD_RUN_ID']}/artifacts?per_page=100"], text=True))
    matches = [artifact for page in pages for artifact in page["artifacts"] if artifact["name"] == env["BETA_ARTIFACT_NAME"] and not artifact["expired"]]
    require(len(matches) == 1, "Select exactly one unexpired artifact from the build run.")
    artifact = matches[0]
    require(str(artifact.get("workflow_run", {}).get("id")) == env["BETA_BUILD_RUN_ID"], "Artifact belongs to a different build run.")
    require(artifact.get("workflow_run", {}).get("head_sha") == env["BETA_SOURCE_COMMIT"], "Artifact belongs to a different source commit.")
    dest = Path(env["BETA_ARTIFACT_DIR"])
    require(not dest.exists(), "Candidate directory already exists; use a fresh directory.")
    with tempfile.TemporaryDirectory(prefix="mobile-download-") as tmp:
        zipped = Path(tmp) / "artifact.zip"
        with zipped.open("wb") as output:
            result = subprocess.run(["gh", "api", f"repos/{name}/actions/artifacts/{artifact['id']}/zip"], stdout=output, stderr=subprocess.PIPE)
        require(result.returncode == 0, "Candidate artifact download failed.")
        api_digest = artifact.get("digest", "")
        require(api_digest.startswith("sha256:"), "Artifact requires a GitHub SHA-256 digest; republish it with a supported upload-artifact action.")
        require(digest(zipped) == api_digest.removeprefix("sha256:"), "Downloaded artifact does not match GitHub's digest.")
        dest.mkdir(parents=True)
        extract_checked(zipped, dest)
    print("Downloaded the selected artifact from the verified build run.")


def validate_receipt(config, env, receipt, directory):
    identifier = check_configuration(config, env)
    require(receipt.get("schema") == 1, "Unsupported or missing candidate receipt.")
    for key, expected in [("repository", env["GITHUB_REPOSITORY"]), ("source_commit", env["BETA_SOURCE_COMMIT"]), ("build_run_id", env["BETA_BUILD_RUN_ID"]), ("platform", env["BETA_PLATFORM"]), ("identifier", identifier)]:
        require(receipt.get(key) == expected, f"Candidate {key} does not match the selected build.")
    if env.get("BETA_BUILD_RUN_ATTEMPT"):
        require(receipt.get("build_run_attempt") == env["BETA_BUILD_RUN_ATTEMPT"], "Candidate belongs to a different run attempt.")
    require(bool(re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", str(receipt.get("version", "")))), "Candidate needs a numeric major.minor.patch version.")
    require(bool(re.fullmatch(r"[1-9][0-9]*", str(receipt.get("build_number", "")))), "Candidate needs a positive build number.")
    require(receipt.get("signed") is True, "Unsigned candidates cannot enter store testing.")
    for gate in config["required_checks"]:
        require(receipt.get("checks", {}).get(gate) == "passed", f"Candidate lacks a passed {gate} check.")
    artifact = receipt.get("artifact", {})
    filename = artifact.get("filename", "")
    suffix = ".ipa" if env["BETA_PLATFORM"] == "ios" else ".aab"
    require(isinstance(filename, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", filename) and filename.endswith(suffix), "Provide one signed IPA or AAB at the artifact root.")
    path = directory / filename
    require(not directory.is_symlink() and not path.is_symlink() and path.is_file(), "Candidate binary is missing or unsafe.")
    require(isinstance(artifact.get("sha256"), str) and re.fullmatch(r"[0-9a-f]{64}", artifact["sha256"]), "Candidate needs a SHA-256 checksum.")
    require(digest(path) == artifact["sha256"], "Candidate binary checksum does not match its receipt.")
    return path


def validate_ios_info(info, receipt):
    require(info.get("CFBundleIdentifier") == receipt["identifier"], "IPA contains a different app identifier.")
    require(info.get("CFBundleShortVersionString") == receipt["version"], "IPA marketing version does not match its receipt.")
    require(str(info.get("CFBundleVersion")) == str(receipt["build_number"]), "IPA build number does not match its receipt.")
    require(info.get("CFBundleSupportedPlatforms") == ["iPhoneOS"], "Simulator apps cannot enter TestFlight.")


def inspect_ios(binary, receipt):
    team = os.environ.get("IOS_TEAM_ID", "")
    require(bool(re.fullmatch(r"[A-Z0-9]{10}", team)), "Set the app's confirmed IOS_TEAM_ID variable.")
    with tempfile.TemporaryDirectory(prefix="mobile-ipa-") as tmp:
        extract_checked(binary, tmp)
        apps = list((Path(tmp) / "Payload").glob("*.app"))
        require(len(apps) == 1, "IPA must contain exactly one main application.")
        app = apps[0]
        validate_ios_info(plistlib.loads((app / "Info.plist").read_bytes()), receipt)
        # Zip extraction can lose executable mode; restore only the declared binary.
        info = plistlib.loads((app / "Info.plist").read_bytes())
        executable_name = info.get("CFBundleExecutable", "")
        require(re.fullmatch(r"[A-Za-z0-9_. -]+", executable_name), "IPA executable name is invalid.")
        executable = app / executable_name
        require(executable.is_file(), "IPA executable is missing.")
        executable.chmod(executable.stat().st_mode | stat.S_IXUSR)
        command(["codesign", "--verify", "--deep", "--strict", str(app)])
        entitlements = plistlib.loads(command(["codesign", "-d", "--entitlements", ":-", str(app)]))
        require(entitlements.get("com.apple.developer.team-identifier") == team, "IPA is signed by a different Apple team.")
        require(entitlements.get("application-identifier") == f"{team}.{receipt['identifier']}", "IPA signing identity differs from its bundle identity.")
        require(not entitlements.get("get-task-allow", False), "IPA permits debugger access; use distribution signing.")
        profile = plistlib.loads(command(["security", "cms", "-D", "-i", str(app / "embedded.mobileprovision")]))
        require("ProvisionedDevices" not in profile and not profile.get("ProvisionsAllDevices"), "Use an App Store distribution profile, not ad hoc or enterprise signing.")
        for extension in app.rglob("*.appex"):
            ext_info = plistlib.loads((extension / "Info.plist").read_bytes())
            require(str(ext_info.get("CFBundleVersion")) == str(receipt["build_number"]), "An app extension has a different build number.")
            require(ext_info.get("CFBundleShortVersionString") == receipt["version"], "An app extension has a different marketing version.")


def bundletool():
    configured = os.environ.get("BUNDLETOOL_JAR")
    dest = Path(configured) if configured else Path(tempfile.gettempdir()) / f"mobile-bundletool-{BUNDLETOOL_VERSION}.jar"
    require(not configured or dest.is_file(), "Configured bundletool is missing.")
    if not dest.exists():
        with urllib.request.urlopen(f"https://github.com/google/bundletool/releases/download/{BUNDLETOOL_VERSION}/bundletool-all-{BUNDLETOOL_VERSION}.jar") as source:
            with dest.open("wb") as output:
                shutil.copyfileobj(source, output)
    require(digest(dest) == BUNDLETOOL_SHA256, "Bundletool checksum differs from the pinned version.")
    return dest


def validate_android_manifest(xml, receipt):
    root = ET.fromstring(xml)
    android = "{http://schemas.android.com/apk/res/android}"
    require(root.attrib.get("package") == receipt["identifier"], "AAB contains a different app identifier.")
    require(root.attrib.get(android + "versionName") == receipt["version"], "AAB marketing version does not match its receipt.")
    require(root.attrib.get(android + "versionCode") == str(receipt["build_number"]), "AAB version code does not match its receipt.")
    app = root.find("application")
    require(app is not None and app.attrib.get(android + "debuggable", "false") == "false", "Debuggable AABs cannot enter store testing.")


def inspect_android(binary, receipt):
    fingerprint = os.environ.get("ANDROID_UPLOAD_CERT_SHA256", "").replace(":", "").lower()
    require(bool(re.fullmatch(r"[0-9a-f]{64}", fingerprint)), "Set the confirmed ANDROID_UPLOAD_CERT_SHA256 variable for this app.")
    with zipfile.ZipFile(binary) as archive:
        checked_members(archive)
        require("base/manifest/AndroidManifest.xml" in archive.namelist(), "Candidate is not an Android App Bundle.")
    verified = command(["jarsigner", "-J-Duser.language=en", "-J-Duser.country=US", "-verify", str(binary)], text=True)
    require("jar verified." in verified and "unsigned entries" not in verified, "AAB has no complete valid JAR signature.")
    certificate = command(["keytool", "-J-Duser.language=en", "-J-Duser.country=US", "-printcert", "-jarfile", str(binary)], text=True)
    found = re.findall(r"SHA256:\s*([A-Fa-f0-9:]+)", certificate)
    require(found and found[0].replace(":", "").lower() == fingerprint, "AAB was signed with a different upload certificate.")
    tool = str(bundletool())
    command(["java", "-jar", tool, "validate", f"--bundle={binary}"])
    xml = command(["java", "-jar", tool, "dump", "manifest", f"--bundle={binary}", "--module=base"], text=True)
    validate_android_manifest(xml, receipt)


def verify(config, env):
    run = check_run(config, env)
    env = {**env, "BETA_BUILD_RUN_ATTEMPT": str(run.get("run_attempt", 1))}
    configure_identity(config)
    directory = Path(env["BETA_ARTIFACT_DIR"])
    receipt_file = directory / "mobile-testing-receipt.json"
    require(not receipt_file.is_symlink(), "Candidate receipt must not be a symlink.")
    receipt = json.loads(receipt_file.read_text())
    binary = validate_receipt(config, env, receipt, directory)
    if env["BETA_PLATFORM"] == "ios":
        inspect_ios(binary, receipt)
    else:
        inspect_android(binary, receipt)
    print(f"Verified {receipt['platform']} candidate {receipt['identifier']} {receipt['version']} ({receipt['build_number']}) from {receipt['source_commit']}.")


def record_candidate(config, args):
    require(os.environ.get("GITHUB_ACTIONS") == "true", "Candidate receipts are produced inside the approved GitHub build workflow.")
    require(args.source_checks_result == "success", "The producer's source-check job must succeed before recording a candidate.")
    env = {
        "GITHUB_REPOSITORY": os.environ.get("GITHUB_REPOSITORY", ""),
        "BETA_PLATFORM": args.platform,
        "BETA_SOURCE_COMMIT": os.environ.get("GITHUB_SHA", ""),
        "BETA_BUILD_RUN_ID": os.environ.get("GITHUB_RUN_ID", ""),
    }
    identifier = check_configuration(config, env)
    head = command(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    require(head == env["BETA_SOURCE_COMMIT"], "Producer checkout differs from the GitHub source commit.")
    reference = os.environ.get("GITHUB_REF", "")
    branch = reference.removeprefix("refs/heads/")
    require(reference.startswith("refs/heads/") and branch in config.get("source_branches", ["main"]), "Producer must run from an explicitly approved branch.")
    workflow_ref = os.environ.get("GITHUB_WORKFLOW_REF", "")
    expected_prefix = env["GITHUB_REPOSITORY"] + "/"
    require(workflow_ref.startswith(expected_prefix), "Producer workflow belongs to a different repository.")
    workflow, separator, workflow_branch = workflow_ref[len(expected_prefix):].partition("@")
    require(separator and workflow_branch == reference and workflow in config.get("build_workflows", {}).get(args.platform, []), "Producer workflow is not approved for this platform and branch.")
    attempt = os.environ.get("GITHUB_RUN_ATTEMPT", "")
    require(re.fullmatch(r"[1-9][0-9]*", env["BETA_BUILD_RUN_ID"]) and re.fullmatch(r"[1-9][0-9]*", attempt), "Producer run and attempt are required.")
    require(re.fullmatch(r"[0-9a-f]{40}", head), "Producer source commit is invalid.")
    binary = Path(args.artifact).resolve()
    require(Path(args.artifact).is_file() and not Path(args.artifact).is_symlink(), "Producer binary is missing or unsafe.")
    require(binary.suffix == (".ipa" if args.platform == "ios" else ".aab"), "Use a signed store binary.")
    require(int(args.build_number) <= 2100000000, "Build number exceeds the Android versionCode limit.")
    receipt = {
        "schema": 1, "repository": env["GITHUB_REPOSITORY"], "source_commit": head,
        "build_run_id": env["BETA_BUILD_RUN_ID"], "build_run_attempt": attempt,
        "platform": args.platform, "identifier": identifier, "version": args.version,
        "build_number": args.build_number, "signed": True,
        "checks": {name: "passed" for name in config["required_checks"]},
        "artifact": {"filename": binary.name, "sha256": digest(binary)},
    }
    validate_receipt(config, env, receipt, binary.parent)
    configure_identity(config)
    if args.platform == "ios":
        inspect_ios(binary, receipt)
    else:
        inspect_android(binary, receipt)
    output = Path(args.output_dir)
    require(not output.exists(), "Use a fresh candidate output directory.")
    output.mkdir(parents=True)
    copied = output / binary.name
    shutil.copyfile(binary, copied)
    require(digest(copied) == receipt["artifact"]["sha256"], "Copied binary differs from the verified producer output.")
    (output / "mobile-testing-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print("Recorded a verified signed candidate and exact source/run receipt; no upload occurred.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["download", "verify", "destination", "record", "inputs", "doctor"])
    parser.add_argument("--platform", choices=["ios", "android"])
    parser.add_argument("--artifact")
    parser.add_argument("--version")
    parser.add_argument("--build-number")
    parser.add_argument("--source-checks-result")
    parser.add_argument("--output-dir")
    parser.add_argument("--github-env")
    args = parser.parse_args()
    config = json.loads((ROOT / "mobile-testing.json").read_text())
    if args.operation == "doctor":
        result = doctor(config)
        print(json.dumps(result, indent=2))
        require(result["state"] == "local-pipeline-configured", "Local producer integration remains incomplete; no store readiness is claimed.")
        return
    if args.operation == "inputs":
        values = resolve_build_inputs(config, args.build_number, args.version or "")
        require(args.github_env, "Provide the GitHub environment output file.")
        with open(args.github_env, "a") as target:
            for key, value in values.items():
                target.write(f"{key}={value}\n")
        print("Resolved source version and explicit build number; store history must be checked before dispatch.")
        return
    if args.operation == "record":
        require(all([args.platform, args.artifact, args.version, args.build_number, args.source_checks_result, args.output_dir]), "Producer platform, binary, version, build, check result and output directory are required.")
        record_candidate(config, args)
        return
    env = environment()
    if args.operation == "download":
        download(config, env)
    elif args.operation == "verify":
        verify(config, env)
    else:
        destination(config, env)


if __name__ == "__main__":
    try:
        main()
    except (CandidateError, OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile) as error:
        # Parse errors can quote input data; avoid printing arbitrary credential-bearing content.
        print(str(error) if isinstance(error, CandidateError) else "Candidate data could not be read or validated.", file=sys.stderr)
        sys.exit(1)
