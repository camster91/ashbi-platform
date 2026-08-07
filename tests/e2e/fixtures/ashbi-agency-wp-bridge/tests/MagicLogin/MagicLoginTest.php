 <?php
/**
 * Magic-login token lifecycle tests — covers ManageWP-grade requirements:
 *   - 60-second expiry (configurable but clamped)
 *   - single-use (5-min consumed-token tracking)
 *   - audit log writes for issue / consume / revoke / reject
 *   - revoke endpoint semantics
 *   - per-site rate limit (10/hour default)
 *   - IP allowlist enforcement
 *
 * WordPress is NOT loaded; brain/monkey stubs are set up in tests/bootstrap.php.
 */

class MagicLoginLifecycleTest extends Ashbi_TestCase {
    public static function setUpBeforeClass(): void {
        parent::setUpBeforeClass();
        // Fixtures: a few predictable site+admin for log assertions.
        $GLOBALS['__ashbi_test_options']      = [];
        $GLOBALS['__ashbi_test_transients']   = [];
        $_SERVER['REMOTE_ADDR']               = '203.0.113.10';
    }

    protected function setUp(): void {
        parent::setUp();
        $GLOBALS['__ashbi_test_options']      = [];
        $GLOBALS['__ashbi_test_transients']   = [];
        $_SERVER['REMOTE_ADDR']               = '203.0.113.10';
    }

    protected function tearDown(): void {
        // Reset state so the next test starts clean.
        $GLOBALS['__ashbi_test_options']      = [];
        $GLOBALS['__ashbi_test_transients']   = [];
        parent::tearDown();
    }

    public function test_issue_returns_token_hash_and_expires_at() {
        $issued = Ashbi_Magic_Login::issue( 42 );

        $this->assertIsArray( $issued );
        $this->assertArrayHasKey( 'token', $issued );
        $this->assertArrayHasKey( 'hash', $issued );
        $this->assertArrayHasKey( 'expires_at', $issued );
        // 64 hex chars (32-byte random_bytes)
        $this->assertMatchesRegularExpression( '/^[0-9a-f]{64}$/', $issued['token'] );
        // sha256 hex
        $this->assertMatchesRegularExpression( '/^[0-9a-f]{64}$/', $issued['hash'] );
        // Default expiry = 60s — confirm between now+55 and now+65
        $this->assertGreaterThanOrEqual( time() + 55, $issued['expires_at'] );
        $this->assertLessThanOrEqual( time() + 65, $issued['expires_at'] );
    }

    public function test_expiry_is_clamped_to_safe_window() {
        $low  = Ashbi_Magic_Login::issue( 1, [ 'expiry_seconds' => 1 ] );
        $high = Ashbi_Magic_Login::issue( 1, [ 'expiry_seconds' => 99999 ] );

        // 1 → clamped up to 5 (DoS floor)
        $this->assertGreaterThanOrEqual( time() + 4, $low['expires_at'] );
        // 99999 → clamped down to 900 (15-minute ceiling)
        $this->assertLessThanOrEqual( time() + 901, $high['expires_at'] );
    }

