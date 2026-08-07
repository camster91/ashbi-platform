<?php
/**
 * Tests for Ashbi_API::option_get / option_set — v1.10.1 blocklist.
 *
 * Tests the EXISTING v1.10.1 blocklist (the inline arrays in class-ashbi-api.php).
 * PR #19 expands the blocklist to include wp_user_roles / wordpress_api_key /
 * any ashbi_* / any wp_* prefix — those tests live in PR #19 itself; once that
 * PR lands, the matching assertions can be added here without touching the
 * production code.
 *
 * What's covered (current master behavior):
 *   - ashbi_api_key, ashbi_secret_key, siteurl, home, db_password, auth_*,
 *     secure_auth_key, logged_in_*, nonce_*, *_salt all blocked on GET/SET
 *   - admin_email, users_can_register, default_role additionally blocked on SET
 *   - blogname allowed (sanity check)
 *   - missing name → 400 missing_name
 *   - missing value on set → 400 missing_value
 *   - case-insensitive match (sanitize_key lowercases; in_array on lowercase list)
 */
class OptionBlocklistTest extends Ashbi_TestCase {
    /** @var Ashbi_API */
    private $api;

    protected function setUp(): void {
        parent::setUp();
        $this->api = new Ashbi_API();
    }

    /**
     * @dataProvider blockedOnGetProvider
     */
    public function test_option_get_blocks_sensitive( string $name ): void {
        $request = $this->fake_request( [ 'name' => $name ] );
        $result  = $this->api->option_get( $request );

        $this->assertInstanceOf( WP_Error::class, $result, "expected {$name} to be blocked on /option/get" );
        $this->assertSame( 'blocked', $result->get_error_code() );
        $this->assertSame( 403, $result->error_data['blocked']['status'] ?? null );
    }

    /**
     * @dataProvider blockedOnSetProvider
     */
    public function test_option_set_blocks_sensitive( string $name ): void {
        $request = $this->fake_request( [ 'name' => $name, 'value' => 'attacker' ] );
        $result  = $this->api->option_set( $request );

        $this->assertInstanceOf( WP_Error::class, $result, "expected {$name} to be blocked on /option/set" );
        $this->assertSame( 'blocked', $result->get_error_code() );
        $this->assertSame( 403, $result->error_data['blocked']['status'] ?? null );
    }

    public function blockedOnGetProvider(): array {
        // The v1.10.1 read blocklist per class-ashbi-api.php:244.
        return [
            'plugin_api_key'    => [ 'ashbi_api_key' ],
            'plugin_secret_key' => [ 'ashbi_secret_key' ],
            'siteurl'           => [ 'siteurl' ],
            'home'              => [ 'home' ],
            'db_password'       => [ 'db_password' ],
            'auth_key'          => [ 'auth_key' ],
            'secure_auth_key'   => [ 'secure_auth_key' ],
            'logged_in_key'     => [ 'logged_in_key' ],
            'nonce_key'         => [ 'nonce_key' ],
            'auth_salt'         => [ 'auth_salt' ],
            'secure_auth_salt'  => [ 'secure_auth_salt' ],
            'logged_in_salt'    => [ 'logged_in_salt' ],
            'nonce_salt'        => [ 'nonce_salt' ],
        ];
    }

    public function blockedOnSetProvider(): array {
        // The v1.10.1 write blocklist per class-ashbi-api.php:254 — superset of
        // the read blocklist plus admin_email / users_can_register / default_role.
        // Production audit also blocks active_plugins / theme switchers / cron.
        return [
            'plugin_api_key'      => [ 'ashbi_api_key' ],
            'plugin_secret_key'   => [ 'ashbi_secret_key' ],
            'siteurl'             => [ 'siteurl' ],
            'home'                => [ 'home' ],
            'admin_email'         => [ 'admin_email' ],
            'users_can_register'  => [ 'users_can_register' ],
            'default_role'        => [ 'default_role' ],
            'db_password'         => [ 'db_password' ],
            'auth_key'            => [ 'auth_key' ],
            'nonce_salt'          => [ 'nonce_salt' ],
            'active_plugins'      => [ 'active_plugins' ],
            'template'            => [ 'template' ],
            'stylesheet'          => [ 'stylesheet' ],
            'cron'                => [ 'cron' ],
            'akismet_api_key'     => [ 'akismet_api_key' ],
        ];
    }

    public function test_option_get_allows_blogname(): void {
        update_option( 'blogname', 'My Test Site' );
        $request = $this->fake_request( [ 'name' => 'blogname' ] );
        $result  = $this->api->option_get( $request );

        $this->assertInstanceOf( WP_REST_Response::class, $result );
        $this->assertSame( 200, $result->status );
        $this->assertSame( 'blogname', $result->data['name'] );
        $this->assertSame( 'My Test Site', $result->data['value'] );
    }

    public function test_option_set_allows_blogname(): void {
        $request = $this->fake_request( [ 'name' => 'blogname', 'value' => 'New Site Name' ] );
        $result  = $this->api->option_set( $request );

        $this->assertInstanceOf( WP_REST_Response::class, $result );
        $this->assertSame( 200, $result->status );
        $this->assertSame( 'New Site Name', get_option( 'blogname' ) );
    }

    public function test_option_get_requires_name(): void {
        $result = $this->api->option_get( $this->fake_request( [] ) );
        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'missing_name', $result->get_error_code() );
        $this->assertSame( 400, $result->error_data['missing_name']['status'] ?? null );
    }

    public function test_option_set_requires_name(): void {
        $result = $this->api->option_set( $this->fake_request( [ 'value' => 'x' ] ) );
        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'missing_name', $result->get_error_code() );
    }

    public function test_option_set_requires_value(): void {
        $result = $this->api->option_set( $this->fake_request( [ 'name' => 'blogname' ] ) );
        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'missing_value', $result->get_error_code() );
        $this->assertSame( 400, $result->error_data['missing_value']['status'] ?? null );
    }

    /**
     * Case-insensitive matching is implemented by sanitize_key() (lowercases)
     * plus an in_array lookup against an already-lowercase list. Sending
     * ASHBI_API_KEY normalizes to ashbi_api_key, which is in the list.
     */
    public function test_blocked_match_is_case_insensitive(): void {
        $result = $this->api->option_get( $this->fake_request( [ 'name' => 'ASHBI_API_KEY' ] ) );
        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'blocked', $result->get_error_code() );
    }
}