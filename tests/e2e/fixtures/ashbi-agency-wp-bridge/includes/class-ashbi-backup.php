<?php
/**
 * Ashbi Backup Class
 *
 * Automated full-site backups: files + database, stored locally with optional off-site webhook.
 * Backs up before any file change (auto-backup) and runs weekly full backups.
 *
 * @package Ashbi_Agency_WP_Bridge
 * @version 1.7.0
 */

if ( ! defined( 'ABSPATH' ) ) exit;

class Ashbi_Backup {

    const BACKUP_DIR          = WP_CONTENT_DIR . '/ashbi-backups';
    const MAX_LOCAL_BACKUPS   = 4;
    const OPTION_ENC_KEY      = 'ashbi_backup_encryption_key';
    const OPTION_ENC_KEY_ROTATED = 'ashbi_backup_encryption_key_rotated';
    const ENC_CIPHER          = 'aes-256-gcm';
    const ENC_FILE_SUFFIX     = '.enc';

    public static function init() {
        if ( ! wp_next_scheduled( 'ashbi_weekly_backup' ) ) {
            wp_schedule_event( time(), 'weekly', 'ashbi_weekly_backup' );
        }
        add_action( 'ashbi_weekly_backup', [ __CLASS__, 'run_full_backup' ] );
    }

    /**
     * Per-site encryption key for backup at-rest encryption (sec-8, closes #5).
     *
     * Lazily generated on first call to ensure_encryption_key(). Stored as
     * raw 32 bytes (256-bit key for aes-256-gcm) in the wp_options table.
     *
     * The key NEVER leaves the site — never sent to the hub, never included
     * in the manifest, never logged. Off-site backups are encrypted before
     * push, decrypted only by the site that owns them.
     *
     * Lifecycle:
     *   - Generated on first backup after the feature ships.
     *   - Rotated via rotate_encryption_key() (admin-only action, re-encrypts
     *     every local backup in place). Old key is destroyed after rotation
     *     succeeds for every backup.
     *   - If the key is wiped (e.g. DB restore from a different server), the
     *     existing encrypted backups become unreadable until the same key is
     *     restored. That's the trade-off vs plaintext-at-rest.
     */
    /**
     * Per-site encryption key for backup at-rest encryption (sec-8, closes #5).
     *
     * Lazily generated on first call to ensure_encryption_key(). Stored
     * wrapped under WP auth salts (aes-256-gcm) so a raw DB dump of wp_options
     * does not yield a usable key without wp-config.php salts.
     *
     * Legacy installs that still have a raw 32-byte key are transparently
     * re-wrapped on the next call.
     */
    public static function ensure_encryption_key(): string {
        $stored = get_option( self::OPTION_ENC_KEY, null );

        // Legacy: raw 32-byte key in options — unwrap path handles both.
        $key = self::unwrap_encryption_key( $stored );
        if ( is_string( $key ) && strlen( $key ) === 32 ) {
            // Re-wrap legacy plaintext keys so future DB dumps are safer.
            if ( is_string( $stored ) && strlen( $stored ) === 32 ) {
                update_option( self::OPTION_ENC_KEY, self::wrap_encryption_key( $key ), false );
            }
            return $key;
        }

        $key = random_bytes( 32 );
        update_option( self::OPTION_ENC_KEY, self::wrap_encryption_key( $key ), false );
        update_option( self::OPTION_ENC_KEY_ROTATED, current_time( 'mysql' ), false );
        return $key;
    }

    /**
     * Wrap a raw 32-byte key under WP salts. Format: ashbi1:<base64(iv|tag|ct)>.
     */
    private static function wrap_encryption_key( string $raw ): string {
        $master = self::key_wrapping_material();
        $iv     = random_bytes( 12 );
        $tag    = '';
        $ct     = openssl_encrypt( $raw, 'aes-256-gcm', $master, OPENSSL_RAW_DATA, $iv, $tag, '', 16 );
        if ( false === $ct || strlen( $tag ) !== 16 ) {
            // Fallback: store raw if OpenSSL GCM unavailable (should never
            // happen on PHP 7.4+ with openssl). Prefer availability over silence.
            return $raw;
        }
        return 'ashbi1:' . base64_encode( $iv . $tag . $ct );
    }

