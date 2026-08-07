<?php
/**
 * Ashbi Hygiene Class v1.6.0
 *
 * Handles automated daily cleanup of post revisions, spam comments, expired transients,
 * broken link scanning, SSL monitoring, and mobile compatibility checks.
 *
 * @package Ashbi_Agency_WP_Bridge
 * @version 1.6.0
 */

if ( ! defined( 'ABSPATH' ) ) exit;

class Ashbi_Hygiene {
    /**
     * Initialize the hygiene module.
     */
    public static function init() {
        if ( ! wp_next_scheduled( 'ashbi_daily_hygiene' ) ) {
            wp_schedule_event( time(), 'daily', 'ashbi_daily_hygiene' );
        }
        add_action( 'ashbi_daily_hygiene', [ __CLASS__, 'run_deep_clean' ] );
        
        // Weekly broken link scan
        if ( ! wp_next_scheduled( 'ashbi_weekly_link_scan' ) ) {
            wp_schedule_event( time(), 'weekly', 'ashbi_weekly_link_scan' );
        }
        add_action( 'ashbi_weekly_link_scan', [ __CLASS__, 'scan_broken_links' ] );
    }

    /**
     * Run deep clean daily.
     */
    public static function run_deep_clean() {
        global $wpdb;
        $counts = [];
        $alerts = [];

        // 1. Revision cleanup (older than 30 days)
        $wpdb->query( "DELETE FROM $wpdb->posts WHERE post_type = 'revision' AND post_date < DATE_SUB(NOW(), INTERVAL 30 DAY)" );
        $counts['revisions'] = (int) $wpdb->rows_affected;

        // 2. Spam comment cleanup
        $wpdb->query( "DELETE FROM $wpdb->comments WHERE comment_approved = 'spam'" );
        $counts['spam_comments'] = (int) $wpdb->rows_affected;

        // 3. Trash cleanup (older than 10 days)
        $wpdb->query( "DELETE FROM $wpdb->posts WHERE post_status = 'trash' AND post_modified < DATE_SUB(NOW(), INTERVAL 10 DAY)" );
        $counts['trash_posts'] = (int) $wpdb->rows_affected;

        // 4. Expired transients
        if ( function_exists('delete_expired_transients') ) {
            delete_expired_transients( true );
        }

        // 5. Expired SSO tokens
        $table = $wpdb->prefix . 'ashbi_tokens';
        if ( $wpdb->get_var( $wpdb->prepare( "SHOW TABLES LIKE %s", $table ) ) === $table ) {
            $wpdb->query( "DELETE FROM $table WHERE expires_at < UTC_TIMESTAMP()" );
            $counts['expired_tokens'] = (int) $wpdb->rows_affected;
        }

        // 6. SSL check
        $ssl_status = self::check_ssl_expiry();
        
        // 7. Comment spam protection setup (ensure settings are locked)
        self::harden_comment_settings();
        
        // 8. Plugin update count
        $counts['plugin_updates'] = self::count_plugin_updates();
        $counts['theme_updates'] = self::count_theme_updates();
        $counts['core_updates'] = self::count_core_updates();

        // Store results
        $report = [
            'timestamp' => current_time( 'mysql' ),
            'counts'    => $counts,
            'ssl'       => $ssl_status,
        ];

        update_option( 'ashbi_last_hygiene', $report );

        // Send to hub if configured
        self::send_report_to_hub( $report );

        return $report;
    }

    /**
     * Scan for broken links on site.
     */
    public static function scan_broken_links() {
        $posts = get_posts([
            'post_type'      => [ 'post', 'page' ],
            'posts_per_page' => 50,
            'post_status'    => 'publish',
            'orderby'        => 'modified',
            'order'          => 'DESC',
            'no_found_rows'  => true,
        ]);

        $results    = [];
        $broken     = [];
        $checked    = 0;
        $max_checks = 100; // hard cap — unbounded HTTP from cron is a DoS footgun

        foreach ( $posts as $post ) {
            if ( $checked >= $max_checks ) {
                break;
            }
            $content = $post->post_content;
            preg_match_all( '/href=["\']([^"\']+)["\']/i', $content, $matches );

            foreach ( $matches[1] as $url ) {
                if ( $checked >= $max_checks ) {
                    break 2;
                }
                if ( strpos( $url, 'mailto:' ) === 0 || strpos( $url, 'tel:' ) === 0 || strpos( $url, '#' ) === 0 ) {
                    continue;
                }

                // Check external links only (internal links assumed OK)
                if ( strpos( $url, home_url() ) !== 0 && strpos( $url, '/' ) !== 0 ) {
                    $check = self::check_link( $url );
                    $checked++;
                    $results[] = [
                        'post_id'   => $post->ID,
                        'url'       => $url,
                        'status'    => $check['status'],
                        'http_code' => $check['code'],
                    ];

                    if ( $check['broken'] ) {
                        $broken[] = [
                            'post_id'    => $post->ID,
                            'post_title' => $post->post_title,
                            'url'        => $url,
                            'status'     => $check['code'] ?: 'TIMEOUT',
                        ];
                    }
                }
            }
        }

        $report = [
            'timestamp' => current_time( 'mysql' ),
            'total'     => count( $results ),
            'broken'    => $broken,
        ];

        update_option( 'ashbi_last_link_scan', $report );

        if ( ! empty( $broken ) ) {
            self::send_alert_to_hub( 'broken_links', $report );
        }

        return $report;
    }

