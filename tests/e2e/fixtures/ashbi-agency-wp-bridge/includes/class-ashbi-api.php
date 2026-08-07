<?php
if ( ! defined( 'ABSPATH' ) ) exit;

class Ashbi_API {
    public function __construct() {
        add_action( 'rest_api_init', [ $this, 'register_routes' ] );
    }

    public function register_routes() {
        register_rest_route( 'ashbi/v1', '/ping', [
            'methods'  => 'GET',
            'callback' => [ $this, 'ping' ],
            'permission_callback' => '__return_true',
        ]);
        register_rest_route( 'ashbi/v1', '/register', [
            'methods'  => 'POST',
            'callback' => [ $this, 'register_site' ],
            'permission_callback' => function() { return current_user_can( 'manage_options' ); },
        ]);
        register_rest_route( 'ashbi/v1', '/health', [
            'methods'  => 'POST',
            'callback' => [ $this, 'health' ],
            'permission_callback' => [ 'Ashbi_Auth', 'verify_signature' ],
        ]);
        register_rest_route( 'ashbi/v1', '/command', [
            'methods'  => 'POST',
            'callback' => [ $this, 'command' ],
            'permission_callback' => [ 'Ashbi_Auth', 'verify_signature' ],
        ]);
        register_rest_route( 'ashbi/v1', '/command/batch', [
            'methods'  => 'POST',
            'callback' => [ $this, 'command_batch' ],
            'permission_callback' => [ 'Ashbi_Auth', 'verify_signature' ],
        ]);
        register_rest_route( 'ashbi/v1', '/file/read', [
            'methods'  => 'POST',
            'callback' => [ $this, 'read_file' ],
            'permission_callback' => [ 'Ashbi_Auth', 'verify_signature' ],
        ]);
        register_rest_route( 'ashbi/v1', '/file/patch', [
            'methods'  => 'POST',
            'callback' => [ $this, 'patch_file' ],
            'permission_callback' => [ 'Ashbi_Auth', 'verify_signature' ],
        ]);
        register_rest_route( 'ashbi/v1', '/magic-login', [
            'methods'  => 'POST',
            'callback' => [ $this, 'magic_login' ],
            'permission_callback' => [ 'Ashbi_Auth', 'verify_signature' ],
        ]);
        register_rest_route( 'ashbi/v1', '/magic-login/revoke', [
            'methods'  => 'POST',
            'callback' => [ $this, 'magic_login_revoke' ],
            'permission_callback' => [ 'Ashbi_Auth', 'verify_signature' ],
        ]);
        register_rest_route( 'ashbi/v1', '/magic-login/log', [
            'methods'  => 'GET',
            'callback' => [ $this, 'magic_login_log' ],
            'permission_callback' => [ 'Ashbi_Auth', 'verify_signature' ],
        ]);
        register_rest_route( 'ashbi/v1', '/hygiene/run', [
            'methods'  => 'POST',
            'callback' => [ $this, 'hygiene' ],
            'permission_callback' => [ 'Ashbi_Auth', 'verify_signature' ],
        ]);
        register_rest_route( 'ashbi/v1', '/backup/run', [
            'methods'  => 'POST',
            'callback' => [ $this, 'backup' ],
            'permission_callback' => [ 'Ashbi_Auth', 'verify_signature' ],
        ]);
        register_rest_route( 'ashbi/v1', '/backup/list', [
            'methods'  => 'POST',
            'callback' => [ $this, 'backup_list' ],
            'permission_callback' => [ 'Ashbi_Auth', 'verify_signature' ],
        ]);
        register_rest_route( 'ashbi/v1', '/hours/status', [
            'methods'  => 'POST',
            'callback' => [ $this, 'hours_status' ],
            'permission_callback' => [ 'Ashbi_Auth', 'verify_signature' ],
        ]);
        register_rest_route( 'ashbi/v1', '/hours/use', [
            'methods'  => 'POST',
            'callback' => [ $this, 'hours_use' ],
            'permission_callback' => [ 'Ashbi_Auth', 'verify_signature' ],
        ]);
        register_rest_route( 'ashbi/v1', '/report/send', [
            'methods'  => 'POST',
            'callback' => [ $this, 'report_send' ],
            'permission_callback' => [ 'Ashbi_Auth', 'verify_signature' ],
        ]);
        register_rest_route( 'ashbi/v1', '/option/get', [
            'methods'  => 'POST',
            'callback' => [ $this, 'option_get' ],
            'permission_callback' => [ 'Ashbi_Auth', 'verify_signature' ],
        ]);
        register_rest_route( 'ashbi/v1', '/option/set', [
            'methods'  => 'POST',
            'callback' => [ $this, 'option_set' ],
            'permission_callback' => [ 'Ashbi_Auth', 'verify_signature' ],
        ]);
    }

