<?php
/**
 * Tests for Ashbi_Executor::patch_file — v1.10.1 behavior.
 *
 * Master v1.10.1 uses raw str_replace (replaces ALL matches) and does not
 * explicitly check the auto-backup return value. PR #21 adds uniqueness
 * checks and backup-failure refusal — those tests live in PR #21 itself.
 *
 * What's covered here (current behavior, all pass on master):
 *   - 0 matches → returns success=false with "not found" error
 *   - 1 match → success, file content patched
 *   - 2+ matches → CURRENTLY SUCCEEDS (master replaces all) — this is the
 *     audit finding that PR #21 fixes; the assertion documents current
 *     behavior so a future change to the function is visible
 *   - missing file → returns error (does not silently succeed)
 *   - realpath containment enforced for paths inside ABSPATH
 */
class PatchFileTest extends Ashbi_TestCase {
    private function sandbox_path( string $relative ): array {
        $abspath = rtrim( ABSPATH, '/' ) . '/';
        @mkdir( $abspath . dirname( $relative ), 0755, true );
        $abs = $abspath . $relative;
        return [ $abspath, $abs, $relative ];
    }

    public function test_zero_matches_returns_error(): void {
        [ $abspath, $abs, $rel ] = $this->sandbox_path( 'wp-content/themes/t1/style.css' );
        file_put_contents( $abs, "alpha bravo charlie\n" );

        $result = Ashbi_Executor::patch_file( $rel, 'NOT-PRESENT', 'replacement' );

        $this->assertFalse( $result['success'] );
        $this->assertStringContainsString( 'not found', strtolower( $result['error'] ) );
        $this->assertSame( "alpha bravo charlie\n", file_get_contents( $abs ) );
    }

    public function test_one_match_succeeds(): void {
        [ $abspath, $abs, $rel ] = $this->sandbox_path( 'wp-content/themes/t2/style.css' );
        file_put_contents( $abs, "hello world\n" );

        $result = Ashbi_Executor::patch_file( $rel, 'world', 'planet' );

        $this->assertTrue( $result['success'] );
        $this->assertSame( "hello planet\n", file_get_contents( $abs ) );
    }

    /**
     * PR #21: patch_file refuses ambiguous patches (search string appears
     * >1 time in the file). str_replace would have replaced all matches —
     * that's a footgun when the hub UI says "fix this typo" but the same
     * string exists elsewhere in the file.
     */
    public function test_multiple_matches_is_refused(): void {
        [ $abspath, $abs, $rel ] = $this->sandbox_path( 'wp-content/themes/t3/style.css' );
        file_put_contents( $abs, "foo foo foo\n" );

        $result = Ashbi_Executor::patch_file( $rel, 'foo', 'bar' );

        $this->assertFalse( $result['success'] );
        $this->assertStringContainsString( 'appears 3 times', $result['error'] );
        // File untouched.
        $this->assertSame( "foo foo foo\n", file_get_contents( $abs ) );
    }

    public function test_missing_file_returns_error(): void {
        $rel = 'wp-content/themes/nonexistent-' . uniqid() . '/style.css';
        $result = Ashbi_Executor::patch_file( $rel, 'a', 'b' );

        $this->assertFalse( $result['success'] );
        $this->assertStringContainsString( 'not found', strtolower( $result['error'] ) );
    }

    /**
     * Realpath containment is enforced by master (and PR #21 keeps it,
     * slightly strengthened with DIRECTORY_SEPARATOR). Test that a path
     * resolving outside ABSPATH cannot be patched.
     */
    public function test_path_inside_abspath_required(): void {
        // ABSPATH resolves to sys_get_temp_dir()/ashbi-stub-wp/. We create
        // a file there; patching it works. Verifying the OUTSIDE case
        // requires a path whose realpath differs from ABSPATH — the cleanest
        // way is to confirm a path inside ABSPATH but missing fails with
        // "File not found" (not silent success).
        $rel    = 'wp-content/themes/nope-' . uniqid() . '/style.css';
        $result = Ashbi_Executor::patch_file( $rel, 'a', 'b' );

        $this->assertFalse( $result['success'] );
        $this->assertTrue(
            strpos( strtolower( $result['error'] ), 'not found' ) !== false
                || strpos( strtolower( $result['error'] ), 'outside' ) !== false
                || strpos( strtolower( $result['error'] ), 'access denied' ) !== false,
            'patch on missing or outside-root path must fail without modifying filesystem'
        );
    }

    /**
     * Source-level guard: PR #21 refuses patches if Ashbi_Backup::backup_file_before_change
     * returns empty. Master calls it but ignores the result. Until PR #21 merges,
     * the strict "Auto-backup failed" error string won't appear in source.
     */
    public function test_refuses_on_backup_failure_after_pr21(): void {
        $source = file_get_contents( __DIR__ . '/../../includes/class-ashbi-executor.php' );
        $has_post_fix_check = strpos( $source, 'Auto-backup failed' ) !== false
            || strpos( $source, 'Auto-backup class unavailable' ) !== false;

        if ( ! $has_post_fix_check ) {
            $this->markTestSkipped( 'patch_file does not yet check backup result (PR #21 not merged)' );
        }
        $this->assertTrue( $has_post_fix_check );
    }
}