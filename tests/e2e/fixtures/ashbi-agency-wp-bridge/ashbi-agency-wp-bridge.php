<?php
/**
 * Plugin Name: Ashbi Agency WP Bridge
 * Plugin URI: https://hub.ashbi.ca
 * Description: Connects WordPress sites to hub.ashbi.ca for remote management, maintenance, backups, and support hour tracking.
 * Version: 1.11.0
 * Requires at least: 5.5
 * Requires PHP: 7.4
 * Author: Ashbi Design
 * Text Domain: ashbi-agency-wp-bridge
 */

if ( ! defined( 'ABSPATH' ) ) exit;

define( 'ASHBI_BRIDGE_VERSION', '1.11.0' );
define( 'ASHBI_BRIDGE_FILE', __FILE__ );
define( 'ASHBI_BRIDGE_DIR', plugin_dir_path( __FILE__ ) );
define( 'ASHBI_REPLAY_WINDOW', 300 );
define( 'ASHBI_RATE_LIMIT', 10 );
define( 'ASHBI_RATE_WINDOW', 60 );

require_once ASHBI_BRIDGE_DIR . 'includes/class-ashbi-settings.php';
require_once ASHBI_BRIDGE_DIR . 'includes/class-ashbi-api.php';
require_once ASHBI_BRIDGE_DIR . 'includes/class-ashbi-auth.php';
require_once ASHBI_BRIDGE_DIR . 'includes/class-ashbi-executor.php';
require_once ASHBI_BRIDGE_DIR . 'includes/class-ashbi-magic-login.php';
require_once ASHBI_BRIDGE_DIR . 'includes/class-ashbi-sso.php';
require_once ASHBI_BRIDGE_DIR . 'includes/class-ashbi-alerts.php';
require_once ASHBI_BRIDGE_DIR . 'includes/class-ashbi-hygiene.php';
require_once ASHBI_BRIDGE_DIR . 'includes/class-ashbi-logger.php';
require_once ASHBI_BRIDGE_DIR . 'includes/class-ashbi-health.php';
require_once ASHBI_BRIDGE_DIR . 'includes/class-ashbi-updater.php';
require_once ASHBI_BRIDGE_DIR . 'includes/class-ashbi-backup.php';
require_once ASHBI_BRIDGE_DIR . 'includes/class-ashbi-hours.php';
require_once ASHBI_BRIDGE_DIR . 'includes/class-ashbi-report.php';
require_once ASHBI_BRIDGE_DIR . 'includes/class-ashbi-seo.php';
require_once ASHBI_BRIDGE_DIR . 'includes/class-ashbi-checks.php';

register_activation_hook( __FILE__, function() {
    Ashbi_SSO::create_table();
    Ashbi_Backup::init_storage();
    Ashbi_Hours::init_table();
    Ashbi_Report::init_schedule();
    update_option( 'ashbi_db_version', ASHBI_BRIDGE_VERSION );
});

register_deactivation_hook( __FILE__, function() {
    wp_clear_scheduled_hook( 'ashbi_daily_hygiene' );
    wp_clear_scheduled_hook( 'ashbi_hourly_ping' );
    wp_clear_scheduled_hook( 'ashbi_weekly_backup' );
    wp_clear_scheduled_hook( 'ashbi_monthly_report' );
});

// On every load, run idempotent init if the stored DB version is behind the current plugin version.
// This catches CI deploys that rsync files without firing the activation hook.
add_action( 'plugins_loaded', function() {
    // One-time migration: existing installs that were previously auto-updating
    // (ashbi_db_version already set) keep ashbi_auto_update=true. New installs
    // (no db_version) inherit the new opt-in default of false at the call
    // sites below. Idempotent — runs once per site, then short-circuits.
    if ( false === get_option( 'ashbi_auto_update_migrated', false ) ) {
        if ( false !== get_option( 'ashbi_db_version', false ) ) {
            update_option( 'ashbi_auto_update', true );
        }
        update_option( 'ashbi_auto_update_migrated', true );
    }

    $stored = get_option( 'ashbi_db_version', '0' );
    if ( version_compare( $stored, ASHBI_BRIDGE_VERSION, '<' ) ) {
        Ashbi_SSO::create_table();
        Ashbi_Backup::init_storage();
        Ashbi_Hours::init_table();
        Ashbi_Report::init_schedule();
        update_option( 'ashbi_db_version', ASHBI_BRIDGE_VERSION );
    }
    // Refresh SEO snapshot in the background (cached, cheap to read)
    if ( false === get_transient( 'ashbi_seo_refreshed' ) ) {
        if ( function_exists( 'Ashbi_SEO' ) ) {
            Ashbi_SEO::snapshot();
        }
        set_transient( 'ashbi_seo_refreshed', 1, DAY_IN_SECONDS );
    }
    // Run custom checks weekly (only Agency tier will have custom ones registered)
    if ( function_exists( 'Ashbi_Checks' ) && false === get_transient( 'ashbi_checks_run' ) ) {
        Ashbi_Checks::run_all();
        set_transient( 'ashbi_checks_run', 1, WEEK_IN_SECONDS );
    }
}, 5 );

Ashbi_SSO::init();
Ashbi_Alerts::init();
Ashbi_Hygiene::init();
Ashbi_Backup::init();
Ashbi_Hours::init();
Ashbi_Report::init();

// AIOWPS REST API compatibility
add_filter( 'aios_rest_allow_unauthorized', function( $allow, $route ) {
    if ( strpos( $route, '/ashbi/v1/' ) !== false ) {
        return true;
    }
    return $allow;
}, 10, 2 );