    public function ping() {
        $rate = $this->check_ping_rate_limit();
        if ( is_wp_error( $rate ) ) return $rate;
        $response = new WP_REST_Response([
            'pong' => true,
        ], 200);
        $response->header( 'Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0' );
        return $response;
    }

    public function register_site( $request ) {
        $params  = $request->get_json_params();
        $api_key = $params['apiKey'] ?? '';
        if ( empty( $api_key ) ) return new WP_Error( 'missing_key', 'apiKey is required', ['status' => 400] );

        update_option( 'ashbi_hub_url', $params['hubUrl'] ?? 'https://hub.ashbi.ca' );
        update_option( 'ashbi_api_key', $api_key );
        update_option( 'ashbi_secret_key', $params['secretKey'] ?? wp_generate_uuid_v4() );

        $result = Ashbi_Health::register_with_hub( get_option( 'ashbi_hub_url' ), $api_key );
        if ( is_wp_error( $result ) ) return $result;

        if ( ! wp_next_scheduled( 'ashbi_hourly_ping' ) ) wp_schedule_event( time(), 'hourly', 'ashbi_hourly_ping' );

        return new WP_REST_Response([ 'success' => true, 'hubUrl' => get_option( 'ashbi_hub_url' ), 'message' => 'Site registered with hub.' ], 200 );
    }

    public function health( $request ) {
        $rate_check = $this->check_rate_limit();
        if ( is_wp_error( $rate_check ) ) return $rate_check;
        // Auth is HMAC-only via Ashbi_Auth::verify_signature (route's permission_callback).
        // Earlier versions also accepted $params['secretKey'] == stored secret as an alternate
        // auth path, but that bypassed the 300-second replay window and exposed the secret in
        // request bodies that get logged by debug plugins. HMAC is the only path now.
        Ashbi_Health::ping_hub( get_option( 'ashbi_hub_url' ), get_option( 'ashbi_api_key' ) );
        return new WP_REST_Response(['status' => 'ok'], 200);
    }

    private function check_rate_limit() {
        $limit  = defined( 'ASHBI_RATE_LIMIT' ) ? ASHBI_RATE_LIMIT : 10;
        $window = defined( 'ASHBI_RATE_WINDOW' ) ? ASHBI_RATE_WINDOW : 60;
        $key    = 'ashbi_rate_' . gmdate( 'YmdH' );
        $count  = (int) get_transient( $key );
        if ( $count >= $limit ) return new WP_Error( 'rate_limited', 'Too many requests. Try again later.', [ 'status' => 429 ] );
        set_transient( $key, $count + 1, $window );
        return true;
    }

    /**
     * Public /ping rate limit — per-IP, looser than authenticated routes,
     * so probes can't be used as a cheap DoS amplifier.
     */
    private function check_ping_rate_limit() {
        $ip  = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '0.0.0.0';
        $key = 'ashbi_ping_' . md5( $ip );
        $count = (int) get_transient( $key );
        if ( $count >= 30 ) {
            return new WP_Error( 'rate_limited', 'Too many ping requests.', [ 'status' => 429 ] );
        }
        set_transient( $key, $count + 1, MINUTE_IN_SECONDS );
        return true;
    }

    public function command( $request ) {
        $rate_check = $this->check_rate_limit();
        if ( is_wp_error( $rate_check ) ) return $rate_check;
        $params = $request->get_json_params();
        $cmd    = $params['cmd'] ?? '';
        if ( empty( $cmd ) ) return new WP_Error( 'no_cmd', 'No command provided', ['status' => 400] );
        Ashbi_Logger::log( '/command', $params, 'running' );
        $result = Ashbi_Executor::run_wp_cli( $cmd );
        if ( ! $result['success'] ) return new WP_Error( 'command_rejected', $result['output'], ['status' => 403] );
        return new WP_REST_Response(['output' => $result['output']], 200);
    }

