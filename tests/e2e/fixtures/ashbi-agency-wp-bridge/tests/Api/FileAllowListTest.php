<?php
/**
 * Tests for Ashbi_API::is_allowed_file_path — remote-file allowlist.
 *
 * Closes the residual gap from PR #19's denylist (#12): even after blocking
 * wp-config.php / .env / .bak / SSH keys, a signed attacker could rewrite
 * any file under ABSPATH. The allowlist restricts /file/patch (and future
 * /file/read hardening) to plugin directory + active theme only.
 *
 * Denylist + allowlist = defense in depth. Either layer alone is insufficient:
 *   - Denylist alone: a new sensitive file type added later could be missed.
 *   - Allowlist alone: legitimate ops on non-allowlisted paths become hard.
 *
 * Allowed:
 *   - wp-content/plugins/ashbi-agency-wp-bridge/*  (always)
 *   - wp-content/themes/<active-theme>/*          (from get_option('stylesheet'))
 *
 * Override via add_filter( 'ashbi_allowed_file_prefixes', $prefixes ).
 */
class FileAllowListTest extends Ashbi_TestCase {
	/** @var ReflectionMethod|null */
	private $method;

	protected function setUp(): void {
		parent::setUp();
		$this->method = method_exists( 'Ashbi_API', 'is_allowed_file_path' )
			? $this->privateStaticMethod( 'Ashbi_API', 'is_allowed_file_path' )
			: null;
		// Active theme fixture.
		update_option( 'stylesheet', 'twentytwentyone' );
	}

	private function isAllowed( string $path ): bool {
		if ( $this->method === null ) {
			$this->markTestSkipped( 'is_allowed_file_path not present (allowlist not yet merged)' );
		}
		return (bool) $this->method->invoke( null, $path );
	}

	public function test_plugin_root_allowed(): void {
		$this->assertTrue( $this->isAllowed( 'wp-content/plugins/ashbi-agency-wp-bridge/includes/class-ashbi-api.php' ) );
	}

	public function test_active_theme_allowed(): void {
		$this->assertTrue( $this->isAllowed( 'wp-content/themes/twentytwentyone/style.css' ) );
		$this->assertTrue( $this->isAllowed( 'wp-content/themes/twentytwentyone/functions.php' ) );
	}

	public function test_other_theme_blocked(): void {
		$this->assertFalse( $this->isAllowed( 'wp-content/themes/twentytwentytwo/style.css' ) );
		$this->assertFalse( $this->isAllowed( 'wp-content/themes/twentytwentythree/functions.php' ) );
	}

	public function test_other_plugin_blocked(): void {
		$this->assertFalse( $this->isAllowed( 'wp-content/plugins/akismet/akismet.php' ) );
		$this->assertFalse( $this->isAllowed( 'wp-content/plugins/jetpack/jetpack.php' ) );
	}

	public function test_wp_config_blocked(): void {
		$this->assertFalse( $this->isAllowed( 'wp-config.php' ) );
	}

	public function test_wp_includes_blocked(): void {
		$this->assertFalse( $this->isAllowed( 'wp-includes/version.php' ) );
		$this->assertFalse( $this->isAllowed( 'wp-admin/admin.php' ) );
	}

	public function test_uploads_blocked(): void {
		$this->assertFalse( $this->isAllowed( 'wp-content/uploads/2026/07/photo.jpg' ) );
	}

	public function test_root_blocked(): void {
		$this->assertFalse( $this->isAllowed( 'index.php' ) );
		$this->assertFalse( $this->isAllowed( 'wp-load.php' ) );
		$this->assertFalse( $this->isAllowed( 'wp-blog-header.php' ) );
	}

	public function test_traversal_blocked(): void {
		// `..` traversal is rejected in patch_file/read_file itself (caller
		// does strpos($path, '..') !== false), not in this helper. The
		// helper only does prefix matching; verifying the prefix-match
		// doesn't accidentally include an empty-string match.
		$this->assertFalse( $this->isAllowed( '../wp-config.php' ) );
		$this->assertFalse( $this->isAllowed( '' ) );
	}

	public function test_filter_can_extend_allowlist(): void {
		$filter = function ( $prefixes ) {
			$prefixes[] = 'wp-content/mu-plugins/';
			return $prefixes;
		};
		add_filter( 'ashbi_allowed_file_prefixes', $filter );
		try {
			$this->assertTrue( $this->isAllowed( 'wp-content/mu-plugins/custom.php' ) );
			// Filter additions don't grant access to denied dirs.
			$this->assertFalse( $this->isAllowed( 'wp-config.php' ) );
		} finally {
			remove_filter( 'ashbi_allowed_file_prefixes', $filter );
		}
	}

	public function test_empty_active_theme_blocks_theme_paths(): void {
		update_option( 'stylesheet', '' );
		$this->assertFalse( $this->isAllowed( 'wp-content/themes/twentytwentyone/style.css' ) );
		// Plugin dir still allowed.
		$this->assertTrue( $this->isAllowed( 'wp-content/plugins/ashbi-agency-wp-bridge/ashbi-agency-wp-bridge.php' ) );
	}

	/**
	 * Source-level guard: patch_file() must call is_allowed_file_path()
	 * AFTER the denylist, so the allowlist cannot be bypassed by a request
	 * that just doesn't include the denylisted-path pattern.
	 */
	public function test_patch_file_invokes_allowlist(): void {
		$source = file_get_contents( __DIR__ . '/../../includes/class-ashbi-api.php' );
		$this->assertStringContainsString( 'is_allowed_file_path', $source, 'patch_file() must consult the allowlist' );

		// Extract just the patch_file body.
		if ( ! preg_match( '/function\s+patch_file\s*\([^)]*\)\s*\{(.*?)\n\s*\}/s', $source, $m ) ) {
			$this->markTestSkipped( 'could not extract patch_file body' );
		}
		$body = $m[1];

		$deny_pos  = strpos( $body, 'is_blocked_file_path' );
		$allow_pos = strpos( $body, 'is_allowed_file_path' );

		$this->assertNotFalse( $deny_pos, 'denylist call must be present' );
		$this->assertNotFalse( $allow_pos, 'allowlist call must be present' );
		$this->assertGreaterThan( $deny_pos, $allow_pos, 'allowlist check must come AFTER denylist check' );
	}

	/**
	 * /file/read must use the same allowlist as /file/patch — otherwise a
	 * signed caller can still exfiltrate arbitrary files under ABSPATH.
	 */
	public function test_read_file_invokes_allowlist(): void {
		$source = file_get_contents( __DIR__ . '/../../includes/class-ashbi-api.php' );
		if ( ! preg_match( '/function\s+read_file\s*\([^)]*\)\s*\{(.*?)\n\s*\}/s', $source, $m ) ) {
			$this->markTestSkipped( 'could not extract read_file body' );
		}
		$body = $m[1];
		$this->assertStringContainsString( 'is_allowed_file_path', $body, 'read_file() must consult the allowlist' );
	}
}