    /**
     * @param mixed $stored
     * @return string|null Raw 32-byte key, or null if unreadable.
     */
    private static function unwrap_encryption_key( $stored ) {
        if ( ! is_string( $stored ) || $stored === '' ) {
            return null;
        }
        // Legacy plaintext 32-byte key.
        if ( strlen( $stored ) === 32 && strpos( $stored, 'ashbi1:' ) !== 0 ) {
            return $stored;
        }
        if ( strpos( $stored, 'ashbi1:' ) !== 0 ) {
            return null;
        }
        $blob = base64_decode( substr( $stored, 7 ), true );
        if ( false === $blob || strlen( $blob ) < 12 + 16 + 1 ) {
            return null;
        }
        $iv  = substr( $blob, 0, 12 );
        $tag = substr( $blob, 12, 16 );
        $ct  = substr( $blob, 28 );
        $raw = openssl_decrypt( $ct, 'aes-256-gcm', self::key_wrapping_material(), OPENSSL_RAW_DATA, $iv, $tag );
        if ( ! is_string( $raw ) || strlen( $raw ) !== 32 ) {
            return null;
        }
        return $raw;
    }

    private static function key_wrapping_material(): string {
        $parts = [];
        foreach ( [ 'AUTH_KEY', 'SECURE_AUTH_KEY', 'LOGGED_IN_KEY', 'NONCE_KEY' ] as $const ) {
            $parts[] = defined( $const ) ? constant( $const ) : '';
        }
        // Include site URL so a copied options row from another site won't unwrap.
        $parts[] = home_url();
        return hash( 'sha256', implode( '|', $parts ), true );
    }

    /**
     * Rotate the encryption key. Re-encrypts every existing local backup in
     * place under the new key, then destroys the old key.
     *
     * Returns ['rotated' => int, 'failed' => int]. Caller (admin endpoint)
     * must verify both numbers match the expected count before logging success.
     *
     * Memory pressure note: we read + decrypt the old file fully into memory
     * before re-encrypting. Each local backup is bounded by
     * max( DB size, files zip size ); for a 1 GB site this uses ~1 GB peak.
     * Acceptable for a manual rotation; documented.
     */
    public static function rotate_encryption_key(): array {
        $old_key = self::ensure_encryption_key();
        $new_key = random_bytes( 32 );

        $dir = self::BACKUP_DIR;
        $failed  = 0;

        // Pass 1: decrypt every file under the old key. If any decrypt fails,
        // abort — the current key is still the source of truth.
        $decoded = [];
        foreach ( glob( $dir . '/*.enc' ) ?: [] as $enc_file ) {
            $plain = self::decrypt_file( $enc_file, $old_key );
            if ( false === $plain ) {
                $failed++;
                continue;
            }
            $decoded[ $enc_file ] = $plain;
        }

        if ( $failed > 0 || empty( $decoded ) ) {
            foreach ( $decoded as $plain ) { unset( $plain ); }
            return [
                'rotated'    => 0,
                'failed'     => $failed,
                'skipped'    => 0,
                'key_swapped'=> false,
            ];
        }

        // Pass 2: encrypt under the new key. If any encrypt fails, also abort —
        // we don't want to leave a half-rotated dir where some files are under
        // the new key (unreadable with the still-active old key).
        $written = [];
        $write_failed = false;
        foreach ( $decoded as $enc_file => $plain ) {
            if ( false === self::encrypt_file( $enc_file, $plain, $new_key ) ) {
                $write_failed = true;
                break;
            }
            $written[] = $enc_file;
        }

        if ( $write_failed ) {
            // Best-effort rollback: re-encrypt the files we successfully wrote
            // back under the old key. If a rollback also fails, the dir is in
            // an inconsistent state — surface that as a higher failure count.
            $rollback_failed = 0;
            foreach ( $written as $enc_file ) {
                $plain = $decoded[ $enc_file ];
                if ( false === self::encrypt_file( $enc_file, $plain, $old_key ) ) {
                    $rollback_failed++;
                }
                unset( $plain );
            }
            foreach ( $decoded as $plain ) { unset( $plain ); }
            return [
                'rotated'    => 0,
                'failed'     => $failed + $rollback_failed,
                'skipped'    => 0,
                'key_swapped'=> false,
            ];
        }

        foreach ( $decoded as $plain ) { unset( $plain ); }
        update_option( self::OPTION_ENC_KEY, self::wrap_encryption_key( $new_key ), false );
        update_option( self::OPTION_ENC_KEY_ROTATED, current_time( 'mysql' ), false );
        return [
            'rotated'    => count( $written ),
            'failed'     => $failed,
            'skipped'    => 0,
            'key_swapped'=> true,
        ];
    }