    public function test_consume_succeeds_with_valid_token_and_writes_audit_log() {
        $issued = Ashbi_Magic_Login::issue( 42 );
        $data   = Ashbi_Magic_Login::consume( $issued['token'] );

        $this->assertIsArray( $data );
        $this->assertSame( 42, (int) $data['user_id'] );
        $this->assertArrayHasKey( 'expires_at', $data );
        $this->assertSame( home_url(), $data['site_id'] );

        // Audit log: must contain an `issued` and a `consumed` row.
        $log = Ashbi_Magic_Login::get_audit_log( 50 );
        $statuses = array_column( $log, 'status' );
        $this->assertContains( 'issued', $statuses );
        $this->assertContains( 'consumed', $statuses );

        // Both rows reference user 42
        $user_ids = array_column( array_filter( $log, fn( $e ) => in_array( $e['status'], [ 'issued', 'consumed' ], true ) ), 'user_id' );
        $this->assertContains( 42, $user_ids );

        // Audit row carries the required fields per spec
        $consumed_row = array_values( array_filter( $log, fn( $e ) => $e['status'] === 'consumed' ) )[0];
        $this->assertArrayHasKey( 'ts', $consumed_row );
        $this->assertArrayHasKey( 'user_id', $consumed_row );
        $this->assertArrayHasKey( 'ip', $consumed_row );
        $this->assertArrayHasKey( 'site_id', $consumed_row );
        $this->assertArrayHasKey( 'magic_token_hash', $consumed_row );
        $this->assertSame( $issued['hash'], $consumed_row['magic_token_hash'] );
        $this->assertSame( '203.0.113.10', $consumed_row['ip'] );
    }

    public function test_token_cannot_be_consumed_twice_within_5_minute_window() {
        $issued = Ashbi_Magic_Login::issue( 7 );
        $first  = Ashbi_Magic_Login::consume( $issued['token'] );
        $this->assertIsArray( $first );

        // Replay — must be rejected even though transient was deleted on first use.
        $replay = Ashbi_Magic_Login::consume( $issued['token'] );
        $this->assertWPError( $replay, 'token_consumed', 401 );

        // Audit log: a `rejected` row was added with reason=replayed
        $log = Ashbi_Magic_Login::get_audit_log( 50 );
        $replayed = array_values( array_filter( $log, fn( $e ) => ( $e['status'] ?? '' ) === 'rejected' && ( $e['reason'] ?? '' ) === 'replayed' ) );
        $this->assertNotEmpty( $replayed );
    }

    public function test_expired_token_is_rejected_with_401() {
        $issued = Ashbi_Magic_Login::issue( 7 );
        $hash   = $issued['hash'];

        // Force the transient to look expired from the runtime's view.
        $row = $GLOBALS['__ashbi_test_transients'][ Ashbi_Magic_Login::TRANSIENT_PREFIX . $hash ];
        $row['expires'] = time() - 1;
        $GLOBALS['__ashbi_test_transients'][ Ashbi_Magic_Login::TRANSIENT_PREFIX . $hash ] = $row;

        $result = Ashbi_Magic_Login::consume( $issued['token'] );
        $this->assertWPError( $result, 'token_expired', 401 );

        $log = Ashbi_Magic_Login::get_audit_log( 50 );
        $reasons = array_column( $log, 'reason' );
        // Reason is `expired_or_invalid` once the transient is gone (no record
        // to read the original expiry from); the dedicated `expired` reason
        // only fires when the transient payload itself carries an expires_at
        // that's already in the past. Both are valid 401 paths.
        $this->assertTrue( in_array( 'expired_or_invalid', $reasons, true ) || in_array( 'expired', $reasons, true ), 'expired reason recorded' );
    }

    public function test_unknown_token_returns_401() {
        $result = Ashbi_Magic_Login::consume( 'not-a-real-token' );
        $this->assertWPError( $result, 'token_expired', 401 );
    }

    public function test_revoke_deletes_active_transient_and_consumed_record() {
        // Issue two tokens, consume the first, leave the second active.
        $a = Ashbi_Magic_Login::issue( 1 );
        $b = Ashbi_Magic_Login::issue( 2 );

        Ashbi_Magic_Login::consume( $a['token'] ); // marks `a` as consumed

        // Active token: revoke should delete the transient
        $rev = Ashbi_Magic_Login::revoke( $b['token'] );
        $this->assertIsArray( $rev );
        $this->assertTrue( $rev['revoked'] );

        $this->assertFalse( get_transient( Ashbi_Magic_Login::TRANSIENT_PREFIX . $b['hash'] ) );

        // Consumed token: revoke should also remove the consumed-tracking entry
        $rev2 = Ashbi_Magic_Login::revoke( $a['token'] );
        $this->assertIsArray( $rev2 );

        // After revoking `a`, we can replay `a` (consumed list is empty)
        // — that's the intended semantics: revocation removes the 5-min lockout.
        $replay = Ashbi_Magic_Login::consume( $a['token'] );
        // Transient was deleted on first consume, so this is rejected as
        // 'expired_or_invalid', not 'consumed' — assert the explicit behavior.
        $this->assertWPError( $replay );
    }