    public function command_batch( $request ) {
        $rate_check = $this->check_rate_limit();
        if ( is_wp_error( $rate_check ) ) return $rate_check;
        $params = $request->get_json_params();
        $commands = $params['commands'] ?? [];
        if ( empty( $commands ) || ! is_array( $commands ) ) return new WP_Error( 'no_commands', 'commands array is required', ['status' => 400] );
        if ( count( $commands ) > 20 ) return new WP_Error( 'too_many', 'Maximum 20 commands per batch', ['status' => 400] );
        Ashbi_Logger::log( '/command/batch', [ 'count' => count( $commands ) ], 'running' );
        $results = [];
        foreach ( $commands as $cmd ) {
            $result = Ashbi_Executor::run_wp_cli( $cmd );
            $results[] = [ 'command' => $cmd, 'success' => $result['success'], 'output' => $result['output'] ];
        }
        return new WP_REST_Response(['results' => $results], 200);
    }

    public function read_file( $request ) {
        $rate_check = $this->check_rate_limit();
        if ( is_wp_error( $rate_check ) ) return $rate_check;
        $params = $request->get_json_params();
        $path   = isset( $params['path'] ) ? sanitize_text_field( $params['path'] ) : '';
        if ( empty( $path ) || false !== strpos( $path, '..' ) ) return new WP_Error( 'invalid_path', 'Invalid path', ['status' => 400] );
        if ( self::is_blocked_file_path( $path ) ) return new WP_Error( 'invalid_path', 'This file cannot be read remotely.', ['status' => 403] );
        // Same allowlist as /file/patch — a valid HMAC must not be enough to
        // exfiltrate arbitrary files under ABSPATH (uploads, other plugins, etc.).
        if ( ! self::is_allowed_file_path( $path ) ) return new WP_Error( 'invalid_path', 'This path is not in the remote-read allowlist (plugin directory or active theme).', ['status' => 403] );
        $abs_path = ABSPATH . ltrim( $path, '/' );
        $abspath_real = realpath( ABSPATH );
        if ( false === $abspath_real ) return new WP_Error( 'invalid_path', 'WordPress root not resolvable.', ['status' => 400] );
        $resolved = realpath( $abs_path );
        if ( false === $resolved || 0 !== strpos( $resolved, $abspath_real . DIRECTORY_SEPARATOR ) ) return new WP_Error( 'invalid_path', 'Path outside WordPress root', ['status' => 400] );
        Ashbi_Logger::log( '/file/read', [ 'path' => $path ], 'running' );
        $result = Ashbi_Executor::read_file( $path );
        if ( ! $result['success'] ) return new WP_Error( 'file_error', $result['error'], ['status' => 400] );
        return new WP_REST_Response(['content' => $result['content']], 200);
    }

    public function patch_file( $request ) {
        $rate_check = $this->check_rate_limit();
        if ( is_wp_error( $rate_check ) ) return $rate_check;
        $params = $request->get_json_params();
        $path   = isset( $params['path'] ) ? sanitize_text_field( $params['path'] ) : '';
        if ( empty( $path ) || false !== strpos( $path, '..' ) ) return new WP_Error( 'invalid_path', 'Invalid path', ['status' => 400] );
        if ( self::is_blocked_file_path( $path ) ) return new WP_Error( 'invalid_path', 'This file cannot be patched remotely.', ['status' => 403] );
        if ( ! self::is_allowed_file_path( $path ) ) return new WP_Error( 'invalid_path', 'This path is not in the remote-patch allowlist (plugin directory or active theme).', ['status' => 403] );
        if ( ! isset( $params['find'] ) || ! isset( $params['replace'] ) ) return new WP_Error( 'missing_params', 'find and replace parameters are required', ['status' => 400] );
        Ashbi_Logger::log( '/file/patch', [ 'path' => $path ], 'running' );
        $result = Ashbi_Executor::patch_file( $path, $params['find'], $params['replace'] );
        if ( ! $result['success'] ) return new WP_Error( 'file_error', $result['error'], ['status' => 400] );
        return new WP_REST_Response(['message' => $result['message']], 200);
    }

    /**
     * POST /magic-login/revoke
     * Body: { hash: 'sha256-hex-of-token' }
     *
     * Allows the hub to invalidate a token before its natural expiry
     * (e.g. operator cancels a login attempt from the dashboard).
     * Delegates to Ashbi_Magic_Login::revoke_by_hash() — see that class
     * for the canonicalization rules.
     */
    public function magic_login_revoke( $request ) {
        $rate_check = $this->check_rate_limit();
        if ( is_wp_error( $rate_check ) ) return $rate_check;
        $params = $request->get_json_params();
        $hash   = isset( $params['hash'] ) ? (string) $params['hash'] : '';
        $result = Ashbi_Magic_Login::revoke_by_hash( $hash );
        if ( is_wp_error( $result ) ) return $result;
        return new WP_REST_Response( [ 'revoked' => true, 'hash' => $result ], 200 );
    }

