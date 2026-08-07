<?php
/**
 * PHPUnit bootstrap for Ashbi Agency WP Bridge.
 *
 * Sets up Brain\Monkey stubs for WordPress functions and defines the
 * minimum set of constants that the plugin code touches before any
 * production hook fires. We intentionally do NOT load WordPress — the
 * goal is unit-level isolation of the plugin's own classes.
 *
 * @package Ashbi_Agency_WP_Bridge
 */

if ( ! defined( 'ABSPATH' ) ) {
    define( 'ABSPATH', sys_get_temp_dir() . '/ashbi-test/' );
}
if ( ! defined( 'WP_CONTENT_DIR' ) ) {
    define( 'WP_CONTENT_DIR', sys_get_temp_dir() . '/ashbi-test/wp-content/' );
}
if ( ! defined( 'ASHBI_BRIDGE_VERSION' ) ) {
    define( 'ASHBI_BRIDGE_VERSION', '1.11.0' );
}

# WP auth salts — used by Ashbi_Backup key wrapping. Fake constants for tests.
foreach ( ['AUTH_KEY','SECURE_AUTH_KEY','LOGGED_IN_KEY','NONCE_KEY'] as $c ) {
    if ( ! defined( $c ) ) {
        define( $c, 'test-' . strtolower( $c ) . '-value' );
    }
}

if ( ! defined( 'ASHBI_BRIDGE_DIR' ) ) {
    define( 'ASHBI_BRIDGE_DIR', dirname( __DIR__ ) . '/' );
}

// WordPress global constants used by the plugin's database export
// (export_database calls $wpdb->get_row($sql, ARRAY_N) and
// $wpdb->get_results($sql, ARRAY_A)).
if ( ! defined( 'ARRAY_N' ) ) {
    define( 'ARRAY_N', 'ARRAY_N' );
}
if ( ! defined( 'ARRAY_A' ) ) {
    define( 'ARRAY_A', 'ARRAY_A' );
}

require_once dirname( __DIR__ ) . '/vendor/autoload.php';

// Load the class under test. Other classes are loaded lazily by autoloader
// (they are required from the main plugin file, which we intentionally
// don't bootstrap to avoid the WP hook wiring).
require_once dirname( __DIR__ ) . '/includes/class-ashbi-backup.php';

// Shared base test case for the smoke suite (smoke-test-suite branch).
// OffsiteBackupTest extends PHPUnit\Framework\TestCase directly so this
// load is harmless if the smoke suite's classes aren't present.
if ( file_exists( __DIR__ . '/TestCase.php' ) ) {
    require_once __DIR__ . '/TestCase.php';
}

// Stash an in-memory "options" store. Production reads/writes via
// get_option()/update_option(); brain/monkey Functions\when() lets us
// substitute them without standing up the WP option API.
$GLOBALS['__ashbi_test_options'] = [];

\Brain\Monkey\setUp();

// Stub WP option API against the in-memory store.
\Brain\Monkey\Functions\when( 'get_option' )->alias(
    function ( $key, $default = false ) {
        return array_key_exists( $key, $GLOBALS['__ashbi_test_options'] )
            ? $GLOBALS['__ashbi_test_options'][ $key ]
            : $default;
    }
);
\Brain\Monkey\Functions\when( 'update_option' )->alias(
    function ( $key, $value ) {
        $GLOBALS['__ashbi_test_options'][ $key ] = $value;
        return true;
    }
);
\Brain\Monkey\Functions\when( 'delete_option' )->alias(
    function ( $key ) {
        unset( $GLOBALS['__ashbi_test_options'][ $key ] );
        return true;
    }
);

// Common one-line stubs. Tests that need per-call behaviour for these
// (e.g. wp_remote_post) override them with Functions\expect(...).
\Brain\Monkey\Functions\stubs(
    [
        'home_url'                            => 'https://example.com',
        'current_time'                        => static function () {
            // current_time( 'mysql' ) — fall back to the second arg if given.
            $args = func_get_args();
            return $args[1] ?? '2026-01-01 00:00:00';
        },
        '__'                                  => static function () {
            $args = func_get_args();
            return $args[0] ?? '';
        },
        'wp_json_encode'                      => 'json_encode',
        'is_wp_error'                         => static function ( $thing ) {
            return $thing instanceof \WP_Error;
        },
        'wp_remote_retrieve_response_code'    => static function ( $response ) {
            if ( is_array( $response ) && isset( $response['response']['code'] ) ) {
                return (int) $response['response']['code'];
            }
            return 0;
        },
        'get_bloginfo'                        => '6.4.2',
        'wp_mkdir_p'                          => static function ( $dir ) {
            return is_dir( $dir ) ? true : mkdir( $dir, 0755, true );
        },
        'sanitize_file_name'                  => static function ( $name ) {
            return preg_replace( '/[^a-z0-9_\-]/i', '_', (string) $name );
        },
        'wp_schedule_event'                   => true,
        'wp_next_scheduled'                   => false,
    ]
);