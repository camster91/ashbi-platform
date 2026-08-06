<?php
/**
 * Tests for Ashbi_Backup::send_backup_report — PR #17 wire format.
 *
 * As of PR #17, the plugin sends an X-Ashbi-Signature header instead of
 * putting the secret in the body. Body now contains siteUrl, nonce,
 * timestamp, and the report.
 */
class HmacSignTest extends Ashbi_TestCase {
    /** @var ReflectionMethod|null */
    private $method;

    protected function setUp(): void {
        parent::setUp();
        $this->method = method_exists( 'Ashbi_Backup', 'send_backup_report' )
            ? $this->privateStaticMethod( 'Ashbi_Backup', 'send_backup_report' )
            : null;
        update_option( 'ashbi_hub_url', 'https://hub.example.com' );
        update_option( 'ashbi_secret_key', 'super-secret-key-abc123' );
    }

    private function invoke( array $report ): void {
        if ( $this->method === null ) {
            $this->markTestSkipped( 'send_backup_report not found' );
        }
        $this->method->invoke( null, $report );
    }

    public function test_posts_to_backup_endpoint(): void {
        $this->invoke( [ 'timestamp' => '2026-07-03 12:00:00', 'dbSuccess' => true ] );
        $log = $GLOBALS['__ashbi_test_remote_log'];
        $this->assertNotEmpty( $log, 'expected wp_remote_post to be called' );
        $last = end( $log );
        $this->assertSame( 'POST', $last['method'] );
        $this->assertSame( 'https://hub.example.com/api/wp-bridge/backup', $last['url'] );
    }

    public function test_content_type_is_json(): void {
        $this->invoke( [] );
        $last = end( $GLOBALS['__ashbi_test_remote_log'] );
        $this->assertSame( 'application/json', $last['args']['headers']['Content-Type'] ?? null );
    }

    /**
     * PR #17 removes secretKey from the body in favor of an HMAC signature
     * header. Secret must never appear in the body.
     */
    public function test_secret_not_in_body_after_pr17(): void {
        $this->invoke( [] );
        $last = end( $GLOBALS['__ashbi_test_remote_log'] );
        $decoded = json_decode( $last['args']['body'], true );

        $this->assertArrayNotHasKey( 'secretKey', $decoded, 'PR #17: secretKey must not appear in body' );
        $this->assertArrayHasKey( 'nonce', $decoded );
        $this->assertArrayHasKey( 'timestamp', $decoded );
        $this->assertArrayHasKey( 'siteUrl', $decoded );
    }

    public function test_signature_header_added_after_pr17(): void {
        $this->invoke( [] );
        $last = end( $GLOBALS['__ashbi_test_remote_log'] );
        $headers = $last['args']['headers'] ?? [];

        $this->assertArrayHasKey( 'X-Ashbi-Signature', $headers, 'PR #17 must add X-Ashbi-Signature header' );
        $this->assertMatchesRegularExpression( '/^sha256=[0-9a-f]{64}$/', $headers['X-Ashbi-Signature'] );
    }

    public function test_signature_matches_timestamp_plus_body(): void {
        $this->invoke( [ 'timestamp' => '2026-07-03 12:00:00', 'dbSuccess' => true ] );
        $last = end( $GLOBALS['__ashbi_test_remote_log'] );
        $headers = $last['args']['headers'] ?? [];
        $body    = $last['args']['body'];
        $decoded = json_decode( $body, true );

        $expected = hash_hmac( 'sha256', $decoded['timestamp'] . $body, 'super-secret-key-abc123' );
        $this->assertSame( 'sha256=' . $expected, $headers['X-Ashbi-Signature'] ?? null );
    }

    public function test_skips_when_hub_url_or_secret_missing(): void {
        delete_option( 'ashbi_hub_url' );
        $this->invoke( [] );
        $this->assertEmpty( $GLOBALS['__ashbi_test_remote_log'], 'no POST when hub_url missing' );

        update_option( 'ashbi_hub_url', 'https://hub.example.com' );
        delete_option( 'ashbi_secret_key' );
        $this->invoke( [] );
        $this->assertEmpty( $GLOBALS['__ashbi_test_remote_log'], 'no POST when secret missing' );
    }

    /**
     * Source-level guard: PR #17 wire format for send_backup_report() —
     * hub backup body must NOT contain a secretKey field, must contain
     * nonce/timestamp/siteUrl, and must include X-Ashbi-Signature.
     * (S3 config may still reference secretKey for SigV4 — that is unrelated.)
     */
    public function test_source_matches_pr17_wire_format(): void {
        $source = file_get_contents( __DIR__ . '/../../includes/class-ashbi-backup.php' );
        if ( ! preg_match( '/function\s+send_backup_report\s*\([^)]*\)\s*\{(.*?)\n\s*\}/s', $source, $m ) ) {
            $this->markTestSkipped( 'could not extract send_backup_report body' );
        }
        $body = $m[1];

        $this->assertStringNotContainsString( "'secretKey'", $body, 'PR #17 must remove secretKey from backup report body' );
        $this->assertStringContainsString( "'X-Ashbi-Signature'", $body, 'PR #17 must add X-Ashbi-Signature header' );
        $this->assertStringContainsString( "'nonce'", $body, 'PR #17 must include nonce in body' );
        $this->assertStringContainsString( "'timestamp'", $body, 'PR #17 must include timestamp in body' );
    }
}