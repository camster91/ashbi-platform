<?php
/**
 * Unit + integration tests for Ashbi_Backup::push_to_remote() and its
 * integration into run_full_backup().
 *
 * @package Ashbi_Agency_WP_Bridge
 */

use PHPUnit\Framework\TestCase;
use Brain\Monkey;
use Brain\Monkey\Functions;

/**
 * Mockable stand-in for the global $wpdb used by export_database() inside
 * run_full_backup(). Implements the four methods the backup class touches.
 */
class AshbiTestWpdb {
    public $tables = [ 'wp_options', 'wp_posts' ];
    public $rows   = [];

    public function prepare( $query, ...$args ) {
        // Minimal sprintf stand-in for LIMIT/OFFSET placeholders in tests.
        if ( empty( $args ) ) {
            return $query;
        }
        $i = 0;
        return preg_replace_callback(
            '/%[dfs]/',
            static function () use ( &$i, $args ) {
                $val = $args[ $i ] ?? '';
                $i++;
                return (string) $val;
            },
            $query
        );
    }

    public function get_col( $sql ) {
        return $this->tables;
    }
    public function get_row( $sql, $output = null ) {
        return [ 'wp_options', 'CREATE TABLE `wp_options` (`option_id` int)' ];
    }
    public function get_results( $sql, $output = null ) {
        // Honor OFFSET so chunked export_database() terminates.
        if ( preg_match( '/OFFSET\s+(\d+)/i', (string) $sql, $m ) && (int) $m[1] > 0 ) {
            return [];
        }
        return $this->rows;
    }
    public function _real_escape( $v ) {
        return addslashes( (string) $v );
    }
}

class OffsiteBackupTest extends TestCase {

    /** @var string */
    private $tmp_dir;

    /** @var string */
    private $sql_file;

    /** @var string */
    private $zip_file;

    protected function setUp(): void {
        parent::setUp();
        Monkey\setUp();

        // Stash an in-memory options store. Production reads/writes
        // via get_option()/update_option(); brain/monkey aliases them
        // here so we don't need a real WP option API.
        $GLOBALS['__ashbi_test_options'] = [];

        // WP option API stubs — re-applied every test because
        // Monkey\setUp() resets all previous stubs.
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

        // Common one-line stubs. Tests that need per-call behaviour
        // for these (e.g. wp_remote_post) override them with
        // Functions\expect(...).
        Functions\stubs(
            [
                'home_url'                         => 'https://example.com',
                'wp_parse_url'                     => static function ( $url, $component = -1 ) {
                    return parse_url( $url, $component );
                },
                'current_time'                     => static function () {
                    // current_time( $type ) — return a deterministic
                    // value keyed on the requested format. The 'mysql'
                    // arg is what production calls for backup timestamps.
                    $args = func_get_args();
                    $type = $args[0] ?? 'mysql';
                    if ( $type === 'Ymd_His' ) {
                        return '20260101_000000';
                    }
                    return '2026-01-01 00:00:00';
                },
                '__'                               => static function () {
                    $args = func_get_args();
                    return $args[0] ?? '';
                },
                'wp_json_encode'                   => 'json_encode',
                'is_wp_error'                      => static function ( $thing ) {
                    return $thing instanceof \WP_Error;
                },
                'wp_remote_retrieve_response_code' => static function ( $response ) {
                    if ( is_array( $response ) && isset( $response['response']['code'] ) ) {
                        return (int) $response['response']['code'];
                    }
                    return 0;
                },
                'get_bloginfo'                     => '6.4.2',
                'wp_mkdir_p'                       => static function ( $dir ) {
                    return is_dir( $dir ) ? true : mkdir( $dir, 0755, true );
                },
                'sanitize_file_name'               => static function ( $name ) {
                    return preg_replace( '/[^a-z0-9_\-]/i', '_', (string) $name );
                },
                'wp_schedule_event'                => true,
                'wp_next_scheduled'                => false,
            ]
        );

        // Real on-disk fixtures for push_to_remote() (it calls
        // file_exists + file_get_contents on each path).
        $this->tmp_dir  = sys_get_temp_dir() . '/ashbi-test-' . uniqid();
        if ( ! is_dir( $this->tmp_dir ) ) {
            mkdir( $this->tmp_dir, 0755, true );
        }
        $this->sql_file = $this->tmp_dir . '/example_com_20260101_db.sql';
        $this->zip_file = $this->tmp_dir . '/example_com_20260101_files.zip';
        file_put_contents( $this->sql_file, "-- dump of wp_options\nINSERT INTO wp_options VALUES (1,'siteurl','https://example.com','yes');\n" );
        file_put_contents( $this->zip_file, "PK\x03\x04fake-zip-bytes" );

        // Make sure the BACKUP_DIR-shaped dir exists so export_database()
        // and the file_put_contents call inside run_full_backup() don't
        // blow up when integration tests exercise the full flow.
        if ( ! is_dir( Ashbi_Backup::BACKUP_DIR ) ) {
            @mkdir( Ashbi_Backup::BACKUP_DIR, 0755, true );
        }
    }

