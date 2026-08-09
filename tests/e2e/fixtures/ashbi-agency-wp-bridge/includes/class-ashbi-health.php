<?php
if ( ! defined( 'ABSPATH' ) ) exit;

class Ashbi_Health {
    public static function register_with_hub( $hub_url, $api_key ) {
        // get_plugins() / is_plugin_active() live in wp-admin/includes/plugin.php
        // and are only auto-loaded on admin requests. Registration can fire from
        // the REST endpoint (non-admin), so the require must be defensive here.
        // Without it, the call fatals with "Call to undefined function" on hosts
        // like WP Engine / Kinsta where the registration call path doesn't
        // include admin context (this is the roiswift.com crash).
        if ( ! function_exists( 'get_plugins' ) ) {
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
        }
        $plugins = get_plugins();
        $active = [];
        foreach ( $plugins as $path => $data ) {
            if ( is_plugin_active( $path ) ) {
                // Send a slug list (just the plugin path/filename) instead of an
                // array of {name, version, active} objects. The hub only reads
                // activePlugins.length for pluginCount (wpBridge.service.js:63),
                // and the slug list survives PHP non-contiguous-keyed arrays
                // (Pitfall 16 in hub-wp-bridge-ops) so json_encode always
                // produces a real JSON array, not an object.
                $active[] = $path;
            }
        }
        $body = [
            'siteUrl'          => home_url(),
            'siteName'         => get_bloginfo( 'name' ),
            'wordpressVersion' => get_bloginfo( 'version' ),
            'phpVersion'       => PHP_VERSION,
            'activePlugins'    => $active,
            'pluginCount'      => count( $active ),
            'theme'            => wp_get_theme()->get( 'Name' ),
            'bridgeVersion'    => defined( 'ASHBI_BRIDGE_VERSION' ) ? ASHBI_BRIDGE_VERSION : '1.5.0',
            'timestamp'        => (string) time(),
        ];

        $json     = wp_json_encode( $body );
        $signed   = Ashbi_Auth::sign_outbound( $json );
        $headers  = array_merge( $signed['headers'], [
            'Authorization' => 'Bearer ' . $api_key,
        ] );

        // The site must first be provisioned by an Ashbi admin. This signed
        // health update confirms the pasted per-site credential without
        // allowing a plugin to choose its own organization.
        $response = wp_remote_request( $hub_url . '/api/wp-bridge', [
            'method'    => 'PUT',
            'body'      => $signed['body'],
            'headers'   => $headers,
            'timeout'   => 30,
            'sslverify' => true,
        ] );
        if ( is_wp_error( $response ) ) return $response;
        $code = wp_remote_retrieve_response_code( $response );
        if ( $code < 200 || $code > 299 ) {
            $body_text = wp_remote_retrieve_body( $response );
            $decoded   = json_decode( $body_text, true );
            $detail    = $decoded['message'] ?? $decoded['error'] ?? "HTTP $code";
            return new WP_Error( 'hub_error', "Hub responded: $detail" );
        }
        update_option( 'ashbi_hub_registered', true );
        update_option( 'ashbi_hub_registered_at', current_time( 'mysql' ) );
        return json_decode( wp_remote_retrieve_body( $response ), true );
    }