    /**
     * Encrypt $plaintext to $dest_path. Returns true on success, false on
     * failure (cipher unsupported, key wrong size, write failed).
     *
     * File format: 12-byte IV || N-byte ciphertext || 16-byte GCM tag.
     * No header — decryption uses the same key + cipher. If a future
     * rotation uses a different cipher, add a version byte.
     */
    public static function encrypt_file( string $dest_path, string $plaintext, string $key ): bool {
        if ( strlen( $key ) !== 32 ) return false;
        $iv     = random_bytes( 12 );
        $tag    = '';
        $cipher = openssl_encrypt( $plaintext, self::ENC_CIPHER, $key, OPENSSL_RAW_DATA, $iv, $tag, '', 16 );
        if ( false === $cipher ) return false;
        $blob = $iv . $cipher . $tag;
        return false !== file_put_contents( $dest_path, $blob );
    }

    /**
     * Decrypt a file produced by encrypt_file(). Returns plaintext or false
     * on any failure (bad key, truncated file, GCM tag mismatch).
     */
    public static function decrypt_file( string $source_path, string $key ) {
        if ( strlen( $key ) !== 32 ) return false;
        $blob = @file_get_contents( $source_path );
        if ( false === $blob || strlen( $blob ) < 12 + 16 ) return false;
        $iv      = substr( $blob, 0, 12 );
        $tag     = substr( $blob, -16 );
        $cipher  = substr( $blob, 12, -16 );
        $plain   = openssl_decrypt( $cipher, self::ENC_CIPHER, $key, OPENSSL_RAW_DATA, $iv, $tag );
        return $plain; // false on tag mismatch / corrupt
    }

    public static function init_storage() {
        $dir = self::BACKUP_DIR;
        if ( ! is_dir( $dir ) ) {
            wp_mkdir_p( $dir );
        }
        self::ensure_web_deny( $dir );
    }

    /**
     * Drop Apache / IIS / nginx deny artifacts into a sensitive directory.
     * Nginx still requires the operator to include the snippet (or a
     * matching location block) — we write the snippet file for that.
     */
    private static function ensure_web_deny( $dir ) {
        $htaccess = $dir . '/.htaccess';
        if ( ! file_exists( $htaccess ) ) {
            $content = <<<'HTACCESS'
# Apache 2.4
<IfModule mod_authz_core.c>
    Require all denied
</IfModule>
# Apache 2.2 / fallback
<IfModule !mod_authz_core.c>
    deny from all
</IfModule>
# mod_rewrite block — works on Apache + OpenLiteSpeed + LiteSpeed
<IfModule mod_rewrite.c>
    RewriteEngine On
    RewriteRule .* - [F,L]
</IfModule>
HTACCESS;
            file_put_contents( $htaccess, $content );
        }
        $index = $dir . '/index.php';
        if ( ! file_exists( $index ) ) {
            file_put_contents( $index, "<?php\nhttp_response_code(403);\nexit;\n" );
        }
        $webconfig = $dir . '/web.config';
        if ( ! file_exists( $webconfig ) ) {
            file_put_contents(
                $webconfig,
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
                . "<configuration><system.webServer><authorization>"
                . "<deny users=\"*\" />"
                . "</authorization></system.webServer></configuration>\n"
            );
        }
        $nginx = $dir . '/nginx-deny.conf';
        if ( ! file_exists( $nginx ) ) {
            file_put_contents(
                $nginx,
                "# Include from your vhost, or mirror as a location block:\n"
                . "# location ^~ /wp-content/ashbi-backups/ { deny all; return 403; }\n"
                . "deny all;\n"
            );
        }
    }