    /**
     * GET /magic-login/log
     * Returns the last N entries from the magic-login audit log.
     */
    public function magic_login_log( $request ) {
        $rate_check = $this->check_rate_limit();
        if ( is_wp_error( $rate_check ) ) return $rate_check;
        $params = $request->get_json_params();
        $limit  = isset( $params['limit'] ) ? max( 1, min( 500, (int) $params['limit'] ) ) : 100;
        return new WP_REST_Response( [ 'entries' => Ashbi_Magic_Login::get_audit_log( $limit ) ], 200 );
    }

    /**
     * Block remote read/patch of known-sensitive file paths.
     *
     * wp-config.php holds DB credentials and all 8 secret salts even though
     * `/option/get` blocks the same fields — the option blocklist gives a
     * false sense of safety because update_option() never touches wp-config.php.
     * Backups, .bak files, .env, and SSH keys are blocked for the same reason.
     *
     * @param string $path Path relative to ABSPATH.
     * @return bool True if the path should be rejected.
     */
    private static function is_blocked_file_path( $path ) {
        $normalized = ltrim( str_replace( '\\', '/', $path ), '/' );
        $basename   = basename( $normalized );

        // Exact file matches — case-insensitive on case-insensitive
        // filesystems (macOS APFS, Windows NTFS) where PHP file lookups are
        // case-insensitive, so Wp-Config.PHP, WP-CONFIG.PHP, .ENV, etc.
        // must all hit the same denylist.
        $blocked_files = [
            'wp-config.php',
            '.env',
            '.env.local',
            '.env.production',
        ];
        $basename_lc      = strtolower( $basename );
        $blocked_files_lc = array_map( 'strtolower', $blocked_files );
        if ( in_array( $basename_lc, $blocked_files_lc, true ) ) {
            return true;
        }

        // Extension / pattern matches — patterns already carry the `/i`
        // flag, so we keep matching against the original $basename (any
        // casing works under the flag). No change needed here.
        $blocked_patterns = [
            '/\.bak$/i',
            '/\.sql$/i',
            '/\.sqlite$/i',
            '/\.sqlite3$/i',
            '/\.dump$/i',
            '/^id_rsa/i',
            '/^id_ed25519/i',
            '/^id_ecdsa/i',
            '/^id_dsa/i',
            '/\.pem$/i',
            '/\.key$/i',
            '/\.p12$/i',
            '/\.pfx$/i',
        ];
        foreach ( $blocked_patterns as $pattern ) {
            if ( preg_match( $pattern, $basename ) ) {
                return true;
            }
        }

        // Backup directory and any descendant — site is `wp-content/ashbi-backups/`,
        // plus any other backup-style directory at the root.
        $blocked_dirs = [
            'wp-content/ashbi-backups',
            'wp-content/uploads/ashbi_agency',
            'wp-content/backup-db',
            'wp-content/backups',
            'wp-content/uploads/backwpup',
            'wp-content/uploads/backups',
        ];
        foreach ( $blocked_dirs as $dir ) {
            if ( $normalized === $dir || strpos( $normalized, $dir . '/' ) === 0 ) {
                return true;
            }
        }

        return false;
    }

    /**
     * Allowlist for remote file operations. Only paths under these prefixes
     * can be read/patched remotely, even with a valid signature.
     *
     * Denylist (is_blocked_file_path) catches obvious bad paths. Allowlist
     * catches everything else — defense in depth so a signed attacker can't
     * rewrite wp-config.php, wp-includes/*.php, theme files outside the
     * active theme, or other site core files via a forgotten denylist entry.
     *
     * Allowed:
     *   - wp-content/plugins/ashbi-agency-wp-bridge/*   (this plugin)
     *   - wp-content/themes/<active-theme>/*           (theme.json + .php)
     *
     * Override via filter (e.g. for a child theme or a secondary plugin).
     */
    private static function is_allowed_file_path( $path ) {
        $normalized = ltrim( str_replace( '\\', '/', $path ), '/' );

        $allowed_prefixes = [
            'wp-content/plugins/ashbi-agency-wp-bridge/',
        ];

        // Active theme dir — pulled at call time so theme switches take effect
        // immediately. get_option() is the WP canonical source.
        $active_theme = get_option( 'stylesheet' );
        if ( $active_theme ) {
            $allowed_prefixes[] = 'wp-content/themes/' . $active_theme . '/';
        }

        /**
         * Filter the remote-file allowlist prefixes.
         *
         * @param string[] $allowed_prefixes Absolute path prefixes (relative to ABSPATH, trailing slash).
         * @param string   $normalized      The path being checked (already lowercased-normalized).
         */
        $allowed_prefixes = apply_filters( 'ashbi_allowed_file_prefixes', $allowed_prefixes, $normalized );

        foreach ( $allowed_prefixes as $prefix ) {
            if ( strpos( $normalized, $prefix ) === 0 ) {
                return true;
            }
        }
        return false;
    }

