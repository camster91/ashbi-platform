<?php
/**
 * Shared base test case for the smoke suite.
 *
 * Offsite-backup's bootstrap already installs the basic Brain\Monkey stubs
 * (get_option / update_option / delete_option + a handful of static stubs)
 * and defines ABSPATH + WP_CONTENT_DIR. We do NOT call Brain\Monkey\setUp()
 * here — that would wipe offsite-backup's stub registrations.
 *
 * This base class:
 *   - Defines the WP_Error / WP_REST_* / WP_User classes our tests need.
 *   - Loads the additional plugin class files offsite-backup doesn't load
 *     (auth, api, executor, hours, updater, etc.).
 *   - Installs the EXTRA Brain\Monkey stubs our tests need on top of the
 *     base set: current_time with clock override, apply_filters with
 *     fixed-return map, wp_remote_get with response queue, get_users /
 *     get_userdata with fixture tables, wp_remote_post with capture log,
 *     download_url with temp-file fixture, plus assorted static stubs.
 *   - Provides the per-test sandbox dir + GLOBALS reset.
 *
 * Tests that need per-call overrides use Brain\Monkey\Functions\expect() in
 * their own setUp() AFTER calling parent::setUp().
 *
 * @package Ashbi_Agency_WP_Bridge
 */

use Brain\Monkey;
use Brain\Monkey\Functions;

abstract class Ashbi_TestCase extends PHPUnit\Framework\TestCase {
    /** @var string Temp directory scoped to this test, cleaned up on tearDown */
    protected $tmp_dir;

    protected function setUp(): void {
        parent::setUp();

        // Reset every backing store so tests don't bleed state.
        $GLOBALS['__ashbi_test_options']          = [];
        $GLOBALS['__ashbi_test_transients']       = [];
        $GLOBALS['__ashbi_test_remote_log']       = [];
        $GLOBALS['__ashbi_test_remote_responses'] = [];
        $GLOBALS['__ashbi_test_remote_response']  = null;
        $GLOBALS['__ashbi_test_mail_log']         = [];
        $GLOBALS['__ashbi_test_filter_results']   = [];
        		$GLOBALS['__ashbi_test_filters']         = [];
        		$GLOBALS['__ashbi_test_now']              = null;
        $GLOBALS['__ashbi_test_userdata_table']   = [];
        $GLOBALS['__ashbi_test_download_body']    = 'downloaded body';

        // Per-test sandbox directory.
        $this->tmp_dir = sys_get_temp_dir() . '/ashbi-test-' . uniqid( '', true );
        mkdir( $this->tmp_dir, 0700, true );
        // Plugin's expected dirs so write paths don't emit warnings.
        @mkdir( WP_CONTENT_DIR . '/ashbi-backups', 0755, true );
        @mkdir( WP_CONTENT_DIR . '/uploads/ashbi_agency', 0755, true );

        // Re-install the BASE Brain\Monkey stubs that offsite-backup's
        // bootstrap installs at startup. We do NOT call Brain\Monkey\setUp()
        // here because that wipes the base stubs (they're installed once
        // at bootstrap, not per-test). Instead we re-register them
        // ourselves so this test starts with a complete stub set even if
        // a previous test ran Monkey\tearDown() in its own cleanup.
        $this->install_base_stubs();
        $this->install_extra_stubs();
    }

    protected function tearDown(): void {
        // Tear down Brain\Monkey to undo Patchwork's function overrides so
        // the next test starts with a clean slate (whether it's another
        // smoke test or an offsite-backup test). OffsiteBackupTest re-registers
        // its base stubs in its own setUp() so they survive this teardown.
        Monkey\tearDown();
        if ( is_dir( $this->tmp_dir ) ) {
            $this->rrmdir( $this->tmp_dir );
        }
        $GLOBALS['__ashbi_test_now'] = null;
        parent::tearDown();
    }