    /**
     * Check a single URL via HEAD request.
     */
    private static function check_link( $url ) {
        $response = wp_remote_head( $url, [
            'timeout'     => 10,
            'redirection' => 2,
            'sslverify'   => true,
        ]);

        if ( is_wp_error( $response ) ) {
            return [ 'status' => 'error', 'code' => 0, 'broken' => true ];
        }

        $code = wp_remote_retrieve_response_code( $response );
        $broken = ( $code >= 400 || $code === 0 );

        return [ 'status' => $broken ? 'broken' : 'ok', 'code' => $code, 'broken' => $broken ];
    }

    /**
     * Check SSL expiry and return status.
     */
    private static function check_ssl_expiry() {
        $site_url = home_url();
        $host = parse_url( $site_url, PHP_URL_HOST );
        
        if ( ! $host || strpos( $site_url, 'https' ) !== 0 ) {
            return [ 'status' => 'no_ssl', 'days' => 0 ];
        }

        $cert_info = self::get_ssl_cert_info( $host );
        
        if ( ! $cert_info || ! isset( $cert_info['validTo_time_t'] ) ) {
            return [ 'status' => 'check_failed', 'days' => 0 ];
        }

        $days_left = floor( ( $cert_info['validTo_time_t'] - time() ) / 86400 );

        if ( $days_left <= 0 ) {
            $status = 'EXPIRED';
        } elseif ( $days_left < 7 ) {
            $status = 'CRITICAL';
            self::send_alert_to_hub( 'ssl_critical', [ 'days' => $days_left ] );
        } elseif ( $days_left < 14 ) {
            $status = 'WARNING';
        } else {
            $status = 'OK';
        }

        return [ 'status' => $status, 'days' => $days_left ];
    }

    /**
     * Get SSL certificate info.
     */
    private static function get_ssl_cert_info( $host ) {
        $context = stream_context_create([
            'ssl' => [ 'capture_peer_cert' => true ],
            'http' => [ 'timeout' => 10 ],
        ]);

        $read = @fopen( 'https://' . $host, 'rb', false, $context );
        if ( ! $read ) {
            return false;
        }

        $params = stream_context_get_params( $read );
        fclose( $read );

        $peer = $params['options']['ssl']['peer_certificate'] ?? null;
        return $peer ? openssl_x509_parse( $peer ) : false;
    }

    /**
     * Harden comment settings to prevent spam.
     *
     * Skipped when the site admin has set `ashbi_hardening_enabled` to false
     * (default true). Site owners running a magazine, a community, or any
     * install that needs open comments can opt out via Settings → Discussion
     * or by adding the filter below in a mu-plugin.
     *
     * Code-level opt-out:
     *   add_filter( 'ashbi_hardening_enabled', '__return_false' );
     */
    private static function harden_comment_settings() {
        $enabled = apply_filters( 'ashbi_hardening_enabled', get_option( 'ashbi_hardening_enabled', true ) );
        if ( ! $enabled ) {
            return;
        }
        // Comment registration required
        update_option( 'comment_registration', '1' );
        // Close comments on old posts (30 days)
        update_option( 'close_comments_days_old', '30' );
        // Moderate all comments
        update_option( 'comment_moderation', '1' );
        // Disable pingbacks
        update_option( 'default_ping_status', 'closed' );
        update_option( 'default_pingback_flag', '0' );
        // Enable Akismet if installed
        if ( class_exists( 'Akismet' ) ) {
            update_option( 'wordpress_api_key', get_option( 'akismet_api_key', '' ) );
        }
    }

