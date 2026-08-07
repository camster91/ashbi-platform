<?php
// includes/class-ashbi-sso.php
if ( ! defined( 'ABSPATH' ) ) exit;

/**
 * SSO front-door: intercepts ?ashbi_sso=<token> and logs the user in.
 *
 * Token issue / revoke / audit live in Ashbi_Magic_Login. This class only
 * owns the browser-facing consume path and the legacy DB table (kept for
 * hygiene cleanup of pre-unification rows).
 */
class Ashbi_SSO {
    public static function init() {
        add_action( 'init', [ __CLASS__, 'intercept_login' ] );
    }

    public static function create_table() {
        global $wpdb;
        $table_name = $wpdb->prefix . 'ashbi_tokens';
        $charset_collate = $wpdb->get_charset_collate();

        $sql = "CREATE TABLE $table_name (
            id bigint(20) NOT NULL AUTO_INCREMENT,
            token varchar(64) NOT NULL,
            user_id bigint(20) NOT NULL,
            expires_at datetime NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY token (token)
        ) $charset_collate;";

        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta( $sql );
    }

    /**
     * @deprecated 1.12.0 Use Ashbi_Magic_Login::issue(). Kept as a thin
     *             wrapper so any external callers keep working.
     */
    public static function generate_token( $user_id ) {
        $issued = Ashbi_Magic_Login::issue( (int) $user_id, [ 'issued_by' => 'sso_legacy' ] );
        if ( is_wp_error( $issued ) ) {
            return '';
        }
        return $issued['token'];
    }

    public static function intercept_login() {
        if ( empty( $_GET['ashbi_sso'] ) ) return;

        $token = sanitize_text_field( wp_unslash( $_GET['ashbi_sso'] ) );

        $ip        = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '0.0.0.0';
        $ip_key    = 'ashbi_sso_attempts_' . md5( $ip );
        $attempts  = (int) get_transient( $ip_key );
        if ( $attempts >= 5 ) {
            wp_die( 'Too many SSO attempts. Please wait a minute and try again.', 'Login Locked', [ 'response' => 429 ] );
        }
        set_transient( $ip_key, $attempts + 1, MINUTE_IN_SECONDS );

        // Canonical consume path — hashed transient store + single-use + audit.
        $payload = Ashbi_Magic_Login::consume( $token );
        if ( is_wp_error( $payload ) ) {
            // Fall through silently for invalid tokens (don't leak validity),
            // except rate-limit / lock is already applied above.
            return;
        }

        delete_transient( $ip_key );

        $user_id = isset( $payload['user_id'] ) ? (int) $payload['user_id'] : 0;
        $user    = $user_id ? get_userdata( $user_id ) : false;
        if ( ! $user || ! in_array( 'administrator', (array) $user->roles, true ) ) {
            wp_die( 'Login denied: user no longer exists or is not an administrator.', 'Login Failed', [ 'response' => 403 ] );
        }

        wp_set_auth_cookie( $user_id, false, is_ssl() );
        wp_safe_redirect( admin_url() );
        exit;
    }
}
