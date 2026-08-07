<?php
/**
 * Tests for Ashbi_Updater::get_zip_url — v1.10.1 fallback + PR #23 guard.
 *
 * Master v1.10.1 falls back to zipball_url (the default-branch HEAD
 * archive) when no .zip asset is uploaded. PR #23 replaces this with a
 * tag-specific archive URL. Until PR #23 lands, we assert the current
 * master behavior and skip the post-fix assertions.
 */
class ZipballFallbackTest extends Ashbi_TestCase {
    /** @var ReflectionMethod */
    private $method;

    /** @var Ashbi_Updater */
    private $updater;

    protected function setUp(): void {
        parent::setUp();
        if ( ! method_exists( 'Ashbi_Updater', 'get_zip_url' ) ) {
            $this->markTestSkipped( 'Ashbi_Updater not loadable' );
        }
        $this->updater = new Ashbi_Updater();
        $this->method  = $this->privateMethod( $this->updater, 'get_zip_url' );
    }

    private function invoke( array $data ): string {
        return (string) $this->method->invoke( $this->updater, $data );
    }

    public function test_prefers_uploaded_zip_asset(): void {
        $data = [
            'tag_name' => 'v1.11.0',
            'assets'   => [
                [ 'name' => 'ashbi.zip', 'browser_download_url' => 'https://github.com/camster91/ashbi-agency-wp-bridge/releases/download/v1.11.0/ashbi.zip' ],
            ],
        ];
        $url = $this->invoke( $data );
        $this->assertSame(
            'https://github.com/camster91/ashbi-agency-wp-bridge/releases/download/v1.11.0/ashbi.zip',
            $url
        );
    }

    /**
     * PR #23: when no .zip asset is uploaded, return a tag-specific
     * archive URL (NOT zipball_url, which is the default-branch HEAD
     * and would silently install unreviewed code).
     */
    public function test_falls_back_to_tag_specific_archive_url(): void {
        $data = [
            'tag_name'    => 'v1.11.0',
            'zipball_url' => 'https://api.github.com/repos/camster91/ashbi-agency-wp-bridge/zipball',
            'assets'      => [],
        ];
        $url = $this->invoke( $data );
        $this->assertSame(
            'https://github.com/camster91/ashbi-agency-wp-bridge/archive/refs/tags/v1.11.0.zip',
            $url
        );
        // Critical: zipball_url (HEAD) is NOT returned.
        $this->assertNotSame(
            'https://api.github.com/repos/camster91/ashbi-agency-wp-bridge/zipball',
            $url
        );
    }

    public function test_empty_assets_returns_tag_archive(): void {
        // No .zip asset, no zipball_url, but tag is present — use tag archive.
        $data = [ 'tag_name' => 'v1.11.0', 'assets' => [] ];
        $url  = $this->invoke( $data );
        $this->assertSame(
            'https://github.com/camster91/ashbi-agency-wp-bridge/archive/refs/tags/v1.11.0.zip',
            $url
        );
    }

    public function test_missing_tag_name_returns_empty(): void {
        // PR #23: no tag_name → '' (no install instead of HEAD install).
        $data = [
            'zipball_url' => 'https://api.github.com/repos/foo/bar/zipball',
            'assets'      => [],
        ];
        $url = $this->invoke( $data );
        $this->assertSame( '', $url );
        $this->assertNotContains( $url, [ 'https://api.github.com/repos/foo/bar/zipball' ] );
    }

    public function test_prefers_zip_content_type_over_name_match(): void {
        $data = [
            'tag_name' => 'v1.11.0',
            'assets'   => [
                [ 'content_type' => 'application/zip', 'browser_download_url' => 'https://example.com/zip-by-content-type.zip' ],
                [ 'name' => 'sha256sums.txt', 'browser_download_url' => 'https://example.com/sha256sums.txt' ],
            ],
        ];
        $url = $this->invoke( $data );
        $this->assertSame( 'https://example.com/zip-by-content-type.zip', $url );
    }

    /**
     * Source-level guard: PR #23 builds a tag-specific archive URL
     * (https://github.com/<user>/<repo>/archive/refs/tags/<tag>.zip) when
     * no .zip asset is uploaded. Until it merges, that string doesn't appear.
     */
    public function test_tag_archive_url_after_pr23(): void {
        $source = file_get_contents( __DIR__ . '/../../includes/class-ashbi-updater.php' );

        if ( strpos( $source, '/archive/refs/tags/' ) === false ) {
            $this->markTestSkipped( 'get_zip_url does not yet build tag-specific archive URL (PR #23 not merged)' );
        }
        $this->assertStringContainsString( '/archive/refs/tags/', $source );
    }
}