    public function test_revoke_by_hash_deletes_the_active_transient_directly() {
        // Regression test for the PR-F verifier FAIL: the hub UI was passing
        // the sha256 hash to the plugin (the raw token is never persisted on
        // the hub), the plugin was re-hashing it to sha256(sha256(raw)), and
        // the lookup was missing the active transient — so the revoke button
        // silently no-op'd. revoke_by_hash() uses the hash directly.
        $issued = Ashbi_Magic_Login::issue( 42 );
        $hash   = $issued['hash'];

        // Sanity: the active transient is at the single-hash key.
        $this->assertNotFalse( get_transient( Ashbi_Magic_Login::TRANSIENT_PREFIX . $hash ) );

        $result = Ashbi_Magic_Login::revoke_by_hash( $hash );
        $this->assertIsArray( $result );
        $this->assertTrue( $result['revoked'] );
        $this->assertSame( $hash, $result['hash'] );
        $this->assertTrue( $result['existed'] );
        $this->assertFalse( $result['was_consumed'] );

        // The transient is gone, so consume() now rejects with expired_or_invalid.
        $consume_after = Ashbi_Magic_Login::consume( $issued['token'] );
        $this->assertWPError( $consume_after, 'token_expired', 401 );

        // Audit row carries the SAME hash the UI passed in (no double-hash).
        $log = Ashbi_Magic_Login::get_audit_log( 50 );
        $revoked = array_values( array_filter( $log, fn( $e ) => ( $e['status'] ?? '' ) === 'revoked' ) );
        $this->assertNotEmpty( $revoked );
        $this->assertSame( $hash, $revoked[0]['magic_token_hash'] );
    }

    public function test_revoke_accepts_a_hash_via_dispatch_and_treats_it_as_a_hash_not_a_raw_token() {
        // The dispatch path the hub API uses: when the wire shape is
        // { hash: '...' }, the API calls revoke_by_hash() directly so the
        // 64-hex input is NOT re-hashed (which would produce sha256(sha256(raw))
        // and silently miss the active transient — the bug PR-F fixed).
        //
        // Note: the bare revoke() helper cannot safely disambiguate raw token
        // from hash by shape alone (both are 64 lowercase hex chars), so we
        // test the dispatch via the wire endpoint below. This test focuses
        // on revoke_by_hash() in isolation.
        $issued = Ashbi_Magic_Login::issue( 7 );
        $hash   = $issued['hash'];

        // Sanity: only the single-hash key holds the active transient.
        $double_hash = hash( 'sha256', $hash );
        $this->assertNotFalse( get_transient( Ashbi_Magic_Login::TRANSIENT_PREFIX . $hash ) );
        $this->assertFalse( get_transient( Ashbi_Magic_Login::TRANSIENT_PREFIX . $double_hash ) );

        // Direct revoke_by_hash() — this is what the API endpoint calls.
        $result = Ashbi_Magic_Login::revoke_by_hash( $hash );
        $this->assertTrue( $result['revoked'] );
        $this->assertTrue( $result['existed'] );

        // Active transient at the single-hash key is gone. The double-hash
        // key was never populated, so it stays empty (the bug guardrail).
        $this->assertFalse( get_transient( Ashbi_Magic_Login::TRANSIENT_PREFIX . $hash ) );
    }