    /**
     * Re-install the BASE Brain\Monkey stubs that offsite-backup's
     * bootstrap installs at startup. Idempotent — safe to call after
     * another test's Monkey\tearDown() has wiped the state. Mirrors the
     * registrations in feat/offsite-backup's tests/bootstrap.php.
     */
    protected function install_base_stubs(): void {
        Functions\when( 'get_option' )->alias(
            function ( $key, $default = false ) {
                return array_key_exists( $key, $GLOBALS['__ashbi_test_options'] )
                    ? $GLOBALS['__ashbi_test_options'][ $key ]
                    : $default;
            }
        );
        Functions\when( 'update_option' )->alias(
            function ( $key, $value ) {
                $GLOBALS['__ashbi_test_options'][ $key ] = $value;
                return true;
            }
        );
        Functions\when( 'delete_option' )->alias(
            function ( $key ) {
                unset( $GLOBALS['__ashbi_test_options'][ $key ] );
                return true;
            }
        );
        Functions\stubs(
            [
                'home_url'                            => 'https://example.com',
                'current_time'                        => static function () {
                    $args = func_get_args();
                    return $args[1] ?? '2026-01-01 00:00:00';
                },
                '__'                                  => static function () {
                    $args = func_get_args();
                    return $args[0] ?? '';
                },
                'wp_json_encode'                      => 'json_encode',
                'wp_unslash'                          => static function ( $value ) { return is_string( $value ) ? stripslashes( $value ) : $value; },
                'is_wp_error'                         => static function ( $thing ) {
                    return $thing instanceof \WP_Error;
                },
                'wp_remote_retrieve_response_code'    => static function ( $response ) {
                    if ( is_array( $response ) && isset( $response['response']['code'] ) ) {
                        return (int) $response['response']['code'];
                    }
                    return 0;
                },
                'get_bloginfo'                        => static function ( $key = '' ) {
                    $info = [ 'name' => 'Test Site', 'version' => '6.4', 'url' => 'https://example.com' ];
                    return $info[ $key ] ?? '';
                },
                'wp_mkdir_p'                          => static function ( $dir ) {
                    return is_dir( $dir ) ? true : @mkdir( $dir, 0755, true );
                },
                'sanitize_file_name'                  => static function ( $name ) {
                    return preg_replace( '/[^a-z0-9._\-]/i', '_', (string) $name );
                },
                'wp_schedule_event'                   => true,
                'wp_next_scheduled'                   => false,
            ]
        );
    }