    protected function tearDown(): void {
        Monkey\tearDown();
        if ( is_dir( $this->tmp_dir ) ) {
            foreach ( glob( $this->tmp_dir . '/*' ) as $f ) {
                @unlink( $f );
            }
            @rmdir( $this->tmp_dir );
        }
        parent::tearDown();
    }

    /**
     * Helper: configure the off-site destination + config options.
     */
    private function set_destination( $destination, $config ) {
        $GLOBALS['__ashbi_test_options']['ashbi_backup_destination']    = $destination;
        $GLOBALS['__ashbi_test_options']['ashbi_backup_remote_config'] = wp_json_encode( $config );
    }

    /**
     * Required: 'webhook' destination with mocked wp_remote_post —
     * assert correct URL + multipart body.
     */
    public function test_push_to_remote_webhook_posts_correct_url_and_multipart_body() {
        $this->set_destination( 'webhook', [
            'webhookUrl' => 'https://hooks.example.com/ashbi-backup',
        ] );

        $captured = [];
        Functions\expect( 'wp_remote_post' )
            ->times( 2 )
            ->andReturnUsing( function ( $url, $args ) use ( &$captured ) {
                $captured[] = [ 'url' => $url, 'args' => $args ];
                return [ 'response' => [ 'code' => 200 ], 'body' => 'ok' ];
            } );

        $result = Ashbi_Backup::push_to_remote( [ $this->sql_file, $this->zip_file ] );

        // Return shape from the spec.
        $this->assertSame( 'ok', $result['status'] );
        $this->assertSame( 'https://hooks.example.com/ashbi-backup', $result['remote_url'] );
        $this->assertGreaterThan( 0, $result['bytes_sent'] );
        $this->assertArrayNotHasKey( 'error', $result );

        // Mocked call assertions — both files should have been sent.
        $this->assertCount( 2, $captured );
        $this->assertSame( 'https://hooks.example.com/ashbi-backup', $captured[0]['url'] );
        $this->assertSame( 'POST', $captured[0]['args']['method'] );

        // Multipart assertions: header has boundary, body has both the
        // file part and the expected scalar fields.
        $content_type = $captured[0]['args']['headers']['Content-Type'];
        $this->assertStringStartsWith( 'multipart/form-data; boundary=', $content_type );
        preg_match( '/boundary=(.+)$/', $content_type, $m );
        $boundary = $m[1];
        $body     = $captured[0]['args']['body'];

        $this->assertStringContainsString( '--' . $boundary, $body );
        $this->assertStringContainsString( 'Content-Disposition: form-data; name="file"; filename="example_com_20260101_db.sql"', $body );
        $this->assertStringContainsString( 'Content-Disposition: form-data; name="filename"', $body );
        $this->assertStringContainsString( 'example_com_20260101_db.sql', $body );
        $this->assertStringContainsString( 'Content-Disposition: form-data; name="siteUrl"', $body );
        $this->assertStringContainsString( 'https://example.com', $body );
        $this->assertStringContainsString( 'Content-Disposition: form-data; name="destination"', $body );
        $this->assertStringContainsString( 'webhook', $body );
        $this->assertStringContainsString( '--' . $boundary . '--', $body );
    }

    /**
     * Required: 'none' destination — no network call at all.
     */
    public function test_push_to_remote_none_makes_no_network_call() {
        $this->set_destination( 'none', [] );

        // Functions\expect() with never() — PHPUnit will fail the test
        // if either function is called.
        Functions\expect( 'wp_remote_post' )->never();
        Functions\expect( 'wp_remote_request' )->never();

        $result = Ashbi_Backup::push_to_remote( [ $this->sql_file ] );

        $this->assertSame( 'ok', $result['status'] );
        $this->assertSame( 0, $result['bytes_sent'] );
        $this->assertNull( $result['remote_url'] );
    }

