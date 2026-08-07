<?php
/**
 * Ashbi Settings Page v1.7.0
 *
 * @package Ashbi_Agency_WP_Bridge
 */

if ( ! defined( 'ABSPATH' ) ) exit;

class Ashbi_Settings {
    public function __construct() {
        add_action( 'admin_menu', [ $this, 'add_settings_page' ] );
        add_action( 'admin_notices', [ $this, 'activation_notice' ] );
        add_action( 'admin_bar_menu', [ $this, 'admin_bar_status' ], 100 );
    }

    public function add_settings_page() {
        add_options_page(
            'Ashbi Bridge',
            'Ashbi Bridge',
            'manage_options',
            'ashbi-agency-wp-bridge',
            [ $this, 'render_settings_page' ]
        );
    }

    public function activation_notice() {
        $screen = get_current_screen();
        if ( ! get_option( 'ashbi_activation_notice_dismissed' ) && ! get_option( 'ashbi_hub_registered' ) ) {
            if ( $screen && $screen->id === 'settings_page_ashbi-agency-wp-bridge' ) {
                update_option( 'ashbi_activation_notice_dismissed', true );
                return;
            }
            $settings_url = admin_url( 'options-general.php?page=ashbi-agency-wp-bridge' );
            echo '<div class="notice notice-info is-dismissible"><p>';
            echo '<strong>Ashbi Agency WP Bridge</strong> is active. ';
            echo '<a href="' . esc_url( $settings_url ) . '">Connect to your Hub</a> to enable remote management.';
            echo '</p></div>';
        }
    }

    public function admin_bar_status( $wp_admin_bar ) {
        if ( ! current_user_can( 'manage_options' ) ) return;
        $connected = get_option( 'ashbi_hub_registered', false );
        $label     = $connected ? 'Ashbi: Connected' : 'Ashbi: Disconnected';
        $color     = $connected ? '#46b450' : '#dc3232';
        $wp_admin_bar->add_node( [
            'id'    => 'ashbi-bridge-status',
            'title' => '<span style="color:' . $color . ';">&#9679;</span> ' . $label,
            'href'  => admin_url( 'options-general.php?page=ashbi-agency-wp-bridge' ),
        ] );
    }