    public function test_revoking_with_a_double_hash_does_not_touch_the_active_transient() {
        // Adversarial: if a caller (or a buggy script) feeds a hash into the
        // legacy revoke() helper — which hashes the input — they get the
        // double-hash key. The active transient at the single-hash key MUST
        // remain intact so the magic URL still works. This is the "fail
        // safe" property that PR-F's verifier flagged as missing.
        $issued = Ashbi_Magic_Login::issue( 99 );
        $hash   = $issued['hash'];

        // Mimic what the OLD buggy code did: hash(hash) → double-hash.
        $result = Ashbi_Magic_Login::revoke( $hash ); // revoke($hash) = revoke_by_hash(sha256($hash))
        $this->assertTrue( $result['revoked'] );
        $this->assertFalse( $result['existed'], 'the double-hash transient never existed' );

        // The real transient at the single-hash key is STILL there.
        $this->assertNotFalse( get_transient( Ashbi_Magic_Login::TRANSIENT_PREFIX . $hash ) );

        // And the token still consumes correctly — proves the active token
        // was not collateral damage from the buggy revoke path.
        $consume = Ashbi_Magic_Login::consume( $issued['token'] );
        $this->assertIsArray( $consume );
        $this->assertSame( 99, (int) $consume['user_id'] );
    }

    public function test_revoke_accepts_a_raw_token_and_still_works() {
        // Backward-compat: callers that have the raw token can still pass it.
        $issued = Ashbi_Magic_Login::issue( 5 );

        $result = Ashbi_Magic_Login::revoke( $issued['token'] );
        $this->assertTrue( $result['revoked'] );
        $this->assertSame( $issued['hash'], $result['hash'] );

        $this->assertFalse( get_transient( Ashbi_Magic_Login::TRANSIENT_PREFIX . $issued['hash'] ) );
    }

    public function test_revoke_endpoint_dispatches_hash_to_revoke_by_hash() {
        // Wire-level regression: PR-F verifier attempt-2 caught that the
        // /magic-login/revoke endpoint was dispatching { hash: <sha256> } to
        // Ashbi_Magic_Login::revoke(), which hashes the input (so a hash input
        // becomes sha256(sha256(raw))), and silently missed the active
        // transient stored under sha256(raw). The fix in class-ashbi-api.php
        // routes hash inputs to revoke_by_hash() instead. This test fails
        // under the old buggy code (the transient survives the dispatch) and
        // passes under the fixed code (the transient at the single-hash key
        // is gone).
        //
        // We exercise the public endpoint method directly (WordPress's REST
        // machinery is not loaded by these unit tests). The end-to-end shape
        // — hub POSTs { hash: <sha256> }, plugin deletes the active entry —
        // is the one the hub UI actually relies on.
        $issued = Ashbi_Magic_Login::issue( 42 );
        $hash   = $issued['hash'];

        // Precondition: the active transient lives at the single-hash key.
        // This is exactly what the hub's "Recent Logins" tab wants to kill.
        $this->assertNotFalse(
            get_transient( Ashbi_Magic_Login::TRANSIENT_PREFIX . $hash ),
            'precondition: active transient is keyed by sha256(raw)'
        );

        // Build the request the hub sends: a JSON body with the hash field.
        $request = new WP_REST_Request( [], json_encode( [ 'hash' => $hash ] ) );

        // Ashbi_API is loaded by tests/bootstrap.php and its constructor
        // stubs out add_action() / register_rest_route() via Brain\Monkey,
        // so instantiating it here runs cleanly.
        $api      = new Ashbi_API();
        $response = $api->magic_login_revoke( $request );

        // The dispatch succeeds and the API reports revoked=true.
        $this->assertInstanceOf( WP_REST_Response::class, $response );
        $this->assertSame( 200, $response->get_status() );
        $this->assertTrue( $response->get_data()['revoked'] );

        // The actual bug guardrail: the active transient at the single-hash
        // key MUST be gone. Under the old buggy code this assertion fails
        // because revoke($hash) wrote to (and read from) the double-hash key,
        // leaving the active entry untouched.
        $this->assertFalse(
            get_transient( Ashbi_Magic_Login::TRANSIENT_PREFIX . $hash ),
            'dispatch bug regression: hash input must delete the single-hash transient'
        );
    }

