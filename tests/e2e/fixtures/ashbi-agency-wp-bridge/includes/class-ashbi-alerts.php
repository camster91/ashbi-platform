<?php
/**
 * Alerts Class - handles new admin registration alerts.
 *
 * @package Ashbi_Agency_WP_Bridge
 */

if ( ! defined( 'ABSPATH' ) ) exit;

class Ashbi_Alerts {
    private static $hub_url    = '';
    private static $api_key    = '';
    private static $secret_key = '';

    public static function init() {
        self::$hub_url    = get_option( 'ashbi_hub_url', '' );
        self::$api_key    = get_option( 'ashbi_api_key', '' );
        self::$secret_key = get_option( 'ashbi_secret_key', '' );

        if ( empty( self::$hub_url ) || empty( self::$api_key ) || empty( self::$secret_key ) ) {
            return;
        }

        // Alert on new admin user creation
        add_action( 'user_register', [ self::class, 'on_new_admin' ], 10, 2 );
        add_action( 'profile_update', [ self::class, 'on_admin_promoted' ], 10, 2 );
    }

    public static function send_alert( $alert_type, $details ) {
        if ( empty( self::$hub_url ) || empty( self::$api_key ) ) {
            return;
        }

        // Guard against empty secret key
        if ( empty( self::$secret_key ) ) {
            return;
        }

        $timestamp = (string) time();
        $body      = wp_json_encode( [
            'siteUrl'   => home_url(),
            'alertType' => $alert_type,
            'timestamp' => $timestamp,
            'details'   => $details,
        ] );
        // Hub-bound writes use the per-site nonce-aware canonical format.
        $signed = Ashbi_Auth::sign_outbound( $body, self::$secret_key );

        wp_remote_post( self::$hub_url . '/api/wp-bridge/alert', [
            'body'      => $signed['body'],
            'headers'   => $signed['headers'],
            'timeout'   => 10,
            'blocking'  => false,
            'sslverify' => true,
        ] );

        // Also forward to Slack and/or Telegram if configured (Agency tier feature)
        self::forward_to_slack( $alert_type, $details );
        self::forward_to_telegram( $alert_type, $details );
    }

    /**
     * Forward an alert to a Slack incoming webhook if configured.
     * Slack webhook URL stored in 'ashbi_alert_slack' option.
     */
    public static function forward_to_slack( $alert_type, $details ) {
        $webhook = get_option( 'ashbi_alert_slack', '' );
        if ( empty( $webhook ) || ! filter_var( $webhook, FILTER_VALIDATE_URL ) ) return;

        $text = self::format_alert_text( $alert_type, $details, 'Slack' );
        $payload = wp_json_encode( [ 'text' => $text ] );

        wp_remote_post( $webhook, [
            'body'      => $payload,
            'headers'   => [ 'Content-Type' => 'application/json' ],
            'timeout'   => 10,
            'blocking'  => false,
            'sslverify' => true,
        ] );
    }

    /**
     * Forward an alert to a Telegram bot chat via the Bot API if configured.
     * Bot token stored in 'ashbi_alert_telegram_token', chat ID in
     * 'ashbi_alert_telegram_chat_id'.
     */
    public static function forward_to_telegram( $alert_type, $details ) {
        $token  = get_option( 'ashbi_alert_telegram_token', '' );
        $chat   = get_option( 'ashbi_alert_telegram_chat_id', '' );
        if ( empty( $token ) || empty( $chat ) ) return;

        $text  = self::format_alert_text( $alert_type, $details, 'Telegram' );
        $url   = "https://api.telegram.org/bot{$token}/sendMessage";
        $body  = wp_json_encode( [
            'chat_id'    => $chat,
            'text'       => $text,
            'parse_mode' => 'HTML',
        ] );

        wp_remote_post( $url, [
            'body'      => $body,
            'headers'   => [ 'Content-Type' => 'application/json' ],
            'timeout'   => 10,
            'blocking'  => false,
            'sslverify' => true,
        ] );
    }

    /**
     * Build a human-readable alert text for chat platforms.
     */
    private static function format_alert_text( $alert_type, $details, $platform ) {
        $site = parse_url( home_url(), PHP_URL_HOST );
        $emoji = [
            'new_admin'         => '👤',
            'admin_promoted'    => '⬆️',
            'security_event'     => '🔒',
            'broken_links'       => '🔗',
            'backup_failed'      => '💾',
            'ssl_expiring'       => '🛡️',
        ];
        $icon = $emoji[ $alert_type ] ?? '⚠️';
        $details_str = is_array( $details ) ? wp_json_encode( $details ) : (string) $details;
        return sprintf( "%s <b>%s</b> on <i>%s</i>\n%s", $icon, str_replace( '_', ' ', $alert_type ), $site, $details_str );
    }

    public static function on_new_admin( $user_id, $data = [] ) {
        $user = get_userdata( $user_id );
        if ( ! $user || ! in_array( 'administrator', $user->roles ) ) {
            return;
        }

        self::send_alert( 'new_admin', [
            'user'  => $user->user_login,
            'email' => $user->user_email,
            'ip'    => isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( $_SERVER['REMOTE_ADDR'] ) : '',
        ] );
    }

    public static function on_admin_promoted( $user_id, $old_data = null ) {
        $user = get_userdata( $user_id );
        if ( ! $user || ! in_array( 'administrator', $user->roles ) ) {
            return;
        }

        // Only alert if the user was not previously an administrator.
        $old_roles = ( $old_data && isset( $old_data->roles ) ) ? $old_data->roles : [];
        if ( in_array( 'administrator', $old_roles ) ) {
            return;
        }

        self::send_alert( 'admin_promoted', [
            'user'  => $user->user_login,
            'email'  => $user->user_email,
            'note'   => 'Admin role granted via profile update',
        ] );
    }
}