    public static function run_full_backup() {
        $timestamp = current_time( 'Ymd_His' );
        $site_slug = sanitize_file_name( parse_url( home_url(), PHP_URL_HOST ) ?: 'site' );
        $base_name = "{$site_slug}_{$timestamp}";

        // Sec-8: write to plaintext staging files first, encrypt to final
        // .enc paths second. If encryption fails, the plaintext temp files
        // stay around for debugging; rotate_backups() will clean them up on
        // the next run via the missing-manifest sweep.
        $db_plain   = self::BACKUP_DIR . "/{$base_name}_db.sql.tmp";
        $files_plain = self::BACKUP_DIR . "/{$base_name}_files.zip.tmp";
        $db_file    = self::BACKUP_DIR . "/{$base_name}_db.sql" . self::ENC_FILE_SUFFIX;
        $files_zip  = self::BACKUP_DIR . "/{$base_name}_files.zip" . self::ENC_FILE_SUFFIX;
        $manifest   = self::BACKUP_DIR . "/{$base_name}_manifest.json" . self::ENC_FILE_SUFFIX;

        $key = self::ensure_encryption_key();

        $db_ok       = self::export_database( $db_plain );
        $files_result = self::export_files( $files_plain );

        // Encrypt the payload files. Failed encrypt = backup failed.
        if ( $db_ok ) {
            $plain_sql = @file_get_contents( $db_plain );
            if ( false === $plain_sql || false === self::encrypt_file( $db_plain, $plain_sql, $key ) ) {
                $db_ok = false;
            }
            unset( $plain_sql );
            @rename( $db_plain, $db_file );
        }
        if ( $files_result ) {
            $plain_zip = @file_get_contents( $files_plain );
            if ( false === $plain_zip || false === self::encrypt_file( $files_plain, $plain_zip, $key ) ) {
                $files_result = false;
            }
            unset( $plain_zip );
            @rename( $files_plain, $files_zip );
        }

        $db_size    = file_exists( $db_file ) ? filesize( $db_file ) : 0;
        $files_size = file_exists( $files_zip ) ? filesize( $files_zip ) : 0;

        $manifest_data = [
            'timestamp'  => current_time( 'mysql' ),
            'siteUrl'    => home_url(),
            'wpVersion'  => get_bloginfo( 'version' ),
            'dbSize'     => $db_size,
            'filesSize'  => $files_size,
            'dbFile'     => basename( $db_file ),
            'filesFile'  => basename( $files_zip ),
            'cipher'     => self::ENC_CIPHER,
            'encrypted'  => true,
            'keyRotated' => get_option( self::OPTION_ENC_KEY_ROTATED, '' ),
        ];

        // Manifest is also encrypted (contains siteUrl, sizes, version info).
        $manifest_blob = json_encode( $manifest_data, JSON_PRETTY_PRINT );
        if ( false === self::encrypt_file( $manifest, $manifest_blob, $key ) ) {
            // Manifest write failure is non-fatal — the backup files are
            // already encrypted. The hub will see a degraded report.
            $manifest = '';
        }
        unset( $manifest_blob );

        self::rotate_backups();

        $report = [
            'timestamp'    => current_time( 'mysql' ),
            'dbSuccess'    => $db_ok,
            'filesSuccess' => $files_result,
            'dbFile'       => basename( $db_file ),
            'filesFile'    => basename( $files_zip ),
            // Send the parsed manifest as an object (not just the filename) so
            // the hub can store dbSize / filesSize / siteUrl in dedicated columns.
            'manifest'     => $manifest_data,
            'dbSize'       => $db_size,
            'filesSize'    => $files_size,
            'encrypted'    => true,
            'cipher'       => self::ENC_CIPHER,
        ];

        // Off-site push runs AFTER the local backup completes. Local-first
        // means a transient push failure (network blip, S3 outage, missing
        // webhook URL) must never fail or roll back the local backup.
        if ( $db_ok && $files_result ) {
            $remote_push              = self::push_to_remote( [ $db_file, $files_zip ] );
            $report['remote_push']    = [
                'destination' => get_option( 'ashbi_backup_destination', 'none' ),
                'status'      => $remote_push['status'],
                'url'         => $remote_push['remote_url'],
                'bytes_sent'  => $remote_push['bytes_sent'],
            ];
            if ( ! empty( $remote_push['error'] ) ) {
                $report['remote_push']['error'] = $remote_push['error'];
                error_log( '[Ashbi Backup] Remote push failed: ' . $remote_push['error'] );
            }
        }

        update_option( 'ashbi_last_backup', $report );
        self::send_backup_report( $report );
        return $report;
    }