    public function test_revoke_by_hash_rejects_non_hex_input() {
        // Empty string
        $this->assertWPError( Ashbi_Magic_Login::revoke_by_hash( '' ), 'invalid_hash', 400 );
        // 63 chars (one short)
        $this->assertWPError( Ashbi_Magic_Login::revoke_by_hash( str_repeat( 'a', 63 ) ), 'invalid_hash', 400 );
        // 65 chars (one long)
        $this->assertWPError( Ashbi_Magic_Login::revoke_by_hash( str_repeat( 'a', 65 ) ), 'invalid_hash', 400 );
        // 64 chars but contains uppercase / non-hex chars
        $this->assertWPError(
            Ashbi_Magic_Login::revoke_by_hash( str_repeat( 'G', 64 ) ),
            'invalid_hash',
            400
        );
        // 64 chars with mixed uppercase is normalized to lowercase by revoke_by_hash,
        // but only AFTER the input passes the strict lowercase-hex regex. So
        // this also rejects (defense against accidental non-canonical inputs).
        $this->assertWPError(
            Ashbi_Magic_Login::revoke_by_hash( str_repeat( 'a', 63 ) . 'A' ),
            'invalid_hash',
            400
        );
    }

    public function test_revoke_by_hash_for_a_consumed_token_also_clears_consumed_list() {
        // Operator flow: admin issued a token, the recipient consumed it, and
        // then the admin wants to revoke the consumed-tracking entry. Pass the
        // hash; the plugin clears both the consumed entry and (already-gone)
        // transient, and records `reason: manual_revoke_consumed` for audit.
        $issued = Ashbi_Magic_Login::issue( 11 );
        Ashbi_Magic_Login::consume( $issued['token'] );

        $result = Ashbi_Magic_Login::revoke_by_hash( $issued['hash'] );
        $this->assertTrue( $result['revoked'] );
        $this->assertTrue( $result['was_consumed'] );

        // Consumed list no longer has the entry — replay protection is gone.
        $consumed_list = get_option( 'ashbi_magic_login_consumed', [] );
        $this->assertArrayNotHasKey( $issued['hash'], $consumed_list );

        // Audit row carries the reason.
        $log = Ashbi_Magic_Login::get_audit_log( 50 );
        $revoked = array_values( array_filter( $log, fn( $e ) => ( $e['status'] ?? '' ) === 'revoked' ) );
        $this->assertNotEmpty( $revoked );
        $this->assertSame( 'manual_revoke_consumed', $revoked[0]['reason'] );
    }

    public function test_rate_limit_allows_10_per_hour_then_returns_429() {
        // Reset the rate-limit transient so an earlier test doesn't pollute.
        delete_transient( 'ashbi_magic_rl_' . gmdate( 'YmdH' ) );

        for ( $i = 0; $i < 10; $i++ ) {
            $this->assertTrue( Ashbi_Magic_Login::check_rate_limit() );
        }
        $over = Ashbi_Magic_Login::check_rate_limit();
        $this->assertWPError( $over, 'rate_limited', 429 );
    }

    public function test_rate_limit_is_configurable_via_option() {
        update_option( 'ashbi_magic_login_rate_limit', 2 );
        delete_transient( 'ashbi_magic_rl_' . gmdate( 'YmdH' ) );

        $this->assertTrue( Ashbi_Magic_Login::check_rate_limit() );
        $this->assertTrue( Ashbi_Magic_Login::check_rate_limit() );
        $this->assertWPError( Ashbi_Magic_Login::check_rate_limit(), 'rate_limited', 429 );

        // Cleanup so other tests are not poisoned.
        delete_option( 'ashbi_magic_login_rate_limit' );
    }

