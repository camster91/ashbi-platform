<?php
/**
 * Tests for Ashbi_Backup at-rest encryption (sec-8, closes #5).
 *
 * Coverage:
 *   - Per-site key generation: ensure_encryption_key() returns 32 bytes,
 *     persists across calls, doesn't overwrite a valid existing key.
 *   - encrypt_file() / decrypt_file() round-trip with the same key.
 *   - Wrong-key decrypt fails (GCM tag mismatch) and returns false.
 *   - Tampered ciphertext fails the GCM tag check.
 *   - File format: 12-byte IV + ciphertext + 16-byte GCM tag.
 *   - rotate_encryption_key() swaps the key after re-encrypting all files.
 *   - list_backups() decrypts manifests with the current key.
 *   - rotate_backups() looks for *.enc, not plaintext.
 *
 * No WordPress is loaded — these run under the test harness with a real
 * openssl extension (PHP 8.5 includes openssl by default).
 */
class BackupEncryptionTest extends Ashbi_TestCase {

	/** @var ReflectionMethod[] */
	private array $methods = [];

	protected function setUp(): void {
		parent::setUp();
		$this->method( 'ensure_encryption_key' );
		$this->method( 'encrypt_file' );
		$this->method( 'decrypt_file' );
		$this->method( 'rotate_encryption_key' );
		$this->method( 'run_full_backup' );
		$this->method( 'list_backups' );
		$this->method( 'rotate_backups' );

		// Backup dir is computed from WP_CONTENT_DIR (test bootstrap defines it
		// under sys_get_temp_dir()). Don't hardcode /tmp paths — they differ
		// between Linux and macOS runs.
		if ( ! is_dir( WP_CONTENT_DIR . '/ashbi-backups' ) ) {
			mkdir( WP_CONTENT_DIR . '/ashbi-backups', 0755, true );
		}
		// Clean any leftover .enc files so each test starts with an empty dir.
		// (Other tests in this class plant encrypted files; rotation tests
		// count what they planted + nothing else.)
		foreach ( glob( WP_CONTENT_DIR . '/ashbi-backups/*.enc' ) ?: [] as $leftover ) {
			@unlink( $leftover );
		}
		foreach ( glob( WP_CONTENT_DIR . '/ashbi-backups/*.tmp' ) ?: [] as $leftover ) {
			@unlink( $leftover );
		}
		// Reset the encryption key so ensure_encryption_key() generates fresh.
		delete_option( 'ashbi_backup_encryption_key' );
		delete_option( 'ashbi_backup_encryption_key_rotated' );
	}

	private function method( string $name ): ReflectionMethod {
		if ( ! isset( $this->methods[ $name ] ) ) {
			$this->methods[ $name ] = $this->privateStaticMethod( 'Ashbi_Backup', $name );
		}
		return $this->methods[ $name ];
	}

	private function invoke( string $name, ...$args ) {
		return $this->method( $name )->invoke( null, ...$args );
	}

	public function test_ensure_encryption_key_returns_32_bytes(): void {
		$key = $this->invoke( 'ensure_encryption_key' );
		$this->assertIsString( $key );
		$this->assertSame( 32, strlen( $key ) );

		// Idempotent: second call returns the same key (not a new one).
		$key2 = $this->invoke( 'ensure_encryption_key' );
		$this->assertSame( $key, $key2 );
	}

	public function test_ensure_encryption_key_overwrites_invalid(): void {
		// Plant an invalid (wrong-length) key.
		update_option( 'ashbi_backup_encryption_key', 'too-short' );
		$key = $this->invoke( 'ensure_encryption_key' );
		$this->assertSame( 32, strlen( $key ) );
		// Stored option is now wrapped (ashbi1:...) — not the raw key.
		$stored = get_option( 'ashbi_backup_encryption_key' );
		$this->assertIsString( $stored );
		$this->assertStringStartsWith( 'ashbi1:', $stored );
		// Unwrapping via ensure again still returns the same raw key.
		$this->assertSame( $key, $this->invoke( 'ensure_encryption_key' ) );
	}

	public function test_ensure_encryption_key_wraps_legacy_plaintext(): void {
		$legacy = random_bytes( 32 );
		update_option( 'ashbi_backup_encryption_key', $legacy );
		$key = $this->invoke( 'ensure_encryption_key' );
		$this->assertSame( $legacy, $key );
		$stored = get_option( 'ashbi_backup_encryption_key' );
		$this->assertStringStartsWith( 'ashbi1:', $stored, 'legacy plaintext key must be re-wrapped' );
	}