    public static function ping_hub( $hub_url, $api_key ) {
        $body = [
            'siteUrl'       => home_url(),
            'timestamp'     => (string) time(),
            'ttfb'          => self::measure_ttfb(),
            'dbSize'        => self::get_db_size(),
            'diskBytes'     => self::get_disk_bytes(),
            'diskUsagePct'  => self::get_disk_usage(),
            'pluginUpdates' => self::count_plugin_updates(),
            'wpVersion'     => get_bloginfo( 'version' ),
            'phpVersion'    => PHP_VERSION,
            'bridgeVersion' => defined( 'ASHBI_BRIDGE_VERSION' ) ? ASHBI_BRIDGE_VERSION : '1.5.0',
        ];
        // Use PUT /api/wp-bridge for health updates (hub's updateSiteHealth handler).
        $json    = wp_json_encode( $body );
        $signed  = Ashbi_Auth::sign_outbound( $json );
        $headers = array_merge( $signed['headers'], [
            'Authorization' => 'Bearer ' . $api_key,
        ] );

        $response = wp_remote_request( $hub_url . '/api/wp-bridge', [
            'method'    => 'PUT',
            'body'      => $signed['body'],
            'headers'   => $headers,
            'timeout'   => 15,
            'sslverify' => true,
        ] );

        $status = 'ok';
        if ( is_wp_error( $response ) ) {
            $status = $response->get_error_message();
        } else {
            $code = wp_remote_retrieve_response_code( $response );
            if ( $code < 200 || $code > 299 ) $status = "HTTP $code";
        }

        $ping_entry = [ 'timestamp' => current_time( 'mysql' ), 'status' => $status ];
        update_option( 'ashbi_last_ping', $ping_entry, false );

        // Append to rolling ping history (keep last 500)
        $history = get_option( 'ashbi_ping_history', [] );
        $history[] = $ping_entry;
        $history = array_slice( $history, -500 );
        update_option( 'ashbi_ping_history', $history );
    }

    public static function measure_ttfb() {
        // Time-to-first-byte of a HEAD request to the site's homepage.
        // Uses a 10s timeout and follows no redirects (we want the live URL).
        $url = home_url( '/', is_ssl() ? 'https' : 'http' );
        $start = microtime( true );
        $response = wp_remote_head( $url, [
            'timeout'     => 10,
            'sslverify'   => true,
            'redirection' => 0,
            'user-agent'  => 'Ashbi-Bridge/' . ASHBI_BRIDGE_VERSION . ' (health-check)',
        ] );
        $elapsed_ms = (int) round( ( microtime( true ) - $start ) * 1000 );
        if ( is_wp_error( $response ) ) {
            return -1; // negative indicates fetch failure
        }
        $code = (int) wp_remote_retrieve_response_code( $response );
        // Return TTFB only on 2xx/3xx (successful or redirect responses).
        return $code >= 200 && $code < 400 ? $elapsed_ms : -1;
    }

    /**
     * Time a generic DB query (used for hub dbSize/performance tracking).
     * Not the same as TTFB — kept for backward compatibility.
     */
    public static function measure_db_query_ms() {
        global $wpdb;
        $start = microtime( true );
        $wpdb->query( 'SELECT 1' );
        return (int) round( ( microtime( true ) - $start ) * 1000 );
    }

    public static function get_db_size() {
        global $wpdb;
        $result = $wpdb->get_row( "SELECT SUM( data_length + index_length ) AS size FROM information_schema.TABLES WHERE table_schema = DATABASE()" );
        return (int) ( $result->size ?? 0 );
    }

    /**
     * Disk usage as a percentage of total disk space.
     * Returns float 0-100, or -1 if disk_total_space is unavailable.
     */
    public static function get_disk_usage() {
        $total = @disk_total_space( ABSPATH );
        $free  = @disk_free_space( ABSPATH );
        if ( ! $total || $total <= 0 ) return -1;
        return round( ( ( $total - $free ) / $total ) * 100, 2 );
    }

    /**
     * Disk used in bytes (absolute, not percentage). Used by hub for storage
     * tracking. Returns int 0 if disk_total_space is unavailable.
     */
    public static function get_disk_bytes() {
        $total = @disk_total_space( ABSPATH );
        $free  = @disk_free_space( ABSPATH );
        if ( ! $total || $total <= 0 ) return 0;
        return (int) ( $total - $free );
    }

    public static function count_plugin_updates() {
        if ( ! function_exists( 'get_plugin_updates' ) ) {
            require_once ABSPATH . 'wp-admin/includes/update.php';
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
        }
        $updates = get_plugin_updates();
        return is_array( $updates ) ? count( $updates ) : 0;
    }