    /**
     * Required: 's3' configured without valid endpoint — returns error
     * without crashing.
     */
    public function test_push_to_remote_s3_without_endpoint_returns_error() {
        $this->set_destination( 's3', [
            // No endpoint, no bucket, no accessKey.
            'region' => 'us-west-001',
        ] );

        Functions\expect( 'wp_remote_request' )->never();

        $result = Ashbi_Backup::push_to_remote( [ $this->sql_file ] );

        $this->assertSame( 'error', $result['status'] );
        $this->assertArrayHasKey( 'error', $result );
        $this->assertStringContainsString( 's3', strtolower( $result['error'] ) );
        $this->assertSame( 0, $result['bytes_sent'] );
        $this->assertNull( $result['remote_url'] );
    }

    /**
     * Sanity: 'b2' with the same shape returns error too (shared
     * push_s3_compat() code path).
     */
    public function test_push_to_remote_b2_without_endpoint_returns_error() {
        $this->set_destination( 'b2', [] );

        Functions\expect( 'wp_remote_request' )->never();

        $result = Ashbi_Backup::push_to_remote( [ $this->sql_file ] );

        $this->assertSame( 'error', $result['status'] );
        $this->assertStringContainsString( 'b2', strtolower( $result['error'] ) );
    }

    /**
     * Sanity: 'vps' returns error immediately, no network call
     * (TODO for SFTP). Verifies the deferred path is wired without
     * shipping the implementation.
     */
    public function test_push_to_remote_vps_returns_error_todo() {
        $this->set_destination( 'vps', [] );

        Functions\expect( 'wp_remote_post' )->never();
        Functions\expect( 'wp_remote_request' )->never();

        $result = Ashbi_Backup::push_to_remote( [ $this->sql_file ] );

        $this->assertSame( 'error', $result['status'] );
        $this->assertStringContainsString( 'VPS/SFTP', $result['error'] );
    }

    /**
     * Sanity: webhook with no URL configured returns error.
     */
    public function test_push_to_remote_webhook_without_url_returns_error() {
        $this->set_destination( 'webhook', [] );

        Functions\expect( 'wp_remote_post' )->never();

        $result = Ashbi_Backup::push_to_remote( [ $this->sql_file ] );

        $this->assertSame( 'error', $result['status'] );
        $this->assertStringContainsString( 'Webhook URL', $result['error'] );
    }

    /**
     * Sanity: webhook receiver returns non-2xx → error reported but
     * never a crash.
     */
    public function test_push_to_remote_webhook_non_2xx_returns_error() {
        $this->set_destination( 'webhook', [
            'webhookUrl' => 'https://hooks.example.com/ashbi-backup',
        ] );

        Functions\expect( 'wp_remote_post' )
            ->once()
            ->andReturn( [ 'response' => [ 'code' => 500 ], 'body' => 'oops' ] );

        $result = Ashbi_Backup::push_to_remote( [ $this->sql_file ] );

        $this->assertSame( 'error', $result['status'] );
        $this->assertStringContainsString( '500', $result['error'] );
    }

    /**
     * Sanity: missing local file → error in the loop, but the overall
     * call still returns a structured result.
     */
    public function test_push_to_remote_missing_file_returns_error_with_no_crash() {
        $this->set_destination( 'webhook', [
            'webhookUrl' => 'https://hooks.example.com/ashbi-backup',
        ] );

        Functions\expect( 'wp_remote_post' )->never();

        $result = Ashbi_Backup::push_to_remote( [ '/tmp/does-not-exist-' . uniqid() . '.sql' ] );

        $this->assertSame( 'error', $result['status'] );
        $this->assertStringContainsString( 'File missing', $result['error'] );
    }

    /**
     * Sanity: S3 push with accessKey only (legacy Bearer) + 200 → ok.
     */
    public function test_push_to_remote_s3_bearer_fallback_succeeds() {
        $this->set_destination( 's3', [
            'endpoint'  => 'https://s3.us-west-001.backblazeb2.com',
            'bucket'    => 'my-backups',
            'accessKey' => 'tok_abc123',
            'prefix'    => 'ashbi/example.com',
        ] );

        $captured = [];
        Functions\expect( 'wp_remote_request' )
            ->once()
            ->andReturnUsing( function ( $url, $args ) use ( &$captured ) {
                $captured = [ 'url' => $url, 'args' => $args ];
                return [ 'response' => [ 'code' => 200 ], 'body' => '' ];
            } );

        $result = Ashbi_Backup::push_to_remote( [ $this->sql_file ] );

        $this->assertSame( 'ok', $result['status'] );
        $this->assertSame(
            'https://s3.us-west-001.backblazeb2.com/my-backups/ashbi/example.com/example_com_20260101_db.sql',
            $result['remote_url']
        );
        $this->assertGreaterThan( 0, $result['bytes_sent'] );

        // No secretKey → Bearer fallback.
        $this->assertSame( 'Bearer tok_abc123', $captured['args']['headers']['Authorization'] );
        $this->assertSame( 'PUT', $captured['args']['method'] );
    }

