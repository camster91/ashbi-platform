<?php
/**
 * Ashbi Logger
 *
 * @package Ashbi_Agency_WP_Bridge
 */

if ( ! defined( 'ABSPATH' ) ) exit;

class Ashbi_Logger {
    public static function log( $request_path, $payload, $status ) {
        $log_dir = ( defined( 'WP_CONTENT_DIR' ) ? WP_CONTENT_DIR : ABSPATH . 'wp-content' ) . '/uploads/ashbi_agency';

        if ( ! file_exists( $log_dir ) ) {
            wp_mkdir_p( $log_dir );
        }

        // Hardening for Apache + IIS. Nginx operators must deny this path in
        // the vhost (uploads/ashbi_agency/). Filename is unguessable.
        self::ensure_web_deny( $log_dir );

        $log_file = $log_dir . '/' . self::log_basename();

        // Log Rotation: If > 5MB, move to .old and start fresh.
        if ( file_exists( $log_file ) && filesize( $log_file ) > 5 * 1024 * 1024 ) {
            rename( $log_file, $log_file . '.old' );
        }

        // Never persist raw secrets if a caller accidentally passes them.
        $safe_payload = self::redact( $payload );

        $entry = sprintf(
            "[%s] PATH: %s | PAYLOAD: %s | STATUS: %s\n",
            gmdate( 'Y-m-d H:i:s' ),
            $request_path,
            wp_json_encode( $safe_payload ),
            $status
        );
        file_put_contents( $log_file, $entry, FILE_APPEND | LOCK_EX );
    }

    /**
     * Unguessable log basename, persisted in an option so rotation keeps
     * writing to the same file within a site lifetime.
     */
    private static function log_basename() {
        $token = get_option( 'ashbi_log_file_token', '' );
        if ( ! is_string( $token ) || ! preg_match( '/^[a-f0-9]{32}$/', $token ) ) {
            $token = bin2hex( random_bytes( 16 ) );
            update_option( 'ashbi_log_file_token', $token, false );
        }
        return 'audit-' . $token . '.log';
    }

    private static function ensure_web_deny( $log_dir ) {
        $htaccess = $log_dir . '/.htaccess';
        if ( ! file_exists( $htaccess ) ) {
            file_put_contents( $htaccess, "Require all denied\nDeny from all\n" );
        }
        $index = $log_dir . '/index.php';
        if ( ! file_exists( $index ) ) {
            file_put_contents( $index, "<?php\nhttp_response_code(403);\nexit;\n" );
        }
        $webconfig = $log_dir . '/web.config';
        if ( ! file_exists( $webconfig ) ) {
            file_put_contents(
                $webconfig,
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
                . "<configuration><system.webServer><authorization>"
                . "<deny users=\"*\" />"
                . "</authorization></system.webServer></configuration>\n"
            );
        }
        $nginx = $log_dir . '/nginx-deny.conf';
        if ( ! file_exists( $nginx ) ) {
            file_put_contents(
                $nginx,
                "# Include from your vhost, or mirror as a location block:\n"
                . "# location ^~ /wp-content/uploads/ashbi_agency/ { deny all; return 403; }\n"
                . "deny all;\n"
            );
        }
    }

    /**
     * Strip known secret-bearing keys from logged payloads.
     *
     * @param mixed $payload
     * @return mixed
     */
    private static function redact( $payload ) {
        if ( ! is_array( $payload ) ) {
            return $payload;
        }
        $sensitive = [
            'apiKey', 'api_key', 'secretKey', 'secret_key', 'password',
            'token', 'accessKey', 'access_key', 'Authorization',
        ];
        $out = [];
        foreach ( $payload as $k => $v ) {
            if ( in_array( (string) $k, $sensitive, true ) ) {
                $out[ $k ] = '[redacted]';
            } elseif ( is_array( $v ) ) {
                $out[ $k ] = self::redact( $v );
            } else {
                $out[ $k ] = $v;
            }
        }
        return $out;
    }
}