    public static function site_health_test() {
        $registered = get_option( 'ashbi_hub_registered', false );
        $last_ping  = get_option( 'ashbi_last_ping', false );
        $has_cron   = (bool) wp_next_scheduled( 'ashbi_hourly_ping' );

        if ( ! $registered ) {
            return [
                'label'       => 'Ashbi Bridge is not connected',
                'status'      => 'recommended',
                'badge'       => [ 'label' => 'Ashbi Bridge', 'color' => 'orange' ],
                'description' => '<p>The Ashbi Bridge plugin is active but not connected to a Hub. Go to Settings → Ashbi Bridge to connect.</p>',
                'test'        => 'ashbi_bridge_connection',
            ];
        }

        $issues = [];
        if ( ! $has_cron ) $issues[] = 'Hourly health ping is not scheduled.';
        if ( $last_ping && $last_ping['status'] !== 'ok' ) $issues[] = 'Last ping failed: ' . esc_html( $last_ping['status'] );
        if ( version_compare( PHP_VERSION, '8.0', '<' ) ) $issues[] = 'PHP version ' . PHP_VERSION . ' is below recommended 8.0.';

        if ( ! empty( $issues ) ) {
            return [
                'label'       => 'Ashbi Bridge has issues',
                'status'      => 'recommended',
                'badge'       => [ 'label' => 'Ashbi Bridge', 'color' => 'orange' ],
                'description' => '<p>' . implode( ' ', $issues ) . '</p>',
                'test'        => 'ashbi_bridge_connection',
            ];
        }

        return [
            'label'       => 'Ashbi Bridge is connected and healthy',
            'status'      => 'good',
            'badge'       => [ 'label' => 'Ashbi Bridge', 'color' => 'blue' ],
            'description' => '<p>Connected to Hub. Health pings are running on schedule.</p>',
            'test'        => 'ashbi_bridge_connection',
        ];
    }

    public static function dashboard_widget() {
        $registered = get_option( 'ashbi_hub_registered', false );
        $last_ping  = get_option( 'ashbi_last_ping', false );
        $next_ping  = wp_next_scheduled( 'ashbi_hourly_ping' );
        $hub_url    = get_option( 'ashbi_hub_url', 'https://hub.ashbi.ca' );

        echo '<div style="padding: 4px 0;">';
        if ( ! $registered ) {
            echo '<p><span style="color:#dc3232;">&#9679;</span> <strong>Not connected</strong></p>';
            echo '<p><a href="' . esc_url( admin_url( 'options-general.php?page=ashbi-agency-wp-bridge' ) ) . '" class="button button-small">Connect to Hub</a></p>';
        } else {
            echo '<p><span style="color:#46b450;">&#9679;</span> <strong>Connected</strong> to ' . esc_html( parse_url( $hub_url, PHP_URL_HOST ) ?: 'Hub' ) . '</p>';
            if ( $last_ping ) {
                $ping_status = $last_ping['status'] === 'ok' ? '<span style="color:#46b450;">OK</span>' : '<span style="color:#dc3232;">' . esc_html( $last_ping['status'] ) . '</span>';
                echo '<p>Last ping: ' . esc_html( $last_ping['timestamp'] ) . ' — ' . $ping_status . '</p>';
            }
            if ( $next_ping ) {
                $diff = $next_ping - time();
                echo '<p>Next ping: ' . ( $diff > 0 ? esc_html( human_time_diff( time(), $next_ping ) ) . ' from now' : 'Overdue (will run on next cron tick)' ) . '</p>';
            }
            $wpcli_ok = Ashbi_Executor::is_wp_cli_available();
            echo '<p>WP-CLI: ' . ( $wpcli_ok ? '<span style="color:#46b450;">Available</span>' : '<span style="color:#dc3232;">Disabled</span>' ) . '</p>';
            echo '<p><a href="' . esc_url( admin_url( 'options-general.php?page=ashbi-agency-wp-bridge' ) ) . '">Manage Settings →</a></p>';
        }
        echo '</div>';
    }
}