    public function magic_login( $request ) {
        $rate_check = $this->check_rate_limit();
        if ( is_wp_error( $rate_check ) ) return $rate_check;

        // Dedicated magic-login rate limit + optional hub IP allowlist.
        $ml_rate = Ashbi_Magic_Login::check_rate_limit();
        if ( is_wp_error( $ml_rate ) ) return $ml_rate;
        $ip_ok = Ashbi_Magic_Login::check_ip_allowlist();
        if ( is_wp_error( $ip_ok ) ) return $ip_ok;

        $params  = $request->get_json_params();
        $user_id = isset( $params['user_id'] ) ? absint( $params['user_id'] ) : 0;
        if ( empty( $user_id ) ) return new WP_Error( 'missing_user', 'user_id is required.', ['status' => 400] );
        $user = get_userdata( $user_id );
        if ( ! $user ) return new WP_Error( 'invalid_user', 'User not found', ['status' => 404] );
        // Require the target to be an administrator — magic-login is a privileged
        // operation and we never want to mint a login token for a low-privilege account.
        if ( ! in_array( 'administrator', (array) $user->roles, true ) ) {
            return new WP_Error( 'not_admin', 'Magic login is only available for administrators.', ['status' => 403] );
        }

        // Issue via Ashbi_Magic_Login so /magic-login/revoke (hash-based) and
        // the ?ashbi_sso= consume path share one token store. The legacy
        // Ashbi_SSO DB table is no longer the source of truth for new tokens.
        $issued = Ashbi_Magic_Login::issue( $user_id, [ 'issued_by' => 'hub' ] );
        if ( is_wp_error( $issued ) ) return $issued;

        $response = new WP_REST_Response([
            'url'        => home_url( '/?ashbi_sso=' . $issued['token'] ),
            'user'       => $user->user_login,
            'hash'       => $issued['hash'],
            'expires_at' => $issued['expires_at'],
        ], 200);
        $response->header( 'Cache-Control', 'no-store, no-cache, must-revalidate' );
        return $response;
    }

    public function hygiene() {
        $rate_check = $this->check_rate_limit();
        if ( is_wp_error( $rate_check ) ) return $rate_check;
        return new WP_REST_Response(['message' => Ashbi_Hygiene::run_deep_clean()], 200);
    }

    public function backup() {
        $rate_check = $this->check_rate_limit();
        if ( is_wp_error( $rate_check ) ) return $rate_check;
        $report = Ashbi_Backup::run_full_backup();
        return new WP_REST_Response([ 'success' => true, 'report' => $report ], 200);
    }

    public function backup_list() {
        $rate_check = $this->check_rate_limit();
        if ( is_wp_error( $rate_check ) ) return $rate_check;
        $backups = Ashbi_Backup::list_backups();
        $auto    = Ashbi_Backup::list_auto_backups();
        return new WP_REST_Response([ 'backups' => $backups, 'auto_backups' => $auto ], 200);
    }

    public function hours_status() {
        $rate_check = $this->check_rate_limit();
        if ( is_wp_error( $rate_check ) ) return $rate_check;
        return new WP_REST_Response( Ashbi_Hours::get_status(), 200 );
    }

    public function hours_use( $request ) {
        $rate_check = $this->check_rate_limit();
        if ( is_wp_error( $rate_check ) ) return $rate_check;
        $params = $request->get_json_params();
        $hours  = floatval( $params['hours'] ?? 0 );
        $task   = sanitize_text_field( $params['task'] ?? 'Support work' );
        $result = Ashbi_Hours::use_hours( $hours, $task );
        return new WP_REST_Response( $result, $result['success'] ? 200 : 400 );
    }