    private function handle_post_actions() {
        $hub_url    = get_option( 'ashbi_hub_url', 'https://hub.ashbi.ca' );
        $api_key    = get_option( 'ashbi_api_key', '' );
        $secret_key = get_option( 'ashbi_secret_key', '' );
        $registered = get_option( 'ashbi_hub_registered', false );

        if ( isset( $_POST['ashbi_save'] ) && current_user_can( 'manage_options' ) ) {
            check_admin_referer( 'ashbi_save_settings' );
            update_option( 'ashbi_hub_url', sanitize_url( $_POST['hub_url'] ?? 'https://hub.ashbi.ca' ) );
            update_option( 'ashbi_api_key', sanitize_text_field( $_POST['api_key'] ?? '' ) );
            update_option( 'ashbi_auto_update', isset( $_POST['ashbi_auto_update'] ) ? '1' : '0' );
            if ( empty( get_option( 'ashbi_secret_key' ) ) ) update_option( 'ashbi_secret_key', wp_generate_uuid_v4() );
            echo '<div class="notice notice-success"><p>Settings saved.</p></div>';
        }

        if ( isset( $_POST['ashbi_connect'] ) && current_user_can( 'manage_options' ) ) {
            check_admin_referer( 'ashbi_save_settings' );
            $hub_url = sanitize_url( $_POST['hub_url'] ?? 'https://hub.ashbi.ca' );
            $api_key = sanitize_text_field( $_POST['api_key'] ?? '' );
            update_option( 'ashbi_hub_url', $hub_url );
            update_option( 'ashbi_api_key', $api_key );
            if ( empty( get_option( 'ashbi_secret_key' ) ) ) update_option( 'ashbi_secret_key', wp_generate_uuid_v4() );
            $secret_key = get_option( 'ashbi_secret_key', '' );

            if ( empty( $api_key ) ) {
                echo '<div class="notice notice-error"><p>Please enter your API key before connecting.</p></div>';
            } else {
                $result = Ashbi_Health::register_with_hub( $hub_url, $api_key );
                if ( is_wp_error( $result ) ) {
                    echo '<div class="notice notice-error"><p>Connection failed: ' . esc_html( $result->get_error_message() ) . '</p></div>';
                    if ( class_exists( 'Ashbi_Logger' ) ) {
                        Ashbi_Logger::log( 'connect', [ 'hub_url' => $hub_url ], 'error: ' . $result->get_error_message() );
                    } else {
                        error_log( '[Ashbi Bridge] manual connect failed: ' . $result->get_error_message() );
                    }
                } else {
                    update_option( 'ashbi_hub_registered', true );
                    $registered = true;
                    echo '<div class="notice notice-success"><p>Connected to ' . esc_url( $hub_url ) . '. Your site is now registered and health pings are scheduled.</p></div>';
                }
            }
            // Always schedule the hourly ping, even when registration failed.
            // The hourly handler is a no-op until hub credentials are configured,
            // but it gives the plugin a self-heal path: when the hub comes back,
            // the next hourly tick re-runs registration without admin intervention.
            if ( ! wp_next_scheduled( 'ashbi_hourly_ping' ) ) {
                wp_schedule_event( time(), 'hourly', 'ashbi_hourly_ping' );
            }
        }

        if ( isset( $_POST['ashbi_disconnect'] ) && current_user_can( 'manage_options' ) ) {
            check_admin_referer( 'ashbi_save_settings' );
            delete_option( 'ashbi_hub_registered' );
            delete_option( 'ashbi_hub_registered_at' );
            delete_option( 'ashbi_last_ping' );
            wp_clear_scheduled_hook( 'ashbi_hourly_ping' );
            $registered = false;
            echo '<div class="notice notice-warning"><p>Disconnected from the Hub. Health pings have been stopped.</p></div>';
        }

        if ( isset( $_POST['ashbi_ping_now'] ) && current_user_can( 'manage_options' ) ) {
            check_admin_referer( 'ashbi_save_settings' );
            if ( ! empty( $hub_url ) && ! empty( $api_key ) ) {
                Ashbi_Health::ping_hub( $hub_url, $api_key );
                $last_ping = get_option( 'ashbi_last_ping', false );
                echo ( $last_ping && $last_ping['status'] === 'ok' )
                    ? '<div class="notice notice-success"><p>Health ping sent successfully.</p></div>'
                    : '<div class="notice notice-error"><p>Health ping failed: ' . esc_html( $last_ping['status'] ?? 'Unknown' ) . '</p></div>';
            }
        }

        if ( isset( $_POST['ashbi_rotate_key'] ) && current_user_can( 'manage_options' ) ) {
            check_admin_referer( 'ashbi_save_settings' );
            $new_key = wp_generate_uuid_v4();
            update_option( 'ashbi_secret_key', $new_key );
            $secret_key = $new_key;
            if ( $registered && ! empty( $hub_url ) && ! empty( $api_key ) ) {
                $result = Ashbi_Health::register_with_hub( $hub_url, $api_key );
                echo is_wp_error( $result )
                    ? '<div class="notice notice-error"><p>Key rotated locally but re-registration failed: ' . esc_html( $result->get_error_message() ) . '</p></div>'
                    : '<div class="notice notice-success"><p>Secret key rotated and Hub re-registered.</p></div>';
            } else {
                echo '<div class="notice notice-success"><p>Secret key rotated. Reconnect to the Hub to sync.</p></div>';
            }
        }

        if ( isset( $_POST['ashbi_run_backup'] ) && current_user_can( 'manage_options' ) ) {
            check_admin_referer( 'ashbi_save_settings' );
            $report = Ashbi_Backup::run_full_backup();
            echo ( $report['dbSuccess'] && $report['filesSuccess'] )
                ? '<div class="notice notice-success"><p>Backup completed. DB: ' . esc_html( $report['dbFile'] ) . ', Files: ' . esc_html( $report['filesFile'] ) . '</p></div>'
                : '<div class="notice notice-warning"><p>Backup finished with issues. Check the Backup panel for details.</p></div>';
        }

        if ( isset( $_POST['ashbi_save_offsite'] ) && current_user_can( 'manage_options' ) ) {
            check_admin_referer( 'ashbi_save_settings' );
            $destination = sanitize_text_field( $_POST['ashbi_backup_destination'] ?? 'none' );
            $allowed     = [ 'none', 's3', 'b2', 'webhook' ]; // 'vps' is hidden — TODO only.
            if ( ! in_array( $destination, $allowed, true ) ) $destination = 'none';
            update_option( 'ashbi_backup_destination', $destination );

            $config = [
                'endpoint'   => isset( $_POST['ashbi_endpoint'] )   ? sanitize_text_field( wp_unslash( $_POST['ashbi_endpoint'] ) ) : '',
                'bucket'     => isset( $_POST['ashbi_bucket'] )     ? sanitize_text_field( wp_unslash( $_POST['ashbi_bucket'] ) ) : '',
                'accessKey'  => isset( $_POST['ashbi_access_key'] ) ? sanitize_text_field( wp_unslash( $_POST['ashbi_access_key'] ) ) : '',
                'secretKey'  => isset( $_POST['ashbi_secret_key'] ) ? sanitize_text_field( wp_unslash( $_POST['ashbi_secret_key'] ) ) : '',
                'region'     => isset( $_POST['ashbi_region'] )     ? sanitize_text_field( wp_unslash( $_POST['ashbi_region'] ) ) : '',
                'prefix'     => isset( $_POST['ashbi_prefix'] )     ? sanitize_text_field( wp_unslash( $_POST['ashbi_prefix'] ) ) : '',
                'webhookUrl' => isset( $_POST['ashbi_webhook_url'] ) ? esc_url_raw( wp_unslash( $_POST['ashbi_webhook_url'] ) ) : '',
            ];
            // Drop empty fields so the JSON stays compact (e.g. for the
            // S3/B2 path, a missing webhookUrl would otherwise ship as "").
            $config = array_filter( $config, function ( $v ) { return $v !== ''; } );
            update_option( 'ashbi_backup_remote_config', wp_json_encode( $config ) );

            echo '<div class="notice notice-success"><p>Off-site backup settings saved.</p></div>';
        }

        if ( isset( $_POST['ashbi_send_report'] ) && current_user_can( 'manage_options' ) ) {
            check_admin_referer( 'ashbi_save_settings' );
            Ashbi_Report::send_monthly_report();
            echo '<div class="notice notice-success"><p>Monthly report sent to admin email.</p></div>';
        }

        if ( isset( $_POST['ashbi_run_cleanup'] ) && current_user_can( 'manage_options' ) ) {
            check_admin_referer( 'ashbi_save_settings' );
            $report = Ashbi_Hygiene::run_deep_clean();
            echo '<div class="notice notice-success"><p>Cleanup completed. Revisions: ' . (int) $report['counts']['revisions'] . ', Spam: ' . (int) $report['counts']['spam_comments'] . '</p></div>';
        }

        return [ $hub_url, $api_key, $secret_key, $registered ];
    }

