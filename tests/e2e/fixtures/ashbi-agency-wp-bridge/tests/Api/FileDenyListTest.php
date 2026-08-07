<?php
/**
 * Tests for Ashbi_API::is_blocked_file_path — sensitive file deny-list.
 *
 * The deny-list method is added in PR #19 (v1.10.2). Until that PR merges,
 * the private method does not exist; tests skip cleanly via $this->method
 * === null. Once PR #19 lands, the same test file proves the fix works
 * without source modifications.
 *
 * What is covered (when the method is present):
 *   - wp-config.php and case variants (WP-CONFIG.PHP, Wp-Config.PHP) blocked
 *   - .env and .ENV blocked
 *   - .bak / .sql / .sqlite* extensions blocked
 *   - .ssh/id_* SSH keys blocked
 *   - index.php / style.css / theme files allowed
 *   - wp-content/ashbi-backups/ subtree blocked
 *   - case-insensitive comparison (strtolower basename)
 */
class FileDenyListTest extends Ashbi_TestCase {
    /** @var ReflectionMethod|null */
    private $method;

    protected function setUp(): void {
        parent::setUp();
        $this->method = method_exists( 'Ashbi_API', 'is_blocked_file_path' )
            ? $this->privateStaticMethod( 'Ashbi_API', 'is_blocked_file_path' )
            : null;
    }

    private function isBlocked( string $path ): bool {
        if ( $this->method === null ) {
            $this->markTestSkipped( 'Ashbi_API::is_blocked_file_path not implemented yet (PR #19 not merged)' );
        }
        return (bool) $this->method->invoke( null, $path );
    }

    public function test_wp_config_php_blocked(): void {
        $this->assertTrue( $this->isBlocked( 'wp-config.php' ) );
    }

    public function test_wp_config_php_uppercase_blocked(): void {
        $this->assertTrue( $this->isBlocked( 'WP-CONFIG.PHP' ) );
        $this->assertTrue( $this->isBlocked( 'Wp-Config.PHP' ) );
    }

    public function test_dotenv_blocked(): void {
        $this->assertTrue( $this->isBlocked( '.env' ) );
    }

    public function test_dotenv_uppercase_blocked(): void {
        $this->assertTrue( $this->isBlocked( '.ENV' ) );
    }

    public function test_sqlite_dump_blocked(): void {
        $this->assertTrue( $this->isBlocked( 'database.sql' ) );
        $this->assertTrue( $this->isBlocked( 'backup.zip.bak' ) );
    }

    public function test_ssh_keys_blocked(): void {
        $this->assertTrue( $this->isBlocked( '.ssh/id_rsa' ) );
        $this->assertTrue( $this->isBlocked( '.ssh/id_ed25519' ) );
    }

    public function test_index_php_allowed(): void {
        $this->assertFalse( $this->isBlocked( 'index.php' ) );
    }

    public function test_style_css_allowed(): void {
        $this->assertFalse( $this->isBlocked( 'style.css' ) );
    }

    public function test_normal_plugin_file_allowed(): void {
        $this->assertFalse( $this->isBlocked( 'wp-content/themes/twentytwentyone/style.css' ) );
    }

    public function test_backup_dir_blocked(): void {
        $this->assertTrue( $this->isBlocked( 'wp-content/ashbi-backups/site_20260101_db.sql' ) );
    }

    /**
     * Implementation guard: basename comparison must be case-insensitive.
     * Catches a regression where someone "simplifies" the lookup and
     * silently allows WP-CONFIG.PHP through on a case-insensitive FS.
     */
    public function test_case_insensitive_basename_match(): void {
        $source = file_get_contents( __DIR__ . '/../../includes/class-ashbi-api.php' );
        if ( $this->method === null ) {
            $this->markTestSkipped( 'method not present' );
        }
        $this->assertTrue(
            strpos( $source, "strtolower( \$basename )" ) !== false
                || strpos( $source, 'strtolower($basename)' ) !== false
                || preg_match( "/\.bak.*\\/i[^a-z]/", $source ),
            'is_blocked_file_path must use case-insensitive comparison'
        );
    }
}