    public function report_send() {
        $rate_check = $this->check_rate_limit();
        if ( is_wp_error( $rate_check ) ) return $rate_check;
        Ashbi_Report::send_monthly_report();
        return new WP_REST_Response([ 'success' => true, 'message' => 'Monthly report sent.' ], 200);
    }

    public function option_get( $request ) {
        $rate_check = $this->check_rate_limit();
        if ( is_wp_error( $rate_check ) ) return $rate_check;
        $params   = $request->get_json_params();
        $opt_name = sanitize_key( $params['name'] ?? '' );
        if ( empty( $opt_name ) ) return new WP_Error( 'missing_name', 'Option name is required', ['status' => 400] );
        if ( self::is_blocked_option( $opt_name ) ) return new WP_Error( 'blocked', 'This option cannot be read remotely.', ['status' => 403] );
        Ashbi_Logger::log( '/option/get', [ 'name' => $opt_name ], 'running' );
        return new WP_REST_Response([ 'name' => $opt_name, 'value' => get_option( $opt_name, null ) ], 200);
    }

    public function option_set( $request ) {
        $rate_check = $this->check_rate_limit();
        if ( is_wp_error( $rate_check ) ) return $rate_check;
        $params   = $request->get_json_params();
        $opt_name = sanitize_key( $params['name'] ?? '' );
        if ( empty( $opt_name ) ) return new WP_Error( 'missing_name', 'Option name is required', ['status' => 400] );
        if ( self::is_blocked_option( $opt_name ) ) return new WP_Error( 'blocked', 'This option cannot be modified remotely.', ['status' => 403] );
        if ( ! isset( $params['value'] ) ) return new WP_Error( 'missing_value', 'value parameter is required', ['status' => 400] );
        Ashbi_Logger::log( '/option/set', [ 'name' => $opt_name ], 'running' );
        update_option( $opt_name, $params['value'] );
        return new WP_REST_Response([ 'name' => $opt_name, 'updated' => true ], 200);
    }

    /**
     * Block remote read/write of sensitive WordPress options.
     *
     * Catches:
     *  - All `ashbi_*` plugin options (Hub should use dedicated endpoints).
     *  - `wp_user_roles` (serializes every role's capabilities; reading or
     *    writing lets an attacker grant themselves any capability).
     *  - All WP secret salts, DB password, and site URL/home (which would
     *    brick the install if changed remotely).
     *  - Admin email, default role, registration toggle (privilege-relevant).
     *
     * Comparison is case-insensitive on the lowercased name. Prefix-deny
     * is applied to `ashbi_` and `wp_` to catch any future sensitive option
     * without needing to update this list.
     */
    private static function is_blocked_option( $opt_name ) {
        $lower = strtolower( $opt_name );

        // Prefix-deny: anything under our plugin namespace or under WP core.
        if ( strpos( $lower, 'ashbi_' ) === 0 || strpos( $lower, 'wp_' ) === 0 ) {
            return true;
        }

        $blocked = [
            'siteurl', 'home', 'admin_email', 'users_can_register', 'default_role',
            'db_password',
            'auth_key', 'secure_auth_key', 'logged_in_key', 'nonce_key',
            'auth_salt', 'secure_auth_salt', 'logged_in_salt', 'nonce_salt',
            'wp_user_roles',
            'wordpress_api_key',  // Akismet API key — written by ashbi-hygiene as alias of `akismet_api_key`.
            'akismet_api_key',
            // Theme / plugin load path — writing these is remote code install / RCE-adjacent.
            'active_plugins', 'recently_activated', 'uninstall_plugins',
            'template', 'stylesheet', 'current_theme', 'template_root', 'stylesheet_root',
            // Cron / rewrite — can brick the site or schedule attacker callbacks.
            'cron', 'rewrite_rules', 'permalink_structure',
            // Mail / SMTP credentials often stored as plain options by plugins.
            'mailserver_url', 'mailserver_login', 'mailserver_pass',
            'smtp_pass', 'smtp_password', 'smtp_user', 'smtp_host',
        ];
        if ( in_array( $lower, $blocked, true ) ) {
            return true;
        }

        // Prefix-deny for common secret-bearing option namespaces.
        $blocked_prefixes = [ 'jetpack_', 'mailgun_', 'smtp_', 'aws_', 'woocommerce_api_' ];
        foreach ( $blocked_prefixes as $prefix ) {
            if ( strpos( $lower, $prefix ) === 0 ) {
                return true;
            }
        }

        return false;
    }
}