add_action( 'ashbi_hourly_ping', function() {
    $hub_url = get_option( 'ashbi_hub_url', '' );
    $api_key = get_option( 'ashbi_api_key', '' );
    if ( empty( $hub_url ) || empty( $api_key ) ) {
        return;
    }

    // Self-heal: if the site is unregistered, or the last health ping was an
    // error more than an hour ago, attempt a fresh register_with_hub call.
    // This is the recovery path for clients whose hub was unreachable at the
    // moment of onboarding — they would otherwise sit in a permanent
    // disconnected state with no cron scheduled to retry.
    $registered = (bool) get_option( 'ashbi_hub_registered', false );
    $last_ping  = get_option( 'ashbi_last_ping', false );
    $last_ping_failed = is_array( $last_ping ) && isset( $last_ping['status'] ) && $last_ping['status'] !== 'ok';

    $should_attempt_rereg = false;
    if ( ! $registered ) {
        $should_attempt_rereg = true;
    } elseif ( $last_ping_failed && ! empty( $last_ping['timestamp'] ) ) {
        $last_ping_ts = strtotime( $last_ping['timestamp'] );
        if ( $last_ping_ts && ( time() - $last_ping_ts ) > HOUR_IN_SECONDS ) {
            $should_attempt_rereg = true;
        }
    }

    if ( $should_attempt_rereg ) {
        // Backoff: don't hammer the hub. If the last attempt was less than 5
        // minutes ago, skip and let the next hourly tick try again.
        $last_attempt = (int) get_option( 'ashbi_last_rereg_attempt', 0 );
        if ( $last_attempt && ( time() - $last_attempt ) < 5 * MINUTE_IN_SECONDS ) {
            // Throttled — fall through to ping below.
        } else {
            update_option( 'ashbi_last_rereg_attempt', time() );
            $reg = Ashbi_Health::register_with_hub( $hub_url, $api_key );
            if ( is_wp_error( $reg ) ) {
                if ( class_exists( 'Ashbi_Logger' ) ) {
                    Ashbi_Logger::log( 'hourly_reregister', [ 'hub_url' => $hub_url ], 'error: ' . $reg->get_error_message() );
                } else {
                    error_log( '[Ashbi Bridge] hourly re-register failed: ' . $reg->get_error_message() );
                }
            } else {
                update_option( 'ashbi_hub_registered', true );
                if ( class_exists( 'Ashbi_Logger' ) ) {
                    Ashbi_Logger::log( 'hourly_reregister', [ 'hub_url' => $hub_url ], 'ok' );
                } else {
                    error_log( '[Ashbi Bridge] hourly re-register succeeded' );
                }
            }
        }
    }

    Ashbi_Health::ping_hub( $hub_url, $api_key );
});

add_action( 'ashbi_daily_hygiene', function() {
    $last_ping = get_option( 'ashbi_last_ping', false );
    if ( $last_ping && $last_ping['status'] !== 'ok' ) {
        $last_time = strtotime( $last_ping['timestamp'] );
        if ( $last_time && ( time() - $last_time ) > 86400 ) {
            $admin_email = get_option( 'admin_email' );
            $site_name   = get_bloginfo( 'name' );
            $hub_url     = get_option( 'ashbi_hub_url', 'https://hub.ashbi.ca' );
            wp_mail(
                $admin_email,
                "[Ashbi Bridge] {$site_name} disconnected from Hub",
                "The Ashbi Bridge on {$site_name} (" . home_url() . ") has been unable to reach the Hub for over 24 hours.\n\n" .
                "Last ping: {$last_ping['timestamp']}\n" .
                "Error: {$last_ping['status']}\n\n" .
                "Check your Ashbi Bridge settings: " . admin_url( 'options-general.php?page=ashbi-agency-wp-bridge' ) . "\n" .
                "Or visit the Hub: {$hub_url}\n"
            );
        }
    }
}, 20 );

add_filter( 'plugin_action_links_' . plugin_basename( __FILE__ ), function( $links ) {
    $url = admin_url( 'options-general.php?page=ashbi-agency-wp-bridge' );
    array_unshift( $links, '<a href="' . esc_url( $url ) . '">Settings</a>' );
    $auto_update = get_option( 'ashbi_auto_update', false ) ? 'Enabled' : 'Disabled';
    array_unshift( $links, '<span style="color:#646970;">Auto-update: ' . $auto_update . '</span>' );
    return $links;
});

add_filter( 'site_status_tests', function( $tests ) {
    $tests['direct']['ashbi_bridge_connection'] = [
        'label' => 'Ashbi Bridge Connection',
        'test'  => [ 'Ashbi_Health', 'site_health_test' ],
    ];
    return $tests;
});

add_action( 'wp_dashboard_setup', function() {
    if ( current_user_can( 'manage_options' ) ) {
        wp_add_dashboard_widget(
            'ashbi_bridge_dashboard',
            'Ashbi Bridge Status',
            [ 'Ashbi_Health', 'dashboard_widget' ]
        );
    }
});

add_action( 'plugins_loaded', function() {
    new Ashbi_Settings();
    new Ashbi_API();
});

add_action( 'init', function() {
    if ( class_exists( 'Ashbi_Updater' ) ) {
        new Ashbi_Updater();
    }
});

add_filter( 'auto_update_plugin', function( $update, $item ) {
    if ( ! get_option( 'ashbi_auto_update', false ) ) {
        return $update;
    }
    if ( isset( $item->slug ) && $item->slug === 'ashbi-agency-wp-bridge' ) {
        return true;
    }
    return $update;
}, 10, 2 );