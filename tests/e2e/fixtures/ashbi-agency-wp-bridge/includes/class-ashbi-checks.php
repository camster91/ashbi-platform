<?php
/**
 * Ashbi Custom Checks — extensible per-site health checks (Agency tier)
 *
 * Sites can register named checks via the 'ashbi_register_checks' filter.
 * Each check returns ['label' => ..., 'status' => 'ok'|'warn'|'bad', 'detail' => ...].
 *
 * The results are stored in 'ashbi_last_checks' option and rendered in the
 * monthly report's "Custom Checks" section when present.
 */
if ( ! defined( 'ABSPATH' ) ) exit;

class Ashbi_Checks {

    const CACHE_OPTION = 'ashbi_last_checks';

    /**
     * Default checks run on every site. Agency tier can add more via filter.
     */
    public static function registered_checks() {
        $defaults = [
            'wp_cron' => [
                'label'  => 'WP-Cron is firing',
                'run'    => [ self::class, 'check_wp_cron' ],
            ],
            'ssl_valid' => [
                'label'  => 'SSL certificate valid',
                'run'    => [ self::class, 'check_ssl_valid' ],
            ],
            'debug_off' => [
                'label'  => 'WP_DEBUG disabled in production',
                'run'    => [ self::class, 'check_debug_off' ],
            ],
            'updates_pending' => [
                'label'  => 'No critical updates overdue',
                'run'    => [ self::class, 'check_updates_pending' ],
            ],
        ];
        return apply_filters( 'ashbi_register_checks', $defaults );
    }

    /**
     * Run all registered checks and cache the result.
     * Returns: ['timestamp' => ..., 'results' => [name => [label, status, detail]]]
     */
    public static function run_all() {
        $results = [];
        foreach ( self::registered_checks() as $key => $check ) {
            $callback = $check['run'] ?? null;
            if ( ! is_callable( $callback ) ) {
                $results[ $key ] = [
                    'label'  => $check['label'] ?? $key,
                    'status' => 'warn',
                    'detail' => 'check not callable',
                ];
                continue;
            }
            try {
                $result = (array) call_user_func( $callback );
                $results[ $key ] = array_merge(
                    [ 'label' => $check['label'] ?? $key ],
                    $result
                );
            } catch ( \Throwable $e ) {
                $results[ $key ] = [
                    'label'  => $check['label'] ?? $key,
                    'status' => 'bad',
                    'detail' => 'check threw: ' . $e->getMessage(),
                ];
            }
        }
        $out = [ 'timestamp' => current_time( 'mysql' ), 'results' => $results ];
        update_option( self::CACHE_OPTION, $out, false );
        return $out;
    }

    public static function get_cached() {
        $cached = get_option( self::CACHE_OPTION, null );
        if ( ! is_array( $cached ) ) {
            return self::run_all();
        }
        return $cached;
    }

    // ===== Default check implementations =====

    public static function check_wp_cron() {
        $next = wp_next_scheduled( 'ashbi_hourly_ping' );
        if ( ! $next ) {
            return [ 'status' => 'bad', 'detail' => 'hourly cron not scheduled' ];
        }
        $delta = $next - time();
        if ( $delta > 2 * HOUR_IN_SECONDS ) {
            return [ 'status' => 'warn', 'detail' => sprintf( 'next run in %dh', round( $delta / HOUR_IN_SECONDS ) ) ];
        }
        return [ 'status' => 'ok', 'detail' => sprintf( 'next run in %dm', max( 0, round( $delta / MINUTE_IN_SECONDS ) ) ) ];
    }

    public static function check_ssl_valid() {
        $url = home_url( '/', 'https' );
        $response = wp_remote_head( $url, [ 'timeout' => 5, 'sslverify' => true, 'redirection' => 0 ] );
        if ( is_wp_error( $response ) ) {
            return [ 'status' => 'bad', 'detail' => $response->get_error_message() ];
        }
        $code = (int) wp_remote_retrieve_response_code( $response );
        return $code >= 200 && $code < 400
            ? [ 'status' => 'ok', 'detail' => 'HTTPS reachable' ]
            : [ 'status' => 'bad', 'detail' => "HTTP $code" ];
    }

    public static function check_debug_off() {
        if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
            return [ 'status' => 'warn', 'detail' => 'WP_DEBUG is enabled' ];
        }
        if ( defined( 'WP_DEBUG_LOG' ) && WP_DEBUG_LOG ) {
            return [ 'status' => 'warn', 'detail' => 'WP_DEBUG_LOG is enabled' ];
        }
        return [ 'status' => 'ok', 'detail' => 'production-ready' ];
    }

    public static function check_updates_pending() {
        $hygiene = get_option( 'ashbi_last_hygiene', [] );
        $counts  = $hygiene['counts'] ?? [];
        $pending = ( $counts['plugin_updates'] ?? 0 ) + ( $counts['theme_updates'] ?? 0 ) + ( $counts['core_updates'] ?? 0 );
        if ( $pending === 0 ) {
            return [ 'status' => 'ok', 'detail' => 'all up to date' ];
        }
        if ( $pending <= 3 ) {
            return [ 'status' => 'warn', 'detail' => "{$pending} pending" ];
        }
        return [ 'status' => 'bad', 'detail' => "{$pending} pending — overdue" ];
    }
}