	public function test_encrypt_decrypt_roundtrip(): void {
		$key    = random_bytes( 32 );
		$plain  = "Hello, world!\nLine 2\nLine 3 with some longer text to exercise GCM blocks.\n";
		$dest   = '' . sys_get_temp_dir() . '/ashbi-test/enc-roundtrip-' . uniqid() . '.enc';
		$this->assertTrue( $this->invoke( 'encrypt_file', $dest, $plain, $key ) );

		$decrypted = $this->invoke( 'decrypt_file', $dest, $key );
		$this->assertSame( $plain, $decrypted );

		@unlink( $dest );
	}

	public function test_wrong_key_fails_gcm_tag_check(): void {
		$key   = random_bytes( 32 );
		$other = random_bytes( 32 );
		$dest  = '' . sys_get_temp_dir() . '/ashbi-test/enc-wrong-key-' . uniqid() . '.enc';

		$this->assertTrue( $this->invoke( 'encrypt_file', $dest, 'secret content', $key ) );

		// Wrong key → GCM tag mismatch → openssl_decrypt returns false.
		$result = $this->invoke( 'decrypt_file', $dest, $other );
		$this->assertFalse( $result );

		@unlink( $dest );
	}

	public function test_tampered_ciphertext_fails_gcm_tag_check(): void {
		$key  = random_bytes( 32 );
		$dest = '' . sys_get_temp_dir() . '/ashbi-test/enc-tamper-' . uniqid() . '.enc';

		$this->assertTrue( $this->invoke( 'encrypt_file', $dest, 'secret content', $key ) );

		// Flip a bit in the ciphertext body (after the 12-byte IV, before the
		// 16-byte GCM tag). GCM must catch the modification.
		$blob = file_get_contents( $dest );
		$blob[15] = chr( ord( $blob[15] ) ^ 0x01 );
		file_put_contents( $dest, $blob );

		$result = $this->invoke( 'decrypt_file', $dest, $key );
		$this->assertFalse( $result );

		@unlink( $dest );
	}

	public function test_file_format_iv_ciphertext_tag(): void {
		$key  = random_bytes( 32 );
		$dest = '' . sys_get_temp_dir() . '/ashbi-test/enc-format-' . uniqid() . '.enc';

		$plain = str_repeat( 'A', 1024 ); // > 16 bytes so ciphertext > tag
		$this->assertTrue( $this->invoke( 'encrypt_file', $dest, $plain, $key ) );

		$blob = file_get_contents( $dest );
		// 12-byte IV at front, 16-byte GCM tag at end.
		$this->assertGreaterThanOrEqual( 12 + 16, strlen( $blob ) );
		$this->assertSame( strlen( $plain ), strlen( $blob ) - 12 - 16, 'ciphertext length = plaintext length' );

		@unlink( $dest );
	}

	public function test_encrypt_rejects_wrong_key_size(): void {
		$key = str_repeat( 'x', 16 ); // AES-128, not AES-256
		$dest = '' . sys_get_temp_dir() . '/ashbi-test/enc-bad-key-' . uniqid() . '.enc';
		$this->assertFalse( $this->invoke( 'encrypt_file', $dest, 'plaintext', $key ) );
		$this->assertFileDoesNotExist( $dest );
	}

	public function test_decrypt_rejects_truncated_file(): void {
		$key  = random_bytes( 32 );
		$dest = '' . sys_get_temp_dir() . '/ashbi-test/enc-trunc-' . uniqid() . '.enc';
		file_put_contents( $dest, 'too-short' );
		$this->assertFalse( $this->invoke( 'decrypt_file', $dest, $key ) );
		@unlink( $dest );
	}