    public function render_settings_page() {
        list( $hub_url, $api_key, $secret_key, $registered ) = $this->handle_post_actions();

        $next_ping    = wp_next_scheduled( 'ashbi_hourly_ping' );
        $next_hygiene = wp_next_scheduled( 'ashbi_daily_hygiene' );
        $next_backup  = wp_next_scheduled( 'ashbi_weekly_backup' );
        $next_report  = wp_next_scheduled( 'ashbi_monthly_report' );
        $last_hygiene = get_option( 'ashbi_last_hygiene', false );
        $last_ping    = get_option( 'ashbi_last_ping', false );
        $last_backup  = get_option( 'ashbi_last_backup', false );
        $last_report  = get_option( 'ashbi_last_report', false );
        $wpcli_ok     = Ashbi_Executor::is_wp_cli_available();
        $hours        = Ashbi_Hours::get_status();
        ?>
        <div class="wrap ashbi-settings">
            <h1>Ashbi Agency WP Bridge <small style="font-size:12px;color:#646970;">v<?php echo esc_html( ASHBI_BRIDGE_VERSION ); ?></small></h1>
            <p class="description">Connects this WordPress site to <strong><?php echo esc_html( parse_url( $hub_url, PHP_URL_HOST ) ?: 'hub.ashbi.ca' ); ?></strong> for remote management, maintenance, backups, and support hour tracking.</p>

            <?php if ( ! $registered ) { ?>
            <!-- Setup -->
            <div class="ashbi-card">
                <h2>Connect to Hub</h2>
                <form method="post">
                    <table class="form-table">
                        <tr><th scope="row"><label for="ashbi-hub-url">Hub URL</label></th>
                            <td><input type="url" id="ashbi-hub-url" name="hub_url" value="<?php echo esc_url( $hub_url ); ?>" class="regular-text" /><p class="description">Usually <code>https://hub.ashbi.ca</code></p></td></tr>
                        <tr><th scope="row"><label for="ashbi-api-key">API Key</label></th>
                            <td>
                                <div style="position:relative;display:inline-block;">
                                    <input type="password" id="ashbi-api-key" name="api_key" value="<?php echo esc_attr( $api_key ); ?>" class="regular-text" placeholder="Paste your API key here" autocomplete="off" />
                                    <button type="button" class="button button-link ashbi-toggle-key" onclick="var f=document.getElementById('ashbi-api-key');f.type=f.type==='password'?'text':'password';this.textContent=f.type==='password'?'Show':'Hide';" style="position:absolute;right:4px;top:3px;">Show</button>
                                </div>
                                <p class="description">Get your API key from <a href="<?php echo esc_url( $hub_url ); ?>/api-keys" target="_blank"><?php echo esc_html( parse_url( $hub_url, PHP_URL_HOST ) ?: 'hub.ashbi.ca' ); ?> → Settings → API Keys</a></p>
                            </td></tr>
                    </table>
                    <?php wp_nonce_field( 'ashbi_save_settings' ); ?>
                    <p class="submit">
                        <input type="submit" name="ashbi_connect" class="button button-primary button-hero" value="Connect to Hub" />
                        <input type="submit" name="ashbi_save" class="button button-secondary" value="Save Settings Only" />
                    </p>
                </form>
            </div>

            <div class="ashbi-card">
                <h2>Quick Setup</h2>
                <ol class="ashbi-steps">
                    <li>Log into <a href="<?php echo esc_url( $hub_url ); ?>" target="_blank"><?php echo esc_html( parse_url( $hub_url, PHP_URL_HOST ) ?: 'hub.ashbi.ca' ); ?></a> and create an API key under Settings → API Keys</li>
                    <li>Paste the key above and click <strong>Connect to Hub</strong></li>
                    <li>Your site will appear in the Hub's WP Sites dashboard</li>
                </ol>
            </div>

            <?php } else { ?>
            <!-- CONNECTED STATE -->
            <div class="ashbi-card ashbi-card--connected">
                <div class="ashbi-card-header">
                    <div>
                        <h2><span class="ashbi-dot ashbi-dot--green"></span> Connected</h2>
                        <p class="description" style="margin:0;">Registered since <?php echo esc_html( get_option( 'ashbi_hub_registered_at', 'Unknown' ) ); ?></p>
                    </div>
                    <form method="post" style="margin:0;">
                        <?php wp_nonce_field( 'ashbi_save_settings' ); ?>
                        <input type="submit" name="ashbi_disconnect" class="button button-link-delete" value="Disconnect" onclick="return confirm('Disconnect from the Hub? Health pings will stop.');" />
                    </form>
                </div>
                <table class="ashbi-info-table">
                    <tr><td>Site URL</td><td><code><?php echo esc_url( home_url() ); ?></code></td></tr>
                    <tr><td>Hub URL</td><td><code><?php echo esc_url( $hub_url ); ?></code></td></tr>
                    <tr><td>Last Health Ping</td><td><?php
                        if ( $last_ping ) {
                            echo esc_html( $last_ping['timestamp'] ) . ' — ';
                            echo $last_ping['status'] === 'ok' ? '<span style="color:#46b450;">OK</span>' : '<span style="color:#dc3232;">' . esc_html( $last_ping['status'] ) . '</span>';
                        } else { echo 'No pings sent yet'; }
                    ?></td></tr>
                    <tr><td>Next Health Ping</td><td><?php
                        if ( $next_ping ) {
                            $diff = $next_ping - time();
                            echo $diff > 0 ? esc_html( human_time_diff( time(), $next_ping ) ) . ' from now' : '<span style="color:#dc3232;">Overdue</span> (will run on next cron tick)';
                        } else { echo '<span style="color:#dc3232;">Not scheduled</span>'; }
                    ?></td></tr>
                    <tr><td>Next Cleanup</td><td><?php
                        if ( $next_hygiene ) {
                            echo esc_html( human_time_diff( time(), $next_hygiene ) ) . ' from now';
                        } else { echo '<span style="color:#dc3232;">Not scheduled</span>'; }
                    ?></td></tr>
                    <tr><td>Next Backup</td><td><?php
                        if ( $next_backup ) {
                            echo esc_html( human_time_diff( time(), $next_backup ) ) . ' from now';
                        } else { echo '<span style="color:#dc3232;">Not scheduled</span>'; }
                    ?></td></tr>
                    <tr><td>Next Report</td><td><?php
                        if ( $next_report ) {
                            echo esc_html( human_time_diff( time(), $next_report ) ) . ' from now';
                        } else { echo '<span style="color:#dc3232;">Not scheduled</span>'; }
                    ?></td></tr>
                    <tr><td>WP-CLI</td><td><?php echo $wpcli_ok ? '<span style="color:#46b450;">Available</span>' : '<span style="color:#dc3232;">Disabled</span>'; ?></td></tr>
                </table>
                <form method="post" style="margin-top:12px;">
                    <?php wp_nonce_field( 'ashbi_save_settings' ); ?>
                    <input type="submit" name="ashbi_ping_now" class="button button-secondary button-small" value="Ping Now" />
                    <input type="submit" name="ashbi_run_cleanup" class="button button-secondary button-small" value="Run Cleanup Now" />
                    <input type="submit" name="ashbi_run_backup" class="button button-secondary button-small" value="Run Backup Now" />
                    <input type="submit" name="ashbi_send_report" class="button button-secondary button-small" value="Send Report Now" />
                    <input type="submit" name="ashbi_rotate_key" class="button button-secondary button-small" value="Rotate Secret Key" onclick="return confirm('This will generate a new secret key and re-register with the Hub. Continue?');" />
                </form>
            </div>

            <!-- BACKUPS -->
            <div class="ashbi-card">
                <h2>Backups</h2>
                <?php if ( $last_backup ) { ?>
                <p class="description">Last backup: <?php echo esc_html( $last_backup['timestamp'] ); ?></p>
                <table class="ashbi-info-table">
                    <tr><td>DB Backup</td><td><?php echo $last_backup['dbSuccess'] ? '<span style="color:#46b450;">Success</span>' : '<span style="color:#dc3232;">Failed</span>'; ?> (<code><?php echo esc_html( $last_backup['dbFile'] ); ?></code>)</td></tr>
                    <tr><td>Files Backup</td><td><?php echo $last_backup['filesSuccess'] ? '<span style="color:#46b450;">Success</span>' : '<span style="color:#dc3232;">Failed</span>'; ?> (<code><?php echo esc_html( $last_backup['filesFile'] ); ?></code>)</td></tr>
                </table>
                <?php } else { ?>
                <p class="description">No backup run yet. Click <em>Run Backup Now</em> above to generate the first one.</p>
                <?php } ?>

                <?php $backups = Ashbi_Backup::list_backups(); if ( ! empty( $backups ) ) { ?>
                <h3>Available Backups</h3>
                <table class="ashbi-info-table">
                    <?php foreach ( array_slice( $backups, 0, 4 ) as $b ) { ?>
                    <tr>
                        <td><?php echo esc_html( $b['timestamp'] ); ?></td>
                        <td>DB: <?php echo size_format( $b['dbSize'] ); ?></td>
                        <td>Files: <?php echo size_format( $b['filesSize'] ); ?></td>
                    </tr>
                    <?php } ?>
                </table>
                <?php } ?>

                <?php $auto_backups = Ashbi_Backup::list_auto_backups(); if ( ! empty( $auto_backups ) ) { ?>
                <h3>Auto-Backups (pre-change)</h3>
                <table class="ashbi-info-table">
                    <?php foreach ( array_slice( $auto_backups, -5 ) as $ab ) { ?>
                    <tr>
                        <td><?php echo esc_html( $ab['timestamp'] ); ?></td>
                        <td><code><?php echo esc_html( $ab['original'] ); ?></code></td>
                    </tr>
                    <?php } ?>
                </table>
                <?php } ?>
            </div>

            <!-- OFF-SITE BACKUP -->
            <?php
                $destination = get_option( 'ashbi_backup_destination', 'none' );
                $config_raw  = get_option( 'ashbi_backup_remote_config', '{}' );
                $config      = is_string( $config_raw ) ? ( json_decode( $config_raw, true ) ?: [] ) : (array) $config_raw;
                $last_remote = ( is_array( $last_backup ) && isset( $last_backup['remote_push'] ) ) ? $last_backup['remote_push'] : null;
            ?>
            <div class="ashbi-card">
                <h2>Off-Site Backup</h2>
                <p class="description">Pushes the .sql and .zip files to a remote destination after every successful local backup. Local-first — a remote push failure never fails the local backup.</p>

                <?php if ( $last_remote ) { ?>
                <table class="ashbi-info-table">
                    <tr><td>Destination</td><td><code><?php echo esc_html( $last_remote['destination'] ?? 'unknown' ); ?></code></td></tr>
                    <tr><td>Last status</td><td>
                        <?php echo ( $last_remote['status'] ?? '' ) === 'ok'
                            ? '<span style="color:#46b450;">OK</span>'
                            : '<span style="color:#dc3232;">' . esc_html( $last_remote['error'] ?? $last_remote['status'] ?? 'error' ) . '</span>'; ?>
                    </td></tr>
                    <?php if ( ! empty( $last_remote['url'] ) ) { ?>
                    <tr><td>Remote URL</td><td><code style="word-break:break-all;"><?php echo esc_html( $last_remote['url'] ); ?></code></td></tr>
                    <?php } ?>
                    <?php if ( isset( $last_remote['bytes_sent'] ) ) { ?>
                    <tr><td>Bytes sent</td><td><?php echo esc_html( size_format( (int) $last_remote['bytes_sent'] ) ); ?></td></tr>
                    <?php } ?>
                </table>
                <?php } ?>

                <form method="post">
                    <?php wp_nonce_field( 'ashbi_save_settings' ); ?>
                    <table class="form-table">
                        <tr><th scope="row"><label for="ashbi-backup-destination">Destination</label></th>
                            <td>
                                <select id="ashbi-backup-destination" name="ashbi_backup_destination" class="regular-text">
                                    <option value="none" <?php selected( $destination, 'none' ); ?>>None (local only)</option>
                                    <option value="s3" <?php selected( $destination, 's3' ); ?>>S3-compatible (HTTPS PUT)</option>
                                    <option value="b2" <?php selected( $destination, 'b2' ); ?>>Backblaze B2 (HTTPS PUT)</option>
                                    <option value="webhook" <?php selected( $destination, 'webhook' ); ?>>Generic webhook (multipart POST)</option>
                                </select>
                                <p class="description">VPS/SFTP is on the roadmap — see TODO in <code>push_to_remote()</code>.</p>
                            </td></tr>

                        <tr><th colspan="2" style="padding-top:16px;">S3 / B2 config</th></tr>
                        <tr><th scope="row"><label for="ashbi-endpoint">Endpoint</label></th>
                            <td><input type="url" id="ashbi-endpoint" name="ashbi_endpoint" value="<?php echo esc_attr( $config['endpoint'] ?? '' ); ?>" class="regular-text" placeholder="https://s3.us-west-001.backblazeb2.com" /></td></tr>
                        <tr><th scope="row"><label for="ashbi-bucket">Bucket</label></th>
                            <td><input type="text" id="ashbi-bucket" name="ashbi_bucket" value="<?php echo esc_attr( $config['bucket'] ?? '' ); ?>" class="regular-text" placeholder="my-backup-bucket" /></td></tr>
                        <tr><th scope="row"><label for="ashbi-region">Region</label></th>
                            <td><input type="text" id="ashbi-region" name="ashbi_region" value="<?php echo esc_attr( $config['region'] ?? '' ); ?>" class="regular-text" placeholder="us-west-001" /></td></tr>
                        <tr><th scope="row"><label for="ashbi-prefix">Prefix</label></th>
                            <td><input type="text" id="ashbi-prefix" name="ashbi_prefix" value="<?php echo esc_attr( $config['prefix'] ?? '' ); ?>" class="regular-text" placeholder="ashbi/<?php echo esc_attr( sanitize_file_name( parse_url( home_url(), PHP_URL_HOST ) ?: 'site' ) ); ?>" />
                                <p class="description">Optional key prefix. Leave blank to push to the bucket root.</p></td></tr>
                        <tr><th scope="row"><label for="ashbi-access-key">Access Key / Bearer token</label></th>
                            <td><input type="password" id="ashbi-access-key" name="ashbi_access_key" value="<?php echo esc_attr( $config['accessKey'] ?? '' ); ?>" class="regular-text" autocomplete="off" /></td></tr>
                        <tr><th scope="row"><label for="ashbi-secret-key">Secret Key</label></th>
                            <td><input type="password" id="ashbi-secret-key" name="ashbi_secret_key" value="<?php echo esc_attr( $config['secretKey'] ?? '' ); ?>" class="regular-text" autocomplete="off" />
                                <p class="description">Stored locally for future SigV4 signing (not used yet — current S3 push uses Bearer auth only).</p></td></tr>

                        <tr><th colspan="2" style="padding-top:16px;">Webhook config</th></tr>
                        <tr><th scope="row"><label for="ashbi-webhook-url">Webhook URL</label></th>
                            <td><input type="url" id="ashbi-webhook-url" name="ashbi_webhook_url" value="<?php echo esc_attr( $config['webhookUrl'] ?? '' ); ?>" class="regular-text" placeholder="https://hooks.example.com/ashbi-backup" />
                                <p class="description">Receives a <code>POST</code> with the file as <code>multipart/form-data</code>.</p></td></tr>
                    </table>
                    <p class="submit">
                        <input type="submit" name="ashbi_save_offsite" class="button button-primary" value="Save Off-Site Settings" />
                    </p>
                </form>
            </div>

            <!-- SUPPORT HOURS -->
            <div class="ashbi-card">
                <h2>Support Hours</h2>
                <p class="description">Cycle started: <?php echo esc_html( $hours['cycle_start'] ); ?></p>
                <table class="ashbi-info-table">
                    <tr><td>Included monthly</td><td><?php echo (float) $hours['included_monthly']; ?> hour</td></tr>
                    <tr><td>Total available</td><td><strong><?php echo (float) $hours['available']; ?> hours</strong></td></tr>
                    <tr><td>Used this month</td><td><?php echo (float) $hours['used_this_month']; ?> hours</td></tr>
                    <tr><td>Remaining</td><td><strong style="color:<?php echo $hours['remaining'] > 0 ? '#46b450' : '#dc3232'; ?>;"><?php echo (float) $hours['remaining']; ?> hours</strong></td></tr>
                    <tr><td>Max banked</td><td><?php echo (float) $hours['max_banked']; ?> hours</td></tr>
                </table>

                <?php $hour_log = Ashbi_Hours::get_log( 10 ); if ( ! empty( $hour_log ) ) { ?>
                <h3>Recent Activity</h3>
                <table class="ashbi-info-table">
                    <?php foreach ( $hour_log as $entry ) { ?>
                    <tr>
                        <td><?php echo esc_html( $entry['timestamp'] ); ?></td>
                        <td><span style="text-transform:capitalize;"><?php echo esc_html( $entry['type'] ); ?></span></td>
                        <td><?php echo (float) $entry['hours']; ?> hour</td>
                        <td><?php echo esc_html( $entry['task'] ); ?></td>
                    </tr>
                    <?php } ?>
                </table>
                <?php } ?>
            </div>

            <!-- LAST CLEANUP -->
            <div class="ashbi-card">
                <h2>Last Cleanup</h2>
                <?php if ( $last_hygiene ) { ?>
                <p class="description"><?php echo esc_html( $last_hygiene['timestamp'] ); ?></p>
                <table class="ashbi-info-table">
                    <?php if ( isset( $last_hygiene['counts']['revisions'] ) ) { ?><tr><td>Revisions removed</td><td><?php echo (int) $last_hygiene['counts']['revisions']; ?></td></tr>
                    <?php } ?>
                    <?php if ( isset( $last_hygiene['counts']['spam_comments'] ) ) { ?><tr><td>Spam comments removed</td><td><?php echo (int) $last_hygiene['counts']['spam_comments']; ?></td></tr>
                    <?php } ?>
                    <?php if ( isset( $last_hygiene['counts']['trash_posts'] ) ) { ?><tr><td>Trash posts removed</td><td><?php echo (int) $last_hygiene['counts']['trash_posts']; ?></td></tr>
                    <?php } ?>
                    <?php if ( isset( $last_hygiene['counts']['expired_tokens'] ) ) { ?><tr><td>Expired tokens removed</td><td><?php echo (int) $last_hygiene['counts']['expired_tokens']; ?></td></tr>
                    <?php } ?>
                    <?php if ( isset( $last_hygiene['ssl'] ) ) { ?><tr><td>SSL Status</td><td><?php echo esc_html( $last_hygiene['ssl']['status'] ); ?> (<?php echo (int) $last_hygiene['ssl']['days']; ?> days)</td></tr>
                    <?php } ?>
                </table>
                <?php } else { ?>
                <p class="description">No cleanup run yet. Click <em>Run Cleanup Now</em> above to trigger it.</p>
                <?php } ?>
            </div>

            <!-- LAST REPORT -->
            <div class="ashbi-card">
                <h2>Last Report</h2>
                <?php if ( $last_report ) { ?>
                <p class="description">Sent <?php echo esc_html( $last_report['timestamp'] ); ?> to <?php echo esc_html( $last_report['sent_to'] ); ?></p>
                <?php } else { ?>
                <p class="description">No report sent yet. Reports run automatically each month. Click <em>Send Report Now</em> above to test.</p>
                <?php } ?>
            </div>

            <!-- SETTINGS FORM -->
            <div class="ashbi-card">
                <h2>Settings</h2>
                <form method="post">
                    <table class="form-table">
                        <tr><th scope="row"><label for="ashbi-hub-url">Hub URL</label></th>
                            <td><input type="url" id="ashbi-hub-url" name="hub_url" value="<?php echo esc_url( $hub_url ); ?>" class="regular-text" /></td></tr>
                        <tr><th scope="row"><label for="ashbi-api-key">API Key</label></th>
                            <td>
                                <div style="position:relative;display:inline-block;">
                                    <input type="password" id="ashbi-api-key" name="api_key" value="<?php echo esc_attr( $api_key ); ?>" class="regular-text" autocomplete="off" />
                                    <button type="button" class="button button-link ashbi-toggle-key" onclick="var f=document.getElementById('ashbi-api-key');f.type=f.type==='password'?'text':'password';this.textContent=f.type==='password'?'Show':'Hide';" style="position:absolute;right:4px;top:3px;">Show</button>
                                </div>
                            </td></tr>
                    </table>
                    <?php wp_nonce_field( 'ashbi_save_settings' ); ?>
                    <p class="submit">
                        <input type="submit" name="ashbi_save" class="button button-primary" value="Save Settings" />
                        <input type="submit" name="ashbi_connect" class="button button-secondary" value="Reconnect to Hub" />
                    </p>
                </form>
            </div>

            <!-- UPDATES -->
            <div class="ashbi-card">
                <h2>Updates</h2>
                <p class="description">Version installed: <strong><?php echo esc_html( ASHBI_BRIDGE_VERSION ); ?></strong></p>
                <form method="post">
                    <?php wp_nonce_field( 'ashbi_save_settings' ); ?>
                    <table class="form-table">
                        <tr><th>Auto-update from GitHub</th>
                            <td>
                                <label><input type="checkbox" name="ashbi_auto_update" value="1" <?php checked( get_option( 'ashbi_auto_update', false ) ); ?> /> Enable automatic updates when a new release is published</label>
                                <p class="description">Auto-updates from releases at <code>https://github.com/camster91/ashbi-agency-wp-bridge/releases</code></p>
                            </td></tr>
                    </table>
                    <p class="submit">
                        <input type="submit" name="ashbi_save" class="button button-primary" value="Save" />
                        <a href="<?php echo wp_nonce_url( admin_url( 'plugins.php?ashbi_force_check=1' ), 'ashbi_force_check' ); ?>" class="button button-secondary">Check for Updates Now</a>
                    </p>
                </form>
            </div>

            <!-- FEATURES -->
            <div class="ashbi-card">
                <h2>All Features (v<?php echo esc_html( ASHBI_BRIDGE_VERSION ); ?>)</h2>
                <ul class="ashbi-features">
                    <li><span class="dashicons dashicons-bell"></span> <strong>Admin Alerts</strong> — Webhook (plus Slack/Telegram mirror) when admins are created or promoted</li>
                    <li><span class="dashicons dashicons-admin-network"></span> <strong>Magic Login</strong> — 60-second SSO tokens, admin-only, rate-limited to 5/IP/minute</li>
                    <li><span class="dashicons dashicons-heart"></span> <strong>Health Pings</strong> — Hourly heartbeat with TTFB, DB size, and disk usage</li>
                    <li><span class="dashicons dashicons-admin-tools"></span> <strong>WP-CLI Access</strong> — Whitelisted subcommands only (plugin/theme/core/transient/cache/db/cron)</li>
                    <li><span class="dashicons dashicons-trash"></span> <strong>Auto Cleanup</strong> — Daily purge of revisions, spam comments, and expired transients</li>
                    <li><span class="dashicons dashicons-shield"></span> <strong>HMAC + Replay Protection</strong> — sha256 X-Ashbi-Signature with optional 300s timestamp window</li>
                    <li><span class="dashicons dashicons-database"></span> <strong>Full-Site Backups</strong> — Weekly DB + files, OLS-safe backup dir, auto-backup before file edits</li>
                    <li><span class="dashicons dashicons-clock"></span> <strong>Tier-Based Hours</strong> — basic / professional / agency quotas with monthly rollover up to the banked cap</li>
                    <li><span class="dashicons dashicons-chart-area"></span> <strong>Monthly Executive Report</strong> — Verdict, summary, SEO health, and action items — Ashbi-branded HTML email</li>
                    <li><span class="dashicons dashicons-lock"></span> <strong>SSL Monitoring</strong> — Daily expiry checks with alerting before certs lapse</li>
                    <li><span class="dashicons dashicons-search"></span> <strong>Custom Checks</strong> — Agency-tier extension point via <code>ashbi_register_checks</code> filter</li>
                    <li><span class="dashicons dashicons-list-view"></span> <strong>Option / File Blocklists</strong> — Refuses secret salts, API keys, admin email, default role, wp-config, .env, .bak, .sql, backups dir</li>
                    <li><span class="dashicons dashicons-update"></span> <strong>SHA256-Verified Updates</strong> — Releases ship with SHA256SUMS; updates verified before apply</li>
                    <li><span class="dashicons dashicons-cloud"></span> <strong>sslverify Rollout</strong> — Outbound hub traffic and SSL self-checks use TLS verification</li>
                </ul>
            </div>
            <?php } ?>
        </div>

        <style>
            .ashbi-settings > .description { margin-top: 0; font-size: 14px; }
            .ashbi-card { background: #fff; border: 1px solid #c3c4c7; border-radius: 4px; padding: 16px 24px; margin-top: 16px; max-width: 700px; }
            .ashbi-card h2, .ashbi-card h3 { margin-top: 0; padding-top: 0; font-size: 16px; }
            .ashbi-card--connected { border-left: 4px solid #46b450; }
            .ashbi-card-header { display: flex; align-items: flex-start; justify-content: space-between; }
            .ashbi-card-header h2 { margin-bottom: 0; }
            .ashbi-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 4px; }
            .ashbi-dot--green { background: #46b450; }
            .ashbi-info-table { border-collapse: collapse; width: 100%; margin-top: 12px; }
            .ashbi-info-table td { padding: 6px 12px 6px 0; border-bottom: 1px solid #f0f0f1; font-size: 13px; }
            .ashbi-info-table td:first-child { color: #646970; width: 180px; white-space: nowrap; }
            .ashbi-info-table code { background: #f0f0f1; padding: 2px 6px; font-size: 12px; }
            .ashbi-steps { line-height: 2; max-width: 600px; }
            .ashbi-features { list-style: none; padding: 0; }
            .ashbi-features li { padding: 6px 0; font-size: 13px; }
            .ashbi-features .dashicons { color: #2271b1; margin-right: 6px; vertical-align: middle; }
            .ashbi-toggle-key { font-size: 11px !important; text-decoration: none !important; color: #2271b1 !important; padding: 2px 6px !important; min-height: auto !important; line-height: 1.5 !important; }
        </style>
        <?php
    }
}