    /**
     * Install the EXTRA Brain\Monkey stubs the smoke suite needs on top
     * of the base set. Called from setUp() AFTER install_base_stubs().
     */
    protected function install_extra_stubs(): void {
        // -- current_time with overridable clock via $GLOBALS['__ashbi_test_now'] --
        Functions\when( 'current_time' )->alias(
            function ( $type = 'mysql' ) {
                $now = $GLOBALS['__ashbi_test_now'] ?? time();
                switch ( $type ) {
                    case 'timestamp': return $now;
                    case 'Y-m-d':     return gmdate( 'Y-m-d', $now );
                    case 'Ymd_His':   return gmdate( 'Ymd_His', $now );
                    default:          return gmdate( 'Y-m-d H:i:s', $now );
                }
            }
        );

        // -- apply_filters with optional stub results --
        // Tests set $GLOBALS['__ashbi_test_filter_results']['tag'] = $fixedReturn
        // to force a filter outcome (e.g. ashbi_hardening_enabled = false).
        Functions\when( 'apply_filters' )->alias(
            function ( $tag, $value ) {
                if ( array_key_exists( $tag, $GLOBALS['__ashbi_test_filter_results'] ) ) {
                    return $GLOBALS['__ashbi_test_filter_results'][ $tag ];
                }
                // Honor callbacks registered via add_filter() — applied in order.
                if ( isset( $GLOBALS['__ashbi_test_filters'][ $tag ] ) ) {
                    foreach ( $GLOBALS['__ashbi_test_filters'][ $tag ] as $callback ) {
                        $value = $callback( $value );
                    }
                }
                return $value;
            }
        );
        Functions\when( 'add_filter' )->alias(
            function ( $tag, $callback, $priority = 10, $accepted_args = 1 ) {
                $GLOBALS['__ashbi_test_filters'][ $tag ][] = $callback;
                return true;
            }
        );
        Functions\when( 'remove_filter' )->alias(
            function ( $tag, $callback, $priority = 10 ) {
                if ( ! isset( $GLOBALS['__ashbi_test_filters'][ $tag ] ) ) return false;
                $GLOBALS['__ashbi_test_filters'][ $tag ] = array_values(
                    array_filter(
                        $GLOBALS['__ashbi_test_filters'][ $tag ],
                        function ( $c ) use ( $callback ) { return $c !== $callback; }
                    )
                );
                return true;
            }
        );

        // -- get_users / get_userdata (with optional fixture table) --
        Functions\when( 'get_users' )->alias(
            function ( $args = [] ) { return []; }
        );
        Functions\when( 'get_userdata' )->alias(
            function ( $id ) {
                $id = (int) $id;
                if ( isset( $GLOBALS['__ashbi_test_userdata_table'][ $id ] ) ) {
                    $u = $GLOBALS['__ashbi_test_userdata_table'][ $id ];
                    return new \WP_User( $u['ID'], $u['user_login'], $u['roles'] ?? [] );
                }
                return false;
            }
        );

        // -- wp_remote_post (capture-only; tests override with Functions\expect()) --
        Functions\when( 'wp_remote_post' )->alias(
            function ( $url, $args = [] ) {
                $GLOBALS['__ashbi_test_remote_log'][] = [
                    'method' => 'POST', 'url' => $url, 'args' => $args,
                ];
                return [ 'response' => [ 'code' => 200 ], 'body' => '{"ok":true}' ];
            }
        );

        // -- wp_remote_get with response queue + default 200 OK --
        Functions\when( 'wp_remote_get' )->alias(
            function ( $url, $args = [] ) {
                $GLOBALS['__ashbi_test_remote_log'][] = [
                    'method' => 'GET', 'url' => $url, 'args' => $args,
                ];
                if ( ! empty( $GLOBALS['__ashbi_test_remote_responses'] ) ) {
                    return array_shift( $GLOBALS['__ashbi_test_remote_responses'] );
                }
                if ( isset( $GLOBALS['__ashbi_test_remote_response'] ) ) {
                    $r = $GLOBALS['__ashbi_test_remote_response'];
                    unset( $GLOBALS['__ashbi_test_remote_response'] );
                    return $r;
                }
                return [ 'response' => [ 'code' => 200 ], 'body' => '' ];
            }
        );

        // -- download_url (returns a temp file path with fixture body) --
        Functions\when( 'download_url' )->alias(
            function ( $url ) {
                $body = $GLOBALS['__ashbi_test_download_body'] ?? 'downloaded body';
                $tmp  = tempnam( sys_get_temp_dir(), 'ashbi-dl-' );
                file_put_contents( $tmp, $body );
                return $tmp;
            }
        );

        // -- Transient API (in-memory store with optional expiry) --
        Functions\when( 'get_transient' )->alias(
            function ( $key ) {
                $row = $GLOBALS['__ashbi_test_transients'][ $key ] ?? null;
                if ( ! is_array( $row ) ) return false;
                if ( isset( $row['expires'] ) && $row['expires'] > 0 && $row['expires'] < time() ) {
                    unset( $GLOBALS['__ashbi_test_transients'][ $key ] );
                    return false;
                }
                return $row['value'];
            }
        );
        Functions\when( 'set_transient' )->alias(
            function ( $key, $value, $expiration = 0 ) {
                $GLOBALS['__ashbi_test_transients'][ $key ] = [
                    'value'   => $value,
                    'expires' => $expiration > 0 ? time() + (int) $expiration : 0,
                ];
                return true;
            }
        );
        Functions\when( 'delete_transient' )->alias(
            function ( $key ) {
                if ( ! isset( $GLOBALS['__ashbi_test_transients'][ $key ] ) ) return false;
                unset( $GLOBALS['__ashbi_test_transients'][ $key ] );
                return true;
            }
        );

        // -- wp_mail (capture-only) --
        Functions\when( 'wp_mail' )->alias(
            function ( $to, $subject, $message ) {
                $GLOBALS['__ashbi_test_mail_log'][] = compact( 'to', 'subject', 'message' );
                return true;
            }
        );

        // -- absint --
        Functions\when( 'absint' )->alias(
            function ( $v ) { return abs( (int) $v ); }
        );

        // -- Static value stubs (not provided by offsite-backup's bootstrap) --
        Functions\stubs( [
            'wp_remote_retrieve_body'   => static function ( $response ) {
                return is_array( $response ) ? ( $response['body'] ?? '' ) : '';
            },
            'wp_remote_retrieve_header' => static function () { return ''; },
            'plugin_basename'           => static function ( $file ) {
                return basename( dirname( $file ) ) . '/' . basename( $file );
            },
            'plugin_dir_path'           => static function ( $file ) {
                return rtrim( dirname( $file ), '/' ) . '/';
            },
            'sanitize_key'              => static function ( $s ) {
                return is_string( $s ) ? strtolower( preg_replace( '/[^a-zA-Z0-9_\-]/', '', $s ) ) : '';
            },
            'sanitize_text_field'       => static function ( $s ) {
                return is_string( $s ) ? trim( preg_replace( '/[\r\n\t\0\x0B]/', '', $s ) ) : '';
            },
            'wp_generate_uuid_v4'       => static function () {
                $d = random_bytes( 16 );
                $d[6] = chr( ord( $d[6] ) & 0x0f | 0x40 );
                $d[8] = chr( ord( $d[8] ) & 0x3f | 0x80 );
                return vsprintf( '%s%s-%s-%s-%s-%s%s%s', str_split( bin2hex( $d ), 4 ) );
            },
            'admin_url'                 => static function ( $p = '' ) {
                return 'https://example.com/wp-admin/' . ltrim( $p, '/' );
            },
            'wp_kses_post'              => static function ( $d ) { return $d; },
            'esc_url'                   => static function ( $u ) { return $u; },
            'trailingslashit'           => static function ( $s ) { return rtrim( $s, '/' ) . '/'; },
            'wp_die'                    => static function ( $msg = '' ) {
                throw new \RuntimeException( 'wp_die: ' . $msg );
            },
            'wp_redirect'               => static function ( $u ) {
                throw new \RuntimeException( 'wp_redirect: ' . $u );
            },
            'wp_verify_nonce'           => static function ( $n, $a ) {
                return $n === 'valid-nonce';
            },
            'current_user_can'          => true,
            'wp_add_dashboard_widget'   => null,
            'wp_cache_flush'            => null,
            'wp_update_plugins'         => null,
            'wp_update_themes'          => null,
            'wp_version_check'          => null,
            'register_activation_hook'  => null,
            'register_deactivation_hook'=> null,
            'add_action'                => null,
            'register_rest_route'       => null,
            'wp_schedule_event'         => true,
            'wp_next_scheduled'         => false,
            'wp_clear_scheduled_hook'   => true,
            '__return_true'             => true,
            '__return_false'            => false,
            '__return_empty_array'      => [],
        ] );
    }