	public function test_rotate_encryption_key_reencrypts_existing_files(): void {
		// Set up: encrypt two files with the current key.
		$key    = $this->invoke( 'ensure_encryption_key' );
		$file_a = '' . WP_CONTENT_DIR . '/ashbi-backups/site_20260101_000000_db.sql.enc';
		$file_b = '' . WP_CONTENT_DIR . '/ashbi-backups/site_20260102_000000_files.zip.enc';
		$this->assertTrue( $this->invoke( 'encrypt_file', $file_a, 'db-dump-v1', $key ) );
		$this->assertTrue( $this->invoke( 'encrypt_file', $file_b, 'files-zip-v1', $key ) );

		// Capture the original plaintexts.
		$plain_a = $this->invoke( 'decrypt_file', $file_a, $key );
		$plain_b = $this->invoke( 'decrypt_file', $file_b, $key );

		// Rotate.
		$result = $this->invoke( 'rotate_encryption_key' );
		$this->assertSame( 2, $result['rotated'] );
		$this->assertSame( 0, $result['failed'] );
		$this->assertTrue( $result['key_swapped'] );

		// After rotation, the new key must decrypt both files and produce
		// the same plaintexts.
		$new_key = $this->invoke( 'ensure_encryption_key' );
		$this->assertNotSame( $key, $new_key, 'rotation must produce a new key' );

		$this->assertSame( $plain_a, $this->invoke( 'decrypt_file', $file_a, $new_key ) );
		$this->assertSame( $plain_b, $this->invoke( 'decrypt_file', $file_b, $new_key ) );

		// Old key can no longer decrypt.
		$this->assertFalse( $this->invoke( 'decrypt_file', $file_a, $key ) );

		@unlink( $file_a );
		@unlink( $file_b );
	}

	public function test_rotate_does_not_swap_key_on_failure(): void {
		// Set up a file that decrypts OK, then plant another that's corrupt.
		$key    = $this->invoke( 'ensure_encryption_key' );
		$good   = '' . WP_CONTENT_DIR . '/ashbi-backups/site_20260103_000000_db.sql.enc';
		$bad    = '' . WP_CONTENT_DIR . '/ashbi-backups/site_20260104_000000_db.sql.enc';
		$this->assertTrue( $this->invoke( 'encrypt_file', $good, 'good-content', $key ) );
		file_put_contents( $bad, 'corrupted-ciphertext' );

		$result = $this->invoke( 'rotate_encryption_key' );
		// Fail-fast: when one file fails decrypt, rotation aborts before any
		// file is re-encrypted. rotated=0, key NOT swapped, good file is still
		// readable under the original key.
		$this->assertSame( 0, $result['rotated'] );
		$this->assertSame( 1, $result['failed'] );
		$this->assertFalse( $result['key_swapped'], 'key must not swap when any rotation failed' );

		// Original key still decrypts the good file.
		$this->assertSame( 'good-content', $this->invoke( 'decrypt_file', $good, $key ) );

		@unlink( $good );
		@unlink( $bad );
	}

	public function test_list_backups_decrypts_manifests(): void {
		$dir   = WP_CONTENT_DIR . '/ashbi-backups';
		$key   = $this->invoke( 'ensure_encryption_key' );
		$manifest_path = $dir . '/site_list_test_db.sql.enc'; // any matching file

		// Build an encrypted manifest matching the run_full_backup format.
		$manifest_data = [
			'timestamp' => '2026-07-01 12:00:00',
			'siteUrl'   => 'https://example.com',
			'wpVersion' => '6.4',
			'dbSize'    => 1024,
			'filesSize' => 4096,
			'dbFile'    => 'site_list_test_db.sql.enc',
			'filesFile' => 'site_list_test_files.zip.enc',
			'cipher'    => 'aes-256-gcm',
			'encrypted' => true,
		];

		$enc_manifest = $dir . '/site_list_test_manifest.json.enc';
		$this->assertTrue( $this->invoke( 'encrypt_file', $enc_manifest, json_encode( $manifest_data ), $key ) );

		$list = Ashbi_Backup::list_backups();
		$this->assertNotEmpty( $list );
		$first = $list[0];
		$this->assertSame( 'https://example.com', $first['siteUrl'] );
		$this->assertSame( 'aes-256-gcm', $first['cipher'] );
		$this->assertTrue( $first['encrypted'] );

		@unlink( $enc_manifest );
	}