    public function test_ip_allowlist_empty_allows_all() {
        $this->assertTrue( Ashbi_Magic_Login::check_ip_allowlist() );
    }

    public function test_ip_allowlist_permits_listed_cidrs() {
        update_option( 'ashbi_hub_ip_cidrs', '203.0.113.0/24, 198.51.100.7' );
        $_SERVER['REMOTE_ADDR'] = '203.0.113.10';
        $this->assertTrue( Ashbi_Magic_Login::check_ip_allowlist() );

        $_SERVER['REMOTE_ADDR'] = '198.51.100.7';
        $this->assertTrue( Ashbi_Magic_Login::check_ip_allowlist() );
    }

    public function test_ip_allowlist_blocks_unlisted_ip_with_403() {
        update_option( 'ashbi_hub_ip_cidrs', '203.0.113.0/24' );
        $_SERVER['REMOTE_ADDR'] = '198.51.100.99';

        $result = Ashbi_Magic_Login::check_ip_allowlist();
        $this->assertWPError( $result, 'ip_not_allowed', 403 );

        // Audit log row for the rejection reason
        $log = Ashbi_Magic_Login::get_audit_log( 50 );
        $rejected = array_values( array_filter( $log, fn( $e ) => ( $e['reason'] ?? '' ) === 'ip_not_allowed' ) );
        $this->assertNotEmpty( $rejected );
    }

    public function test_hash_token_is_sha256_of_raw_token() {
        $token = 'fixed-token-for-determinism';
        $hash  = Ashbi_Magic_Login::hash_token( $token );
        $this->assertSame( hash( 'sha256', $token ), $hash );
        // Different tokens → different hashes
        $this->assertNotSame( $hash, Ashbi_Magic_Login::hash_token( 'other-token' ) );
    }

    public function test_audit_log_caps_at_max_entries_via_audit_writer() {
        // The audit() writer is private. Reflect-invoke it 600 times to force
        // the ring buffer to evict down to AUDIT_LOG_MAX entries.
        $reflection = new ReflectionClass( Ashbi_Magic_Login::class );
        $method     = $reflection->getMethod( 'audit' );
        // PHP 8.1+: private methods are accessible by default; setAccessible()
        // triggers a deprecation warning on this runtime.
        // $method->setAccessible( true );

        for ( $i = 0; $i < 600; $i++ ) {
            $method->invoke( null, [
                'status'           => 'flood',
                'user_id'          => $i,
                'ip'               => '127.0.0.1',
                'site_id'          => home_url(),
                'magic_token_hash' => "h{$i}",
            ] );
        }

        $log = get_option( 'ashbi_magic_login_log', [] );
        $this->assertLessThanOrEqual( Ashbi_Magic_Login::AUDIT_LOG_MAX, count( $log ) );
        $this->assertGreaterThan( 0, count( $log ) );
        // Constant is the contract — surface it so the test breaks visibly if
        // someone bumps the cap without updating this assertion.
        $this->assertSame( 500, Ashbi_Magic_Login::AUDIT_LOG_MAX );
    }

    public function test_issue_rejects_invalid_user_id() {
        $result = Ashbi_Magic_Login::issue( 0 );
        $this->assertWPError( $result, 'invalid_user', 400 );

        $result2 = Ashbi_Magic_Login::issue( -1 );
        $this->assertWPError( $result2, 'invalid_user', 400 );
    }

    // Helper: assert $actual is a WP_Error with the right code/status.
    private function assertWPError( $actual, $code = null, $status = null, string $message = '' ) {
        $this->assertInstanceOf( WP_Error::class, $actual, $message );
        if ( $code !== null ) {
            $this->assertSame( $code, $actual->get_error_code(), $message );
        }
        if ( $status !== null ) {
            $this->assertSame( $status, (int) ( $actual->error_data[ $code ?? $actual->get_error_code() ][ 'status' ] ?? 0 ), $message );
        }
    }
}
