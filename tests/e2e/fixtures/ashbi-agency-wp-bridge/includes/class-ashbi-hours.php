<?php
/**
 * Ashbi Hours — tier-driven retainer tracking
 *
 * Tiers:
 *   - basic: 0 hr (no retainer, just ad-hoc billing)
 *   - professional: 1 hr included monthly, 3 hr banked cap
 *   - agency: 4 hr included monthly, 6 hr banked cap
 *
 * Tier is stored in 'ashbi_tier' option; defaults to 'professional' for
 * backwards compatibility (the old hardcoded 1hr/3hr cap).
 */
if ( ! defined( 'ABSPATH' ) ) exit;

class Ashbi_Hours {

    /**
     * Tier definitions. Per-tier monthly included hours + max banked.
     */
    const TIERS = [
        'basic'        => [ 'included' => 0.0,  'max_banked' => 0.0 ],
        'professional' => [ 'included' => 1.0,  'max_banked' => 3.0 ],
        'agency'       => [ 'included' => 4.0,  'max_banked' => 6.0 ],
    ];

    /**
     * Returns the current tier config. Reads from 'ashbi_tier' option,
     * falls back to 'professional' for legacy sites.
     */
    public static function tier() {
        $tier = get_option( 'ashbi_tier', 'professional' );
        if ( ! isset( self::TIERS[ $tier ] ) ) {
            $tier = 'professional';
        }
        $config = self::TIERS[ $tier ];
        // Allow override via filter (e.g. for white-label clients on custom tiers)
        $config = apply_filters( 'ashbi_hours_tier', $config, $tier );
        return [ 'tier' => $tier ] + $config;
    }

    /**
     * Backwards-compat constants (referenced in old code paths and report template)
     */
    public static function included_monthly() {
        return (float) self::tier()['included'];
    }
    public static function max_banked() {
        return (float) self::tier()['max_banked'];
    }

    public static function init() {}

    public static function init_table() {
        if ( false === get_option( 'ashbi_hours_cycle_start' ) ) {
            $tier = self::tier();
            update_option( 'ashbi_hours_cycle_start', current_time( 'Y-m-d' ) );
            update_option( 'ashbi_hours_available', $tier['included'] );
            update_option( 'ashbi_hours_used_this_month', 0.0 );
            update_option( 'ashbi_hours_log', [] );
        } else {
            // On plugin upgrade, if tier changed, re-evaluate available hours cap
            $tier = self::tier();
            $current = (float) get_option( 'ashbi_hours_available', 0 );
            // If we just upgraded to a higher tier, increase the cap (but keep what's used)
            if ( $tier['included'] > $current && (float) get_option( 'ashbi_hours_used_this_month', 0 ) === 0 ) {
                update_option( 'ashbi_hours_available', $tier['included'] );
            }
        }
    }

    public static function maybe_cycle_month() {
        $cycle_start = get_option( 'ashbi_hours_cycle_start', current_time( 'Y-m-d' ) );
        $cycle_ts    = strtotime( $cycle_start );
        $now_ts      = strtotime( current_time( 'Y-m-d' ) );
        if ( date( 'Y-m', $cycle_ts ) === date( 'Y-m', $now_ts ) ) return;

        $tier     = self::tier();
        $available = (float) get_option( 'ashbi_hours_available', 0 );
        $used      = (float) get_option( 'ashbi_hours_used_this_month', 0 );
        $unused    = max( 0, $available - $used );
        $new_available = min( $tier['included'] + $unused, $tier['max_banked'] );

        update_option( 'ashbi_hours_cycle_start', current_time( 'Y-m-d' ) );
        update_option( 'ashbi_hours_available', $new_available );
        update_option( 'ashbi_hours_used_this_month', 0.0 );
        self::log_entry( 'cycle_reset', $new_available, sprintf( 'New month. Rolled over %sh. Tier: %s. Available: %sh.', $unused, $tier['tier'], $new_available ) );
    }

    public static function use_hours( $hours, $task ) {
        self::maybe_cycle_month();
        $hours = floatval( $hours );
        if ( $hours <= 0 ) return [ 'success' => false, 'remaining' => 0, 'message' => 'Invalid hour value.' ];

        $available = (float) get_option( 'ashbi_hours_available', 0 );
        $used      = (float) get_option( 'ashbi_hours_used_this_month', 0 );
        $remaining = max( 0, $available - $used );

        if ( $hours > $remaining ) {
            return [ 'success' => false, 'remaining' => $remaining, 'message' => "Only {$remaining}h available. Requested {$hours}h exceeds retainer." ];
        }

        $used += $hours;
        update_option( 'ashbi_hours_used_this_month', $used );
        $new_remaining = max( 0, $available - $used );
        self::log_entry( 'used', $hours, $task );
        return [ 'success' => true, 'remaining' => $new_remaining, 'message' => "Recorded {$hours}h. Remaining: {$new_remaining}h." ];
    }

    public static function get_status() {
        self::maybe_cycle_month();
        $tier     = self::tier();
        $available = (float) get_option( 'ashbi_hours_available', $tier['included'] );
        $used      = (float) get_option( 'ashbi_hours_used_this_month', 0 );
        return [
            'tier'            => $tier['tier'],
            'cycle_start'     => get_option( 'ashbi_hours_cycle_start', current_time( 'Y-m-d' ) ),
            'included_monthly'=> $tier['included'],
            'available'       => $available,
            'used_this_month' => $used,
            'remaining'       => max( 0, $available - $used ),
            'max_banked'      => $tier['max_banked'],
        ];
    }

    public static function get_log( $limit = 20 ) {
        $log = get_option( 'ashbi_hours_log', [] );
        return array_slice( $log, -$limit );
    }

    private static function log_entry( $type, $hours, $task ) {
        $log = get_option( 'ashbi_hours_log', [] );
        $log[] = [ 'timestamp' => current_time( 'mysql' ), 'type' => $type, 'hours' => $hours, 'task' => $task ];
        update_option( 'ashbi_hours_log', array_slice( $log, -100 ) );
    }

    public static function reset_hours( $new_available = null ) {
        $tier = self::tier();
        $new_available = $new_available ?? $tier['included'];
        update_option( 'ashbi_hours_cycle_start', current_time( 'Y-m-d' ) );
        update_option( 'ashbi_hours_available', floatval( $new_available ) );
        update_option( 'ashbi_hours_used_this_month', 0.0 );
        self::log_entry( 'reset', $new_available, 'Manual reset by admin.' );
    }

    /**
     * Set the site's tier. Used by the Settings page or programmatically
     * from the hub when a tier change is requested.
     */
    public static function set_tier( $tier ) {
        if ( ! isset( self::TIERS[ $tier ] ) ) {
            return false;
        }
        update_option( 'ashbi_tier', $tier );
        // If upgrading mid-cycle, bump the available hours to the new tier minimum
        $tier_config = self::TIERS[ $tier ];
        $current = (float) get_option( 'ashbi_hours_available', 0 );
        if ( $tier_config['included'] > $current ) {
            update_option( 'ashbi_hours_available', $tier_config['included'] );
        }
        return true;
    }
}
