<?php
/**
 * Tests for Ashbi_Updater::verify_upgrade_package — PR #28 SHA256SUMS verify.
 *
 * The verify_upgrade_package hook is added in PR #28. Until that PR merges,
 * the public method does not exist on master; all tests skip cleanly with
 * a clear "waiting for PR #28" message. Once the PR lands, these tests
 * prove the verify hook works without source modifications.
 *
 * Coverage (post-PR #28):
 *   - Local package path → pass through (filter default)
 *   - Valid SHA256SUMS entry → returns the temp path or filter default
 *   - Mismatched hash → WP_Error
 *   - Missing SHA256SUMS asset → log warning, skip verify (no WP_Error)
 *   - zipball_url → pass through (no SHA256SUMS entry for HEAD archive)
 */
class Sha256VerifyTest extends Ashbi_TestCase {
    /** @var Ashbi_Updater */
    private $updater;

    protected function setUp(): void {
        parent::setUp();
        if ( ! class_exists( 'Ashbi_Updater' ) ) {
            $this->markTestSkipped( 'Ashbi_Updater not loadable' );
        }
        $this->updater = new Ashbi_Updater();
        $GLOBALS['__ashbi_test_remote_responses']   = [];
        $GLOBALS['__ashbi_test_remote_response']    = null;
        $GLOBALS['__ashbi_test_remote_log']         = [];
        $GLOBALS['__ashbi_test_download_body']      = 'downloaded body';
    }

    private function require_method(): void {
        if ( ! method_exists( $this->updater, 'verify_upgrade_package' ) ) {
            $this->markTestSkipped( 'verify_upgrade_package not yet implemented (PR #28 not merged)' );
        }
    }

    public function test_method_exists_after_pr28(): void {
        $this->require_method();
        $this->assertTrue( method_exists( $this->updater, 'verify_upgrade_package' ) );
    }

    public function test_local_package_passes_through(): void {
        $this->require_method();
        $local = tempnam( sys_get_temp_dir(), 'ashbi-local-' );
        file_put_contents( $local, '<?php // local' );
        $result = $this->updater->verify_upgrade_package( false, $local, null );
        $this->assertFalse( $result, 'local package must pass through unchanged' );
    }

    public function test_empty_package_passes_through(): void {
        $this->require_method();
        $result = $this->updater->verify_upgrade_package( false, '', null );
        $this->assertFalse( $result, 'empty package must pass through unchanged' );
    }

    public function test_valid_hash_returns_non_error(): void {
        $this->require_method();
        $pkg_url  = 'https://github.com/camster91/ashbi-agency-wp-bridge/releases/download/v1.11.0/ashbi.zip';
        $pkg_body = 'fake zip body content for hash verification';
        $hash     = hash( 'sha256', $pkg_body );

        $release = [
            'tag_name' => 'v1.11.0',
            'assets'   => [
                [ 'name' => 'SHA256SUMS', 'browser_download_url' => 'https://example.com/SHA256SUMS' ],
                [ 'name' => 'ashbi.zip',  'browser_download_url' => $pkg_url ],
            ],
        ];
        $sums_body = "{$hash}  ashbi.zip\n";

        $GLOBALS['__ashbi_test_download_body'] = $pkg_body;
        $GLOBALS['__ashbi_test_remote_responses'] = [
            [ 'response' => [ 'code' => 200 ], 'body' => json_encode( $release ) ],
            [ 'response' => [ 'code' => 200 ], 'body' => $sums_body ],
        ];

        $result = $this->updater->verify_upgrade_package( false, $pkg_url, null );
        $this->assertNotInstanceOf( WP_Error::class, $result, 'valid hash must NOT return WP_Error' );
        $this->assertTrue( is_string( $result ) || false === $result );
    }

    public function test_mismatched_hash_returns_wp_error(): void {
        $this->require_method();
        $pkg_url  = 'https://github.com/camster91/ashbi-agency-wp-bridge/releases/download/v1.11.0/ashbi.zip';
        $hash     = str_repeat( 'a', 64 );

        $release = [
            'tag_name' => 'v1.11.0',
            'assets'   => [
                [ 'name' => 'SHA256SUMS', 'browser_download_url' => 'https://example.com/SHA256SUMS' ],
                [ 'name' => 'ashbi.zip',  'browser_download_url' => $pkg_url ],
            ],
        ];
        $sums_body = "{$hash}  ashbi.zip\n";

        $GLOBALS['__ashbi_test_remote_responses'] = [
            [ 'response' => [ 'code' => 200 ], 'body' => json_encode( $release ) ],
            [ 'response' => [ 'code' => 200 ], 'body' => $sums_body ],
        ];

        $result = $this->updater->verify_upgrade_package( false, $pkg_url, null );
        $this->assertInstanceOf( WP_Error::class, $result, 'hash mismatch must return WP_Error' );
    }

    public function test_missing_sha256sums_skips_verify(): void {
        $this->require_method();
        $pkg_url  = 'https://github.com/camster91/ashbi-agency-wp-bridge/releases/download/v1.10.2/ashbi.zip';
        $release  = [
            'tag_name' => 'v1.10.2',
            'assets'   => [
                [ 'name' => 'ashbi.zip', 'browser_download_url' => $pkg_url ],
            ],
        ];
        $GLOBALS['__ashbi_test_remote_responses'] = [
            [ 'response' => [ 'code' => 200 ], 'body' => json_encode( $release ) ],
        ];

        $result = $this->updater->verify_upgrade_package( false, $pkg_url, null );
        $this->assertNotInstanceOf( WP_Error::class, $result, 'missing SHA256SUMS must NOT block upgrade' );
    }

    public function test_zipball_url_passthrough(): void {
        $this->require_method();
        $zipball = 'https://api.github.com/repos/camster91/ashbi-agency-wp-bridge/zipball';
        $GLOBALS['__ashbi_test_remote_responses'] = [
            [
                'response' => [ 'code' => 200 ],
                'body'     => json_encode( [
                    'tag_name' => 'v1.10.2',
                    'assets'   => [],
                ] ),
            ],
        ];

        $result = $this->updater->verify_upgrade_package( false, $zipball, null );
        $this->assertNotInstanceOf( WP_Error::class, $result );
    }
}