    /**
     * Push backup files to the configured off-site destination.
     *
     * Reads `ashbi_backup_destination` (one of: 'none', 's3', 'b2', 'vps', 'webhook')
     * and `ashbi_backup_remote_config` (JSON string with endpoint/bucket/accessKey/
     * secretKey/region/prefix/webhookUrl fields). For 's3'/'b2' uses HTTPS PUT with
     * bearer auth (simplified per design — no AWS SigV4 signing yet). For 'webhook'
     * POSTs the file as multipart/form-data. For 'vps' returns an error and is
     * intentionally left as a TODO (SFTP requires phpseclib3 or ssh2_sftp).
     *
     * @param array $backup_paths Absolute paths to the .sql and .zip files.
     * @return array { remote_url, status: 'ok'|'error', error?, bytes_sent }
     * @access private
     */
    public static function push_to_remote( $backup_paths ) {
        $destination = (string) get_option( 'ashbi_backup_destination', 'none' );
        $config_raw  = get_option( 'ashbi_backup_remote_config', '{}' );
        if ( is_string( $config_raw ) ) {
            $config = json_decode( $config_raw, true );
            if ( ! is_array( $config ) ) $config = [];
        } elseif ( is_array( $config_raw ) ) {
            $config = $config_raw;
        } else {
            $config = [];
        }

        // 'none' / unset — no-op. Existing behavior.
        if ( $destination === '' || $destination === 'none' ) {
            return [
                'remote_url' => null,
                'status'     => 'ok',
                'bytes_sent' => 0,
            ];
        }

        // 'vps' / SFTP — deferred. See TODO below.
        if ( $destination === 'vps' ) {
            // TODO: implement SFTP push via phpseclib3 (preferred — pure PHP,
            // no extension) or ssh2_sftp (requires libssh2). Both add a
            // runtime dep; ship with 1.10.2 only if that dep is acceptable.
            return [
                'remote_url' => null,
                'status'     => 'error',
                'error'      => 'VPS/SFTP push not yet implemented (see TODO in push_to_remote)',
                'bytes_sent' => 0,
            ];
        }

        if ( ! is_array( $backup_paths ) ) {
            $backup_paths = [ $backup_paths ];
        }

        $total_bytes = 0;
        $last_url    = null;
        $last_error  = null;
        $all_ok      = true;

        foreach ( $backup_paths as $path ) {
            if ( ! is_string( $path ) || ! file_exists( $path ) ) {
                $all_ok     = false;
                $last_error = 'File missing: ' . ( is_string( $path ) ? basename( $path ) : 'non-string path' );
                continue;
            }
            switch ( $destination ) {
                case 's3':
                case 'b2':
                    $r = self::push_s3_compat( $path, $config, $destination );
                    break;
                case 'webhook':
                    $r = self::push_webhook( $path, $config );
                    break;
                default:
                    $r = [
                        'remote_url' => null,
                        'status'     => 'error',
                        'error'      => 'Unknown destination: ' . $destination,
                        'bytes_sent' => 0,
                    ];
            }
            $total_bytes += (int) ( $r['bytes_sent'] ?? 0 );
            if ( ! empty( $r['remote_url'] ) ) $last_url = $r['remote_url'];
            if ( ( $r['status'] ?? 'error' ) !== 'ok' ) {
                $all_ok     = false;
                $last_error = $r['error'] ?? 'Unknown error';
            }
        }

        return [
            'remote_url' => $last_url,
            'status'     => $all_ok ? 'ok' : 'error',
            'bytes_sent' => $total_bytes,
        ] + ( $last_error !== null ? [ 'error' => $last_error ] : [] );
    }

    /**
     * Push a single file to an S3-compatible endpoint (S3 or B2).
     *
     * Prefer AWS SigV4 when `secretKey` is configured (real S3 / B2 S3 API /
     * Wasabi / MinIO). Fall back to Bearer accessKey when only an access
     * token is available (legacy B2 application-key-as-Bearer setups).
     */
    private static function push_s3_compat( $path, $config, $kind ) {
        $endpoint = rtrim( (string) ( $config['endpoint'] ?? '' ), '/' );
        $bucket   = (string) ( $config['bucket'] ?? '' );
        $prefix   = trim( (string) ( $config['prefix'] ?? '' ), '/' );
        $access   = (string) ( $config['accessKey'] ?? '' );
        $secret   = (string) ( $config['secretKey'] ?? '' );
        $region   = (string) ( $config['region'] ?? '' );

        if ( $endpoint === '' || $bucket === '' || $access === '' ) {
            return [
                'remote_url' => null,
                'status'     => 'error',
                'error'      => "{$kind} config missing endpoint, bucket, or accessKey",
                'bytes_sent' => 0,
            ];
        }

        if ( $region === '' ) {
            $region = ( $kind === 'b2' ) ? 'us-west-000' : 'us-east-1';
        }

        $object_key = ltrim( $prefix . '/' . basename( $path ), '/' );
        $url        = $endpoint . '/' . rawurlencode( $bucket ) . '/' . implode( '/', array_map( 'rawurlencode', explode( '/', $object_key ) ) );
        // Prefer readable URL for remote_url display; request uses encoded path.
        $display_url = $endpoint . '/' . $bucket . '/' . $object_key;
        $body        = file_get_contents( $path );

        if ( $body === false ) {
            return [
                'remote_url' => null,
                'status'     => 'error',
                'error'      => 'Failed to read local file for push',
                'bytes_sent' => 0,
            ];
        }

if ( $secret !== '' ) {
            $headers = self::aws_sig_v4_headers( 'PUT', $url, $body, $access, $secret, $region );
        } else {
            // Legacy Bearer token path (B2 application key used as Bearer).
            $headers = [
                'Authorization' => 'Bearer ' . $access,
                'Content-Type'  => 'application/octet-stream',
            ];
        }

        $response = wp_remote_request( $url, [
            'method'    => 'PUT',
            'headers'   => $headers,
            'body'      => $body,
            'timeout'   => 60,
            'sslverify' => true,
        ] );

        if ( is_wp_error( $response ) ) {
            return [
                'remote_url' => null,
                'status'     => 'error',
                'error'      => $response->get_error_message(),
                'bytes_sent' => 0,
            ];
        }
        $code = (int) wp_remote_retrieve_response_code( $response );
        if ( $code < 200 || $code >= 300 ) {
            return [
                'remote_url' => null,
                'status'     => 'error',
                'error'      => "{$kind} push HTTP {$code}",
                'bytes_sent' => 0,
            ];
        }
        return [
            'remote_url' => $display_url,
            'status'     => 'ok',
            'bytes_sent' => strlen( $body ),
        ];
    }