	public function test_rotate_backups_removes_enc_files(): void {
		$dir = rtrim( WP_CONTENT_DIR, '/' ) . '/ashbi-backups';
		$key = $this->invoke( 'ensure_encryption_key' );

		// MAX_LOCAL_BACKUPS is 4. Create 6 encrypted backups with DISTINCT mtimes
		// so rotation's ksort has unambiguous ordering — otherwise files created
		// in the same second collapse to one array entry via $manifests[mtime].
		$oldest_a = $dir . '/old_a_20260101_000000_manifest.json.enc';
		$oldest_b = $dir . '/old_b_20260102_000000_manifest.json.enc';
		$kept = [];
		$kept_mtime = time() - 600; // base time for the 4 kept backups
		for ( $i = 0; $i < 4; $i++ ) {
			$path = $dir . "/kept_{$i}_2026010{$i}_000000_manifest.json.enc";
			$this->assertTrue( $this->invoke( 'encrypt_file', $path, json_encode([ 'timestamp' => "2026-01-0{$i} 00:00:00", 'siteUrl' => 'https://example.com' ]), $key ) );
			$kept[] = $path;
			$db = $dir . "/kept_{$i}_2026010{$i}_000000_db.sql.enc";
			$files = $dir . "/kept_{$i}_2026010{$i}_000000_files.zip.enc";
			$this->assertTrue( $this->invoke( 'encrypt_file', $db, 'db', $key ) );
			$this->assertTrue( $this->invoke( 'encrypt_file', $files, 'files', $key ) );
			// Force distinct mtime — encrypted in the same second would otherwise
			// collapse to one rotation entry via $manifests[mtime] = $f.
			touch( $path, $kept_mtime + ( $i * 60 ) );
			touch( $db,    $kept_mtime + ( $i * 60 ) );
			touch( $files, $kept_mtime + ( $i * 60 ) );
			clearstatcache( true, $path );
			clearstatcache( true, $db );
			clearstatcache( true, $files );
		}
		// 2 oldest — touch AFTER encrypt_file so our mtimes win.
		$this->assertTrue( $this->invoke( 'encrypt_file', $oldest_a, json_encode([ 'timestamp' => '2026-01-01 00:00:00' ]), $key ) );
		$this->assertTrue( $this->invoke( 'encrypt_file', $oldest_b, json_encode([ 'timestamp' => '2026-01-02 00:00:00' ]), $key ) );
		touch( $oldest_a, time() - 7200 );
		touch( $oldest_b, time() - 3600 );
		clearstatcache( true, $oldest_a );
		clearstatcache( true, $oldest_b );

		$this->invoke( 'rotate_backups' );

		// Manifests of the 2 oldest must be gone. Their db/files payload
		// files weren't created in this test (only manifests), so there's
		// nothing else to assert on those names.
		$this->assertFileDoesNotExist( $oldest_a );
		$this->assertFileDoesNotExist( $oldest_b );

		foreach ( $kept as $path ) {
			$this->assertFileExists( $path, 'kept manifests must survive rotation' );
			// Cleanup.
			@unlink( $path );
			@unlink( str_replace( '_manifest.json.enc', '_db.sql.enc', $path ) );
			@unlink( str_replace( '_manifest.json.enc', '_files.zip.enc', $path ) );
		}
	}

	/**
	 * Source-level guard: file extension change from _manifest.json to
	 * _manifest.json.enc in run_full_backup() and friends.
	 */
	public function test_source_uses_enc_extension(): void {
		$source = file_get_contents( __DIR__ . '/../../includes/class-ashbi-backup.php' );

		// File suffixes must use ENC_FILE_SUFFIX constant. Source builds paths
		// like "<base>_db.sql" . self::ENC_FILE_SUFFIX (PHP string concat with
		// closing quote between the two halves).
		$this->assertMatchesRegularExpression(
			'/_db\.sql"\s*\.\s*self::ENC_FILE_SUFFIX/',
			$source,
			'run_full_backup must build encrypted file paths via ENC_FILE_SUFFIX'
		);
		$this->assertMatchesRegularExpression(
			'/_files\.zip"\s*\.\s*self::ENC_FILE_SUFFIX/',
			$source,
			'run_full_backup must build encrypted files-zip paths via ENC_FILE_SUFFIX'
		);

		// run_full_backup must call encrypt_file at least 3 times (db, files, manifest).
		$count = substr_count( $source, 'self::encrypt_file(' );
		$this->assertGreaterThanOrEqual( 3, $count );

		// rotate_backups must look for *_manifest.json.enc.
		$this->assertStringContainsString( '*_manifest.json.enc', $source );
	}
}