    /**
     * S3 push with accessKey + secretKey uses AWS SigV4.
     */
    public function test_push_to_remote_s3_sigv4_when_secret_present() {
        $this->set_destination( 's3', [
            'endpoint'  => 'https://s3.us-west-001.backblazeb2.com',
            'bucket'    => 'my-backups',
            'accessKey' => 'AKIAEXAMPLE',
            'secretKey' => 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
            'region'    => 'us-west-001',
            'prefix'    => 'ashbi/example.com',
        ] );

        $captured = [];
        Functions\expect( 'wp_remote_request' )
            ->once()
            ->andReturnUsing( function ( $url, $args ) use ( &$captured ) {
                $captured = [ 'url' => $url, 'args' => $args ];
                return [ 'response' => [ 'code' => 200 ], 'body' => '' ];
            } );

        $result = Ashbi_Backup::push_to_remote( [ $this->sql_file ] );

        $this->assertSame( 'ok', $result['status'] );
        $auth = $captured['args']['headers']['Authorization'] ?? '';
        $this->assertStringStartsWith( 'AWS4-HMAC-SHA256 Credential=', $auth );
        $this->assertArrayHasKey( 'x-amz-date', $captured['args']['headers'] );
        $this->assertArrayHasKey( 'x-amz-content-sha256', $captured['args']['headers'] );
        $this->assertSame( 'PUT', $captured['args']['method'] );
    }

    /**
     * Required integration: after a successful run_full_backup(), the
     * ashbi_last_backup.report contains a remote_push field.
     */
    public function test_run_full_backup_writes_remote_push_to_report() {
        // Configure destination BEFORE running the backup so the push
        // hook fires.
        $this->set_destination( 'webhook', [
            'webhookUrl' => 'https://hooks.example.com/ashbi-backup',
        ] );

        if ( ! class_exists( 'ZipArchive' ) ) {
            $this->markTestSkipped( 'ZipArchive extension required for run_full_backup integration test' );
        }

        // Stub the global $wpdb so export_database() succeeds without
        // a real DB.
        global $wpdb;
        $wpdb = new AshbiTestWpdb();

        // wp_remote_post is called twice in run_full_backup:
        //   (1) send_backup_report() → hub URL (/api/wp-bridge/backup)
        //   (2) push_to_remote()     → webhook URL (looped per file)
        // We accept any 200 response on any URL.
        Functions\expect( 'wp_remote_post' )
            ->zeroOrMoreTimes()
            ->andReturnUsing( function ( $url ) {
                return [ 'response' => [ 'code' => 200 ], 'body' => 'ok' ];
            } );

        $report = Ashbi_Backup::run_full_backup();

        // 1. The report key exists.
        $this->assertArrayHasKey( 'remote_push', $report, 'remote_push missing from report' );

        // 2. The destination field reflects the configured option.
        $this->assertSame( 'webhook', $report['remote_push']['destination'] );

        // 3. The status field is present and either ok or error — both
        // acceptable here since we only assert the shape is written.
        $this->assertArrayHasKey( 'status', $report['remote_push'] );
        $this->assertContains( $report['remote_push']['status'], [ 'ok', 'error' ] );

        // 4. The same shape is stored in the option.
        $stored = get_option( 'ashbi_last_backup' );
        $this->assertIsArray( $stored );
        $this->assertArrayHasKey( 'remote_push', $stored );
        $this->assertSame( 'webhook', $stored['remote_push']['destination'] );
    }

    /**
     * Integration: when destination is 'none', the remote_push field
     * is still present in the report (with destination='none' and
     * status='ok'). Consistent shape lets callers read $report['remote_push']
     * without checking for key existence.
     */
    public function test_run_full_backup_with_none_destination_writes_remote_push_with_none() {
        $this->set_destination( 'none', [] );

        if ( ! class_exists( 'ZipArchive' ) ) {
            $this->markTestSkipped( 'ZipArchive extension required' );
        }

        global $wpdb;
        $wpdb = new AshbiTestWpdb();

        Functions\expect( 'wp_remote_post' )
            ->zeroOrMoreTimes()
            ->andReturn( [ 'response' => [ 'code' => 200 ] ] );

        $report = Ashbi_Backup::run_full_backup();

        // remote_push field is always present (consistent shape).
        $this->assertArrayHasKey( 'remote_push', $report );
        $this->assertSame( 'none', $report['remote_push']['destination'] );
        $this->assertSame( 'ok', $report['remote_push']['status'] );
        $this->assertSame( 0, $report['remote_push']['bytes_sent'] );
    }
}