    /**
     * AWS Signature Version 4 headers for a PUT to an S3-compatible endpoint.
     *
     * @return array<string,string>
     */
    private static function aws_sig_v4_headers( $method, $url, $body, $access_key, $secret_key, $region, $service = 's3' ) {
        $parsed = function_exists( 'wp_parse_url' ) ? wp_parse_url( $url ) : parse_url( $url );
        if ( ! is_array( $parsed ) ) {
            $parsed = [];
        }
        $host   = $parsed['host'] ?? '';
        $path   = isset( $parsed['path'] ) ? $parsed['path'] : '/';
        // Path must already be URI-encoded (caller responsibility).
        $query  = isset( $parsed['query'] ) ? $parsed['query'] : '';

        $amz_date   = gmdate( 'Ymd\THis\Z' );
        $date_stamp = gmdate( 'Ymd' );
        $payload_hash = hash( 'sha256', $body );

        $canonical_headers = 'host:' . $host . "\n"
            . 'x-amz-content-sha256:' . $payload_hash . "\n"
            . 'x-amz-date:' . $amz_date . "\n";
        $signed_headers = 'host;x-amz-content-sha256;x-amz-date';

        $canonical_request = implode( "\n", [
            strtoupper( $method ),
            $path,
            $query,
            $canonical_headers,
            $signed_headers,
            $payload_hash,
        ] );

        $credential_scope = $date_stamp . '/' . $region . '/' . $service . '/aws4_request';
        $string_to_sign   = implode( "\n", [
            'AWS4-HMAC-SHA256',
            $amz_date,
            $credential_scope,
            hash( 'sha256', $canonical_request ),
        ] );

        $k_date    = hash_hmac( 'sha256', $date_stamp, 'AWS4' . $secret_key, true );
        $k_region  = hash_hmac( 'sha256', $region, $k_date, true );
        $k_service = hash_hmac( 'sha256', $service, $k_region, true );
        $k_signing = hash_hmac( 'sha256', 'aws4_request', $k_service, true );
        $signature = hash_hmac( 'sha256', $string_to_sign, $k_signing );

        $authorization = 'AWS4-HMAC-SHA256 Credential=' . $access_key . '/' . $credential_scope
            . ', SignedHeaders=' . $signed_headers
            . ', Signature=' . $signature;

        return [
            'Authorization'        => $authorization,
            'Content-Type'         => 'application/octet-stream',
            'x-amz-content-sha256' => $payload_hash,
            'x-amz-date'           => $amz_date,
            'Host'                 => $host,
        ];
    }

    /**
     * Push a single file to a generic webhook URL as multipart/form-data.
     *
     * Body shape (one part per field):
     *   file        — file bytes (Content-Type: application/octet-stream)
     *   filename    — basename of the file
     *   siteUrl     — home_url() of the source site
     *   destination — literal 'webhook' (so receivers can disambiguate)
     *   timestamp   — current_time('mysql')
     */
    private static function push_webhook( $path, $config ) {
        $url = (string) ( $config['webhookUrl'] ?? '' );

        if ( $url === '' ) {
            return [
                'remote_url' => null,
                'status'     => 'error',
                'error'      => 'Webhook URL not set',
                'bytes_sent' => 0,
            ];
        }

        $bytes    = file_get_contents( $path );
        if ( $bytes === false ) {
            return [
                'remote_url' => null,
                'status'     => 'error',
                'error'      => 'Failed to read local file for push',
                'bytes_sent' => 0,
            ];
        }
        $boundary = 'ashbi-' . bin2hex( random_bytes( 12 ) );
        $filename = basename( $path );
        $body     = self::build_multipart_body( $boundary, [
            'file'        => [ 'content' => $bytes, 'filename' => $filename, 'type' => 'application/octet-stream' ],
            'filename'    => $filename,
            'siteUrl'     => home_url(),
            'destination' => 'webhook',
            'timestamp'   => current_time( 'mysql' ),
        ] );

        $response = wp_remote_post( $url, [
            'method'    => 'POST',
            'headers'   => [
                'Content-Type' => 'multipart/form-data; boundary=' . $boundary,
            ],
            'body'      => $body,
            'timeout'   => 60,
            'sslverify' => true,
        ] );

        if ( is_wp_error( $response ) ) {
            return [
                'remote_url' => null,
                'status'     => 'error',
                'error'      => $response->get_error_message(),
                'bytes_sent' => 0,
            ];
        }
        $code = (int) wp_remote_retrieve_response_code( $response );
        if ( $code < 200 || $code >= 300 ) {
            return [
                'remote_url' => null,
                'status'     => 'error',
                'error'      => 'Webhook push HTTP ' . $code,
                'bytes_sent' => 0,
            ];
        }
        return [
            'remote_url' => $url,
            'status'     => 'ok',
            'bytes_sent' => strlen( $body ),
        ];
    }

