<?php
/**
 * Tests for Ashbi_Auth::verify_signature — HMAC + replay protection.
 *
 * PR #36: canonical string changed from `body` to `timestamp . body` so the
 * plugin matches the hub's hmac-client.js. Also accepts `sha256=<hmac>` form
 * to mirror the plugin's own outbound wire format.
 *
 *   - Valid timestamp+body signature returns true
 *   - Valid sha256=<sig> format also accepted
 *   - Signature computed against body only is rejected (regression guard)
 *   - Tampered body returns error
 *   - Missing X-Ashbi-Timestamp header is rejected
 *   - Missing X-Ashbi-Signature header is rejected
 *   - Missing ashbi_secret_key option is rejected
 *   - Timestamp outside ASHBI_REPLAY_WINDOW is rejected (replay protection)
 *   - hash_equals() is used (constant-time)
 */

class HmacVerifyTest extends Ashbi_TestCase {

	private const SECRET = 'super-secret-test-key-1234567890';

	protected function setUp(): void {
		parent::setUp();
		update_option( 'ashbi_secret_key', self::SECRET );
	}

	/**
	 * Build a fake WP_REST_Request with body + standard HMAC headers.
	 */
	private function make_request( $body, $timestamp, $signature ): WP_REST_Request {
		return new WP_REST_Request(
			[
				'X-Ashbi-Timestamp' => (string) $timestamp,
				'X-Ashbi-Signature' => $signature,
			],
			$body
		);
	}

	/**
	 * Core fix: a signature computed over `timestamp . body` MUST verify.
	 * This is the case that was returning 403 before the fix.
	 */
	public function test_valid_signature_passes_with_timestamp_plus_body(): void {
		$body      = wp_json_encode( [ 'siteUrl' => 'https://example.com', 'action' => 'health' ] );
		$timestamp = (string) time();
		$sig       = hash_hmac( 'sha256', $timestamp . $body, self::SECRET );

		$request = $this->make_request( $body, $timestamp, $sig );
		$this->assertTrue( Ashbi_Auth::verify_signature( $request ) );
	}

	/**
	 * The plugin's outbound format is `sha256=<hmac>` (see
	 * Ashbi_Backup::send_backup_report). The verifier should accept it too.
	 */
	public function test_valid_signature_with_sha256_prefix_passes(): void {
		$body      = wp_json_encode( [ 'siteUrl' => 'https://example.com', 'action' => 'health' ] );
		$timestamp = (string) time();
		$sig       = hash_hmac( 'sha256', $timestamp . $body, self::SECRET );

		$request = $this->make_request( $body, $timestamp, 'sha256=' . $sig );
		$this->assertTrue( Ashbi_Auth::verify_signature( $request ) );
	}

	/**
	 * Regression guard: a signature computed over `body` only (the v1.10.1
	 * canonical) MUST be rejected, otherwise we have the same wire-format
	 * mismatch the other way around.
	 */
	public function test_signature_over_body_only_is_rejected(): void {
		$body      = wp_json_encode( [ 'siteUrl' => 'https://example.com', 'action' => 'health' ] );
		$timestamp = (string) time();
		$old_sig   = hash_hmac( 'sha256', $body, self::SECRET );

		$request = $this->make_request( $body, $timestamp, $old_sig );
		$result  = Ashbi_Auth::verify_signature( $request );

		$this->assertInstanceOf( WP_Error::class, $result );
		$this->assertSame( 'ashbi_invalid_signature', $result->get_error_code() );
	}

	/**
	 * Tampered body: signature is over the original timestamp+body, but
	 * the request body is altered. Must be rejected.
	 */
	public function test_tampered_body_returns_error(): void {
		$timestamp = (string) time();
		$original  = wp_json_encode( [ 'siteUrl' => 'https://example.com', 'action' => 'health' ] );
		$sig       = hash_hmac( 'sha256', $timestamp . $original, self::SECRET );
		$tampered  = wp_json_encode( [ 'siteUrl' => 'https://example.com', 'action' => 'evil' ] );

		$request = $this->make_request( $tampered, $timestamp, $sig );
		$result  = Ashbi_Auth::verify_signature( $request );

		$this->assertInstanceOf( WP_Error::class, $result );
		$this->assertSame( 'ashbi_invalid_signature', $result->get_error_code() );
	}