    /** Recursively remove a directory (test sandbox cleanup). */
    protected function rrmdir( string $dir ): void {
        if ( ! is_dir( $dir ) ) return;
        foreach ( scandir( $dir ) as $entry ) {
            if ( $entry === '.' || $entry === '..' ) continue;
            $p = $dir . '/' . $entry;
            if ( is_dir( $p ) ) {
                $this->rrmdir( $p );
            } else {
                @unlink( $p );
            }
        }
        @rmdir( $dir );
    }

    /** Build a fake WP_REST_Request from an associative array. */
    protected function fake_request( array $params, array $headers = [] ): WP_REST_Request {
        $body = wp_json_encode( $params );
        return new WP_REST_Request( $headers, $body, $params );
    }

    /** Reflection helper: get a private static method. */
    protected function privateStaticMethod( string $class, string $name ): \ReflectionMethod {
        $m = new \ReflectionMethod( $class, $name );
        @$m->setAccessible( true );
        return $m;
    }

    /** Reflection helper: get a private instance method. */
    protected function privateMethod( object $instance, string $name ): \ReflectionMethod {
        $m = new \ReflectionMethod( $instance, $name );
        @$m->setAccessible( true );
        return $m;
    }
}

// ---------------------------------------------------------------------------
// Constants used by the smoke suite that offsite-backup's bootstrap doesn't
// define. Define-only-if-unset guards keep this file safe to load multiple
// times and harmless when the constants are already defined.
// ---------------------------------------------------------------------------
if ( ! defined( 'ASHBI_BRIDGE_FILE' ) ) {
    define( 'ASHBI_BRIDGE_FILE', ABSPATH . 'ashbi-agency-wp-bridge.php' );
}
if ( ! defined( 'ASHBI_BRIDGE_DIR' ) ) {
    define( 'ASHBI_BRIDGE_DIR', dirname( __DIR__ ) . '/' );
}
if ( ! defined( 'ASHBI_REPLAY_WINDOW' ) ) {
    define( 'ASHBI_REPLAY_WINDOW', 300 );
}
if ( ! defined( 'ASHBI_RATE_LIMIT' ) ) {
    define( 'ASHBI_RATE_LIMIT', 10 );
}
if ( ! defined( 'ASHBI_RATE_WINDOW' ) ) {
    define( 'ASHBI_RATE_WINDOW', 60 );
}
if ( ! defined( 'MINUTE_IN_SECONDS' ) ) { define( 'MINUTE_IN_SECONDS', 60 ); }
if ( ! defined( 'HOUR_IN_SECONDS' ) )   { define( 'HOUR_IN_SECONDS', 3600 ); }
if ( ! defined( 'DAY_IN_SECONDS' ) )    { define( 'DAY_IN_SECONDS', 86400 ); }
if ( ! defined( 'WEEK_IN_SECONDS' ) )   { define( 'WEEK_IN_SECONDS', 604800 ); }