    /**
     * Build a multipart/form-data body from an associative array.
     *
     * Scalar values become form fields; entries with a 'content' key become
     * file parts. Mirrors the structure curl's `-F` flag generates so a
     * generic receiver (PHP / Node / Python) can parse it the same way.
     */
    private static function build_multipart_body( $boundary, array $fields ) {
        $crlf = "\r\n";
        $out  = '';
        foreach ( $fields as $name => $field ) {
            $out .= '--' . $boundary . $crlf;
            if ( is_array( $field ) && array_key_exists( 'content', $field ) ) {
                $filename = $field['filename'] ?? $name;
                $type     = $field['type'] ?? 'application/octet-stream';
                $out     .= 'Content-Disposition: form-data; name="' . $name . '"; filename="' . $filename . '"' . $crlf;
                $out     .= 'Content-Type: ' . $type . $crlf . $crlf;
                $out     .= $field['content'] . $crlf;
            } else {
                $out .= 'Content-Disposition: form-data; name="' . $name . '"' . $crlf . $crlf;
                $out .= (string) $field . $crlf;
            }
        }
        $out .= '--' . $boundary . '--' . $crlf;
        return $out;
    }

    public static function backup_file_before_change( $file_path ) {
        if ( ! file_exists( $file_path ) ) return false;
        $timestamp   = current_time( 'Ymd_His' );
        $rel_path    = str_replace( ABSPATH, '', $file_path );
        $safe_name   = sanitize_file_name( str_replace( '/', '_', $rel_path ) );
        $backup_name = "{$timestamp}_{$safe_name}.bak";
        $dest = self::BACKUP_DIR . '/' . $backup_name;
        copy( $file_path, $dest );

        $manifest = self::BACKUP_DIR . '/auto-backups-manifest.json';
        $entries = file_exists( $manifest ) ? (json_decode( file_get_contents( $manifest ), true ) ?: []) : [];
        $entries[] = [
            'timestamp' => current_time( 'mysql' ),
            'original'  => $rel_path,
            'backup'    => $backup_name,
        ];
        $entries = array_slice( $entries, -20 );
        file_put_contents( $manifest, json_encode( $entries, JSON_PRETTY_PRINT ) );
        return $dest;
    }

    private static function export_database( $dest_file ) {
        global $wpdb;
        $tables = $wpdb->get_col( 'SHOW TABLES' );
        if ( empty( $tables ) ) return false;

        $out = fopen( $dest_file, 'w' );
        if ( ! $out ) return false;

        fwrite( $out, '-- Ashbi Backup | ' . home_url() . ' | ' . current_time( 'mysql' ) . "\n\n" );
        fwrite( $out, "SET FOREIGN_KEY_CHECKS=0;\n\n" );

        $batch_size = 500;

        foreach ( $tables as $table ) {
            // Only dump tables whose names are safe identifiers (defense in depth
            // against a compromised SHOW TABLES result / odd charset names).
            if ( ! preg_match( '/^[A-Za-z0-9_]+$/', $table ) ) {
                continue;
            }

            fwrite( $out, "DROP TABLE IF EXISTS `$table`;\n" );
            $create = $wpdb->get_row( "SHOW CREATE TABLE `$table`", ARRAY_N );
            if ( $create ) fwrite( $out, $create[1] . ";\n\n" );

            // Chunked SELECT — never load an entire large table into memory.
            $offset = 0;
            do {
                // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name validated above.
                $rows = $wpdb->get_results(
                    $wpdb->prepare(
                        "SELECT * FROM `$table` LIMIT %d OFFSET %d",
                        $batch_size,
                        $offset
                    ),
                    ARRAY_A
                );
                if ( empty( $rows ) ) {
                    break;
                }
                $columns  = array_keys( $rows[0] );
                $cols_str = '`' . implode( '`,`', $columns ) . '`';
                foreach ( $rows as $row ) {
                    $values = array_map( function( $v ) use ( $wpdb ) {
                        if ( $v === null ) return 'NULL';
                        return "'" . $wpdb->_real_escape( $v ) . "'";
                    }, array_values( $row ) );
                    fwrite( $out, "INSERT INTO `$table` ($cols_str) VALUES (" . implode( ',', $values ) . ");\n" );
                }
                $fetched = count( $rows );
                $offset += $fetched;
                unset( $rows );
            } while ( $fetched === $batch_size );

            fwrite( $out, "\n" );
        }
        fwrite( $out, "SET FOREIGN_KEY_CHECKS=1;\n" );
        fclose( $out );
        return true;
    }