    /**
     * Count available plugin updates.
     */
    private static function count_plugin_updates() {
        wp_update_plugins();
        $updates = get_site_transient( 'update_plugins' );
        return isset( $updates->response ) ? count( (array) $updates->response ) : 0;
    }

    /**
     * Count available theme updates.
     */
    private static function count_theme_updates() {
        wp_update_themes();
        $updates = get_site_transient( 'update_themes' );
        return isset( $updates->response ) ? count( (array) $updates->response ) : 0;
    }

    /**
     * Count available core updates.
     */
    private static function count_core_updates() {
        wp_version_check();
        $updates = get_site_transient( 'update_core' );
        if ( isset( $updates->updates ) && is_array( $updates->updates ) ) {
            foreach ( $updates->updates as $update ) {
                if ( isset( $update->response ) && $update->response !== 'latest' ) {
                    return 1;
                }
            }
        }
        return 0;
    }

    /**
     * Send report to hub.
     *
     * NOTE: previously posted to /api/wp-bridge/health, which is a 404 on the hub
     * (no such route). The hub exposes /api/wp-bridge/report for monthly/snapshot
     * report ingestion; recordReport stores the raw `report` payload in the
     * wp_reports.payload column, so unknown fields are preserved for forward
     * compatibility. Hygiene snapshots and the report endpoint share the same
     * body shape (`{ siteUrl, timestamp, report }` + HMAC headers), so the wire
     * format is compatible even though the upstream service treats the data as a
     * monthly-report upsert. The shared secret is never sent in the body.
     */
    private static function send_report_to_hub( $report ) {
        $hub_url = get_option( 'ashbi_hub_url', '' );
        $secret  = get_option( 'ashbi_secret_key', '' );

        if ( empty( $hub_url ) || empty( $secret ) ) {
            return;
        }

        $timestamp = (string) time();
        $body      = wp_json_encode( [
            'siteUrl'   => home_url(),
            'timestamp' => $timestamp,
            'report'    => $report,
        ] );
        $signature = hash_hmac( 'sha256', $timestamp . $body, $secret );

        wp_remote_post( $hub_url . '/api/wp-bridge/report', [
            'body'      => $body,
            'headers'   => [
                'Content-Type'       => 'application/json',
                'X-Ashbi-Timestamp'  => $timestamp,
                'X-Ashbi-Signature'  => 'sha256=' . $signature,
            ],
            'timeout'   => 15,
            'blocking'  => false,
            'sslverify' => true,
        ] );
    }

    /**
     * Send alert to hub.
     *
     * Also mirrors the alert to Slack and Telegram if those channels are
     * configured (Agency tier feature). The local fallback fires regardless
     * of hub health so `ssl_critical` and `broken_links` still reach Cameron
     * when the hub is dead or `ashbi_hub_url` is unset.
     */
    private static function send_alert_to_hub( $alert_type, $details ) {
        $hub_url = get_option( 'ashbi_hub_url', '' );
        $secret  = get_option( 'ashbi_secret_key', '' );

        // Try the hub POST first; failure here must not block the local fallback.
        try {
            if ( ! empty( $hub_url ) && ! empty( $secret ) ) {
                $timestamp = (string) time();
                $body      = wp_json_encode( [
                    'siteUrl'   => home_url(),
                    'alertType' => $alert_type,
                    'timestamp' => $timestamp,
                    'details'   => $details,
                ] );
                $signature = hash_hmac( 'sha256', $timestamp . $body, $secret );

                wp_remote_post( $hub_url . '/api/wp-bridge/alert', [
                    'body'      => $body,
                    'headers'   => [
                        'Content-Type'      => 'application/json',
                        'X-Ashbi-Timestamp' => $timestamp,
                        'X-Ashbi-Signature' => 'sha256=' . $signature,
                    ],
                    'timeout'   => 10,
                    'blocking'  => false,
                    'sslverify' => true,
                ] );
            }
        } catch ( \Throwable $e ) {
            // Hub unreachable or misconfigured — fall through to local forwarding.
        }

        // Always fire the local fallback so the alert reaches Cameron even when the hub is down.
        if ( class_exists( 'Ashbi_Alerts' ) ) {
            Ashbi_Alerts::forward_to_slack( $alert_type, $details );
            Ashbi_Alerts::forward_to_telegram( $alert_type, $details );
        }
    }
}