// ---------------------------------------------------------------------------
// Minimal WP classes — defined in the same file so the TestCase.php can be
// loaded standalone (some tests load it before the WP class defs in the
// main bootstrap are reached). Both block once — class_exists guards avoid
// redeclaration errors when both bootstrap.php and TestCase.php load.
// ---------------------------------------------------------------------------
if ( ! class_exists( 'WP_Error' ) ) {
    class WP_Error {
        public $errors = [];
        public $error_data = [];
        public function __construct( $code = '', $message = '', $data = null ) {
            if ( '' !== $code ) {
                $this->errors[ $code ][] = $message;
                if ( null !== $data ) {
                    $this->error_data[ $code ] = $data;
                }
            }
        }
        public function get_error_code()    { return key( $this->errors ) ?: ''; }
        public function get_error_message() { $c = key( $this->errors ); return $c ? ( $this->errors[ $c ][0] ?? '' ) : ''; }
    }
}

if ( ! class_exists( 'WP_REST_Response' ) ) {
    class WP_REST_Response {
        public $data;
        public $status;
        public $headers = [];
        public function __construct( $data = null, $status = 200 ) {
            $this->data   = $data;
            $this->status = (int) $status;
        }
        public function header( $key, $value ) { $this->headers[ $key ] = $value; }
        // Test-harness accessors — real WP_REST_Response has these too.
        public function get_status() { return $this->status; }
        public function get_data()   { return $this->data; }
    }
}

if ( ! class_exists( 'WP_REST_Request' ) ) {
    class WP_REST_Request {
        private $headers; private $body; private $json_params;
        public function __construct( $headers = [], $body = '', $json_params = [] ) {
            $this->headers = $headers; $this->body = $body; $this->json_params = $json_params;
        }
        public function get_header( $name ) {
            $needle = strtolower( $name );
            foreach ( $this->headers as $k => $v ) {
                if ( strtolower( $k ) === $needle ) return $v;
            }
            return null;
        }
        public function get_body() { return $this->body; }
        /**
         * Matches real WP_REST_Request behavior: lazy-decodes the body when
         * json_params wasn't explicitly set in the constructor. Real WP does
         * this on first call, then caches. We always re-decode (cheap, tests
         * are short-lived).
         */
        public function get_json_params() {
            if ( ! empty( $this->json_params ) ) return $this->json_params;
            $decoded = json_decode( $this->body, true );
            return is_array( $decoded ) ? $decoded : [];
        }
    }
}

if ( ! class_exists( 'WP_User' ) ) {
    class WP_User {
        public $ID; public $user_login; public $roles = [];
        public function __construct( $id = 0, $login = '', $roles = [] ) {
            $this->ID = (int) $id; $this->user_login = $login; $this->roles = (array) $roles;
        }
    }
}

// ---------------------------------------------------------------------------
// Load the additional plugin class files offsite-backup's bootstrap doesn't
// load (it only loads class-ashbi-backup.php). The smoke suite tests
// auth / api / executor / hours / hygiene / updater / etc.
// ---------------------------------------------------------------------------
$plugin_dir = realpath( __DIR__ . '/..' ) . '/includes';
require_once $plugin_dir . '/class-ashbi-settings.php';
require_once $plugin_dir . '/class-ashbi-auth.php';
require_once $plugin_dir . '/class-ashbi-api.php';
require_once $plugin_dir . '/class-ashbi-executor.php';
require_once $plugin_dir . '/class-ashbi-magic-login.php';
require_once $plugin_dir . '/class-ashbi-sso.php';
require_once $plugin_dir . '/class-ashbi-hygiene.php';
require_once $plugin_dir . '/class-ashbi-health.php';
require_once $plugin_dir . '/class-ashbi-hours.php';
require_once $plugin_dir . '/class-ashbi-updater.php';
require_once $plugin_dir . '/class-ashbi-logger.php';