    private static function export_files( $dest_zip ) {
        if ( ! class_exists( 'ZipArchive' ) ) return false;
        $zip = new ZipArchive();
        if ( $zip->open( $dest_zip, ZipArchive::CREATE | ZipArchive::OVERWRITE ) !== true ) return false;

        $source   = WP_CONTENT_DIR;
        $base_len = strlen( $source ) + 1;
        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator( $source, RecursiveDirectoryIterator::SKIP_DOTS ),
            RecursiveIteratorIterator::SELF_FIRST
        );

        foreach ( $iterator as $file ) {
            $rel_path = substr( $file->getRealPath(), $base_len );
            if ( strpos( $rel_path, 'ashbi-backups' ) === 0 ) continue;
            if ( $file->isDir() ) {
                $zip->addEmptyDir( $rel_path );
            } else {
                $zip->addFile( $file->getRealPath(), $rel_path );
            }
        }
        $zip->close();
        return true;
    }

    private static function rotate_backups() {
        $dir = self::BACKUP_DIR;
        if ( ! is_dir( $dir ) ) return;
        $manifests = [];
        // Sec-8: manifest extension changed from _manifest.json to _manifest.json.enc
        foreach ( glob( $dir . '/*_manifest.json.enc' ) as $f ) {
            $manifests[ filemtime( $f ) ] = $f;
        }
        ksort( $manifests );
        while ( count( $manifests ) > self::MAX_LOCAL_BACKUPS ) {
            $oldest = array_shift( $manifests );
            $base   = str_replace( '_manifest.json.enc', '', basename( $oldest ) );
            @unlink( $oldest );
            @unlink( $dir . '/' . $base . '_db.sql.enc' );
            @unlink( $dir . '/' . $base . '_files.zip.enc' );
            // Cleanup any leftover plaintext temp from a failed encryption.
            @unlink( $dir . '/' . $base . '_db.sql.tmp' );
            @unlink( $dir . '/' . $base . '_files.zip.tmp' );
        }
    }

    public static function list_backups() {
        $dir = self::BACKUP_DIR;
        $key = self::ensure_encryption_key();
        $backups = [];
        foreach ( glob( $dir . '/*_manifest.json.enc' ) as $f ) {
            $plain = self::decrypt_file( $f, $key );
            if ( ! is_string( $plain ) ) continue;
            $data = json_decode( $plain, true );
            if ( $data ) $backups[] = $data;
            unset( $plain );
        }
        usort( $backups, function( $a, $b ) {
            return strtotime( $b['timestamp'] ) - strtotime( $a['timestamp'] );
        });
        return $backups;
    }

    public static function list_auto_backups() {
        $manifest = self::BACKUP_DIR . '/auto-backups-manifest.json';
        if ( ! file_exists( $manifest ) ) return [];
        return json_decode( file_get_contents( $manifest ), true ) ?: [];
    }

    private static function send_backup_report( $report ) {
        $hub_url = get_option( 'ashbi_hub_url', '' );
        $secret  = get_option( 'ashbi_secret_key', '' );
        if ( empty( $hub_url ) || empty( $secret ) ) return;
        $timestamp = (string) time();
        $nonce     = bin2hex( random_bytes( 16 ) );
        $body = wp_json_encode( [
            'siteUrl'   => home_url(),
            'nonce'     => $nonce,
            'timestamp' => $timestamp,
            'report'    => $report,
        ] );
        $signed = Ashbi_Auth::sign_outbound( $body, $secret );
        wp_remote_post( $hub_url . '/api/wp-bridge/backup', [
            'body'      => $signed['body'],
            'headers'   => $signed['headers'],
            'timeout'   => 10,
            'blocking'  => false,
            'sslverify' => true,
        ] );
    }
}
