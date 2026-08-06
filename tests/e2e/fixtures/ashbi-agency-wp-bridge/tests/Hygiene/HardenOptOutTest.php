<?php
/**
 * Tests for Ashbi_Hygiene::harden_comment_settings — v1.10.1 default + opt-out guard.
 *
 * Master v1.10.1 runs harden_comment_settings unconditionally. PR #21 adds
 * an `apply_filters('ashbi_hardening_enabled', ...)` check that allows
 * site admins to opt out. The opt-out behavior is verified via source-
 * level guards (skip until PR #21 lands).
 *
 * What is covered (current master behavior, all pass):
 *   - Default call (no opt-out set) updates comment_registration=1,
 *     close_comments_days_old=30, comment_moderation=1,
 *     default_ping_status=closed, default_pingback_flag=0
 *
 * What is guarded (post-PR #21):
 *   - When option ashbi_hardening_enabled=false OR filter returns false,
 *     method returns early WITHOUT updating options
 */
class HardenOptOutTest extends Ashbi_TestCase {
    /** @var ReflectionMethod|null */
    private $method;

    protected function setUp(): void {
        parent::setUp();
        $this->method = method_exists( 'Ashbi_Hygiene', 'harden_comment_settings' )
            ? $this->privateStaticMethod( 'Ashbi_Hygiene', 'harden_comment_settings' )
            : null;
    }

    private function run_harden(): void {
        if ( $this->method === null ) {
            $this->markTestSkipped( 'harden_comment_settings not found' );
        }
        $this->method->invoke( null );
    }

    public function test_default_call_updates_all_hardening_options(): void {
        $this->run_harden();

        $this->assertSame( '1', get_option( 'comment_registration' ) );
        $this->assertSame( '30', get_option( 'close_comments_days_old' ) );
        $this->assertSame( '1', get_option( 'comment_moderation' ) );
        $this->assertSame( 'closed', get_option( 'default_ping_status' ) );
        $this->assertSame( '0', get_option( 'default_pingback_flag' ) );
    }

    /**
     * Idempotency: running harden twice yields the same values. This guards
     * against a regression where running twice adds side effects.
     */
    public function test_default_call_is_idempotent(): void {
        $this->run_harden();
        $first = [
            'comment_registration'      => get_option( 'comment_registration' ),
            'close_comments_days_old'    => get_option( 'close_comments_days_old' ),
            'comment_moderation'         => get_option( 'comment_moderation' ),
            'default_ping_status'        => get_option( 'default_ping_status' ),
            'default_pingback_flag'      => get_option( 'default_pingback_flag' ),
        ];

        $this->run_harden();
        $this->assertSame( $first['comment_registration'],   get_option( 'comment_registration' ) );
        $this->assertSame( $first['close_comments_days_old'], get_option( 'close_comments_days_old' ) );
        $this->assertSame( $first['comment_moderation'],      get_option( 'comment_moderation' ) );
        $this->assertSame( $first['default_ping_status'],     get_option( 'default_ping_status' ) );
        $this->assertSame( $first['default_pingback_flag'],   get_option( 'default_pingback_flag' ) );
    }

    /**
     * Source-level guard: PR #21 wires apply_filters('ashbi_hardening_enabled', ...)
     * at the top of harden_comment_settings, with default true via get_option.
     * Until PR #21 lands, these strings don't appear in source.
     */
    public function test_opt_out_via_option_wired_after_pr21(): void {
        $source = file_get_contents( __DIR__ . '/../../includes/class-ashbi-hygiene.php' );

        if ( strpos( $source, "apply_filters( 'ashbi_hardening_enabled'" ) === false ) {
            $this->markTestSkipped( 'harden_comment_settings does not yet honor ashbi_hardening_enabled (PR #21 not merged)' );
        }
        $this->assertStringContainsString( "apply_filters( 'ashbi_hardening_enabled'", $source );
        // Default for the option must be `true` (otherwise hardening would
        // silently skip when the option is unset, hiding the bug).
        $this->assertStringContainsString( "get_option( 'ashbi_hardening_enabled', true )", $source );
    }
}