	public function test_missing_signature_header_returns_error(): void {
		$body      = wp_json_encode( [ 'foo' => 'bar' ] );
		$timestamp = (string) time();
		$request   = new WP_REST_Request(
			[ 'X-Ashbi-Timestamp' => $timestamp ],
			$body
		);
		$result = Ashbi_Auth::verify_signature( $request );

		$this->assertInstanceOf( WP_Error::class, $result );
		$this->assertSame( 'ashbi_missing_signature', $result->get_error_code() );
		$this->assertSame( 403, $result->error_data['ashbi_missing_signature']['status'] ?? null );
	}

	public function test_missing_timestamp_header_returns_error(): void {
		$body    = wp_json_encode( [ 'foo' => 'bar' ] );
		$sig     = hash_hmac( 'sha256', time() . $body, self::SECRET );
		$request = new WP_REST_Request(
			[ 'X-Ashbi-Signature' => $sig ],
			$body
		);
		$result = Ashbi_Auth::verify_signature( $request );

		$this->assertInstanceOf( WP_Error::class, $result );
		$this->assertSame( 'ashbi_missing_timestamp', $result->get_error_code() );
		$this->assertSame( 403, $result->error_data['ashbi_missing_timestamp']['status'] ?? null );
	}

	public function test_missing_secret_key_returns_error(): void {
		delete_option( 'ashbi_secret_key' );
		$body      = wp_json_encode( [ 'foo' => 'bar' ] );
		$timestamp = (string) time();
		$request   = $this->make_request( $body, $timestamp, 'irrelevant' );

		$result = Ashbi_Auth::verify_signature( $request );
		$this->assertInstanceOf( WP_Error::class, $result );
		$this->assertSame( 'ashbi_missing_key', $result->get_error_code() );
	}

	public function test_stale_timestamp_returns_error(): void {
		$stale   = time() - ( ASHBI_REPLAY_WINDOW + 60 );
		$body    = wp_json_encode( [ 'siteUrl' => 'https://example.com' ] );
		$sig     = hash_hmac( 'sha256', $stale . $body, self::SECRET );
		$request = $this->make_request( $body, $stale, $sig );

		$result = Ashbi_Auth::verify_signature( $request );
		$this->assertInstanceOf( WP_Error::class, $result );
		$this->assertSame( 'ashbi_replay', $result->get_error_code() );
	}

	/**
	 * Exact packet replay within the window must be rejected after the first
	 * successful verify (signature+timestamp single-use).
	 */
	public function test_replayed_signature_within_window_is_rejected(): void {
		$body      = wp_json_encode( [ 'siteUrl' => 'https://example.com', 'action' => 'health' ] );
		$timestamp = (string) time();
		$sig       = hash_hmac( 'sha256', $timestamp . $body, self::SECRET );
		$request   = $this->make_request( $body, $timestamp, $sig );

		$this->assertTrue( Ashbi_Auth::verify_signature( $request ) );

		$replay = Ashbi_Auth::verify_signature( $request );
		$this->assertInstanceOf( WP_Error::class, $replay );
		$this->assertSame( 'ashbi_replay', $replay->get_error_code() );
	}

	public function test_non_numeric_timestamp_is_rejected(): void {
		$body    = wp_json_encode( [ 'foo' => 'bar' ] );
		$ts      = 'not-a-unix-time';
		$sig     = hash_hmac( 'sha256', $ts . $body, self::SECRET );
		$request = $this->make_request( $body, $ts, $sig );

		$result = Ashbi_Auth::verify_signature( $request );
		$this->assertInstanceOf( WP_Error::class, $result );
		$this->assertSame( 'ashbi_invalid_timestamp', $result->get_error_code() );
	}

	/**
	 * Source-level guard: verify_signature must use hash_equals() for the
	 * signature comparison (constant-time). Catches a regression where
	 * someone "simplifies" the comparison.
	 */
	public function test_uses_hash_equals_for_signature(): void {
		$source = file_get_contents( dirname( __DIR__, 2 ) . '/includes/class-ashbi-auth.php' );
		$this->assertStringContainsString( 'hash_equals(', $source );
		$this->assertMatchesRegularExpression(
			'/hash_equals\s*\(\s*\$expected\s*,\s*\$received_sig\s*\)/',
			$source,
			'verify_signature must compare expected HMAC against the incoming signature with hash_equals()'
		);
	}
}