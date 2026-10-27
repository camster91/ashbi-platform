# Common internal-testing interface

This adds the shared TestFlight/Google Play internal-testing submission contract for Ashbi Hub. It does not replace the capacitor app or change its live service.

**State: submission layer implemented locally; signed-build producer integration remains required.** Producer allowlists are empty until an app-specific reviewed build workflow actually produces signed binaries and the receipt. A simulator app, debug APK or unsigned archive is not a signed testing candidate.

## Per-app work still required

- No checked-in iOS project; verify the intended Apple bundle ID and create/test the iOS shell.
- Add signed mobile producers around the existing web client without changing backend or live deployment workflows.

## Producer contract

After the existing source checks and signed store build succeed, call:

```sh
python3 scripts/mobile_testing.py record --platform ios \
  --artifact path/to/app.ipa --version SOURCE_VERSION --build-number UNUSED_BUILD \
  --source-checks-result success --output-dir "$RUNNER_TEMP/mobile-candidate"
```

Use `--platform android` and an AAB for Android. This command is for an approved GitHub workflow on an approved source branch, not arbitrary local binaries. Pass the actual source-check step/job result; never hard-code success in a failed or skipped path. The recorder independently checks the native signature, identity and compiled version/build before emitting a receipt. Add that workflow path to the appropriate `build_workflows` allowlist only as part of its reviewed integration.

Upload the flattened output folder as one run artifact with its source SHA, run ID and attempt in the name. The common manual workflow selects the exact run and artifact, verifies source and hashes, and revalidates the same bytes before store upload.

## Credentials and approval

Configure the existing owner-approved signing system without changing or regenerating upload keys. Android verification requires `ANDROID_UPLOAD_CERT_SHA256`; iOS verification requires `IOS_TEAM_ID`. The credential-free validation job needs those public verification identities as repository variables. The credential-bearing upload environment must use the same identities.

Uploads use an already owner-protected `mobile-testing` environment. Its existence and reviewer identity are checked before the upload job starts. Creating the environment, changing protections and setting upload/signing secrets remain explicit owner actions. Upload secrets: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_API_PRIVATE_KEY` and `PLAY_SERVICE_ACCOUNT_JSON`. Never put their values in source, test fixtures, issues or chat.

The common workflow does not change testers or production listings. TestFlight processing, existing internal group access, real-device installation, upgrades/data preservation and app-specific acceptance remain separate checks. Default upload is false.

Local contract checks: `python3 -m unittest discover -s mobile-testing/tests`. The shared upload gems are locked; their local runtime and supported option checks are recorded in the fleet workspace. App-specific compilation, signing and store verification are not claimed by those contract tests.

Rollback before adoption: discard this additive review branch. No publication or remote account mutation has occurred.
