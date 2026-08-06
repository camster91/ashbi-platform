<?php
/**
 * Tests for Ashbi_API::magic_login — PR #19 behavior.
 *
 * Post PR #19: empty user_id → 400 missing_user (not 404 no_user).
 * Requires explicit user_id, requires admin role, rate-limited.
 */
class MagicLoginTest extends Ashbi_TestCase {
    /** @var Ashbi_API */
    private $api;

    protected function setUp(): void {
        parent::setUp();
        $this->api = new Ashbi_API();
    }

    /**
     * PR #19 behavior: empty user_id → 400 missing_user. Master v1.10.1
     * had a fallback to find the first admin via get_users(), which
     * PR #19 removes (forces the caller to specify user_id explicitly).
     */
    public function test_empty_user_id_returns_missing_user(): void {
        $result = $this->api->magic_login( $this->fake_request( [] ) );

        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'missing_user', $result->get_error_code() );
        $this->assertSame( 400, $result->error_data['missing_user']['status'] ?? null );
    }

    /**
     * PR #19 behavior: non-admin user → 403 not_admin, regardless of
     * user_id being explicit. Magic-login is a privileged operation
     * and we never want to mint a login token for a low-privilege account.
     */
    public function test_non_admin_user_id_returns_not_admin(): void {
        // Pre-populate userdata stub with a non-admin user.
        $GLOBALS['__ashbi_test_userdata_table'][42] = [
            'ID'         => 42,
            'user_login' => 'editoruser',
            'roles'      => [ 'editor' ],
        ];

        $result = $this->api->magic_login( $this->fake_request( [ 'user_id' => 42 ] ) );

        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'not_admin', $result->get_error_code() );
        $this->assertSame( 403, $result->error_data['not_admin']['status'] ?? null );
    }

    public function test_unknown_user_id_returns_invalid_user(): void {
        $result = $this->api->magic_login( $this->fake_request( [ 'user_id' => 999 ] ) );

        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'invalid_user', $result->get_error_code() );
        $this->assertSame( 404, $result->error_data['invalid_user']['status'] ?? null );
    }

    /**
     * PR #19 wires check_rate_limit() into magic_login as the first line.
     */
    public function test_rate_limit_wired_after_pr19(): void {
        $source = file_get_contents( __DIR__ . '/../../includes/class-ashbi-api.php' );
        if ( strpos( $source, "function magic_login" ) === false ) {
            $this->markTestSkipped( 'magic_login not found' );
        }
        if ( ! preg_match( '/function\s+magic_login\s*\([^)]*\)\s*\{(.*?)\n\s*\}/s', $source, $m ) ) {
            $this->markTestSkipped( 'could not extract magic_login body' );
        }
        $body = $m[1];

        $this->assertStringContainsString( 'check_rate_limit(', $body, 'PR #19: magic_login must invoke check_rate_limit' );
    }
}