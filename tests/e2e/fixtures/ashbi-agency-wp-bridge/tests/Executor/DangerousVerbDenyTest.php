<?php
/**
 * Tests for the per-subcommand second-token denylist added in the audit batch.
 *
 * Background: Ashbi_Executor::run_wp_cli() accepts any first-token from
 *   {plugin, theme, core, transient, cache, db, cron}, but `wp plugin install <slug>`
 *   would let the hub silently pull a plugin from WordPress.org without local review.
 * The new denylist blocks install/activate/deactivate/uninstall/delete/enable/disable
 * on plugin and theme, plus core download/install.
 *
 * These tests exercise only the rejection branch — the success branch calls
 * shell_exec() against the live `wp` binary which isn't available in unit tests.
 */
class DangerousVerbDenyTest extends Ashbi_TestCase {

    /**
     * @dataProvider deniedVerbs
     */
    public function test_dangerous_verb_is_denied( string $subcommand, string $verb ): void {
        if ( ! function_exists( 'Ashbi_Executor' ) ) {
            $this->markTestSkipped( 'Ashbi_Executor not loaded' );
        }

        $result = Ashbi_Executor::run_wp_cli( "{$subcommand} {$verb} some-target" );

        $this->assertFalse( $result['success'], "Expected `{$subcommand} {$verb}` to be denied" );
        $this->assertStringContainsString( 'denied for remote use', $result['output'] );
        $this->assertStringContainsString( $verb, $result['output'] );
    }

    public static function deniedVerbs(): array {
        return [
            'plugin install'    => [ 'plugin', 'install' ],
            'plugin activate'   => [ 'plugin', 'activate' ],
            'plugin deactivate' => [ 'plugin', 'deactivate' ],
            'plugin uninstall'  => [ 'plugin', 'uninstall' ],
            'plugin delete'     => [ 'plugin', 'delete' ],
            'plugin enable'     => [ 'plugin', 'enable' ],
            'plugin disable'    => [ 'plugin', 'disable' ],
            'plugin toggle'     => [ 'plugin', 'toggle' ],
            'theme install'     => [ 'theme', 'install' ],
            'theme activate'    => [ 'theme', 'activate' ],
            'theme uninstall'   => [ 'theme', 'uninstall' ],
            'theme delete'      => [ 'theme', 'delete' ],
            'theme enable'      => [ 'theme', 'enable' ],
            'theme disable'     => [ 'theme', 'disable' ],
            'core download'     => [ 'core', 'download' ],
            'core install'      => [ 'core', 'install' ],
        ];
    }

    /**
     * Allowed verbs must NOT trip the new denylist — they fall through to the
     * `shell_exec` branch which is what we want. We can't fully assert success
     * without a live `wp`, but we CAN assert the output message isn't a denial.
     */
    public function test_allowed_verb_is_not_denied(): void {
        if ( ! function_exists( 'Ashbi_Executor' ) ) {
            $this->markTestSkipped( 'Ashbi_Executor not loaded' );
        }

        // `plugin list` and `plugin update` are allowed.
        $result_list = Ashbi_Executor::run_wp_cli( 'plugin list' );
        $this->assertStringNotContainsString( 'denied for remote use', $result_list['output'] ?? '' );

        // `cache flush` is allowed (and useful for the bridge).
        $result_cache = Ashbi_Executor::run_wp_cli( 'cache flush' );
        $this->assertStringNotContainsString( 'denied for remote use', $result_cache['output'] ?? '' );

        // `cron event run` is allowed.
        $result_cron = Ashbi_Executor::run_wp_cli( 'cron event run all' );
        $this->assertStringNotContainsString( 'denied for remote use', $result_cron['output'] ?? '' );
    }
}