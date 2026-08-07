<?php
/**
 * Ashbi Magic Login Class
 *
 * ManageWP-grade single-use, time-boxed, audited magic login tokens.
 *
 * Responsibilities:
 *   - Issue a token (60-second default expiry, configurable).
 *   - Track consumed tokens in wp_options (`ashbi_magic_login_consumed`) for
 *     5 minutes so replay attempts are rejected.
 *   - Revoke a token explicitly via the /magic-login/revoke endpoint.
 *   - Write an audit-log entry on issue / consume / revoke / reject.
 *   - Enforce a per-site rate limit (default 10 / hour, configurable).
 *   - Enforce an optional IP allowlist (`ashbi_hub_ip_cidrs`, CSV of CIDRs).
 *
 * Storage is wp_options + transients — no custom DB table required. The class
 * is the single source of truth for magic-login tokens; Ashbi_SSO delegates
 * to it so the magic URL interception path (i.e. ?ashbi_sso=...) and the
 * hub → plugin /magic-login endpoint share one validation chain.
 *
 * @package Ashbi_Agency_WP_Bridge
 */

if ( ! defined( 'ABSPATH' ) ) exit;

class Ashbi_Magic_Login {
    const TRANSIENT_PREFIX     = 'ashbi_ml_active_';
    const OPTION_CONSUMED      = 'ashbi_magic_login_consumed';
    const OPTION_AUDIT_LOG     = 'ashbi_magic_login_log';
    const OPTION_RATE_LIMIT    = 'ashbi_magic_login_rate_limit';
    const OPTION_EXPIRY        = 'ashbi_magic_login_expiry_seconds';
    const OPTION_IP_CIDRS      = 'ashbi_hub_ip_cidrs';

    const CONSUMED_TTL         = 300;     // 5 minutes
    const EXPIRY_DEFAULT       = 60;      // 60 seconds
    const RATE_LIMIT_DEFAULT   = 10;      // per hour
    const AUDIT_LOG_MAX        = 500;     // ring buffer cap

    /**
     * Issue a fresh magic-login token. Returns an array with the raw token,
     * its sha256 hash (safe to log), and the absolute expiry timestamp.
     *
     * @param int $user_id  WordPress user ID the token will log in as.
     * @param array $opts   Override defaults: ['expiry_seconds' => int, 'issued_by' => string].
     * @return array{token:string, hash:string, expires_at:int}
     */
    public static function issue( $user_id, $opts = [] ) {
        $user_id = (int) $user_id;
        if ( $user_id <= 0 ) {
            return new WP_Error( 'invalid_user', 'A valid user_id is required to issue a magic-login token.', [ 'status' => 400 ] );
        }

        $expiry = (int) ( $opts['expiry_seconds'] ?? get_option( self::OPTION_EXPIRY, self::EXPIRY_DEFAULT ) );
        // Clamp to a sensible window: 5s..15min. Anything below is a DoS vector,
        // anything above erodes the value of the magic-link security model.
        $expiry = max( 5, min( 900, $expiry ) );

        $token      = bin2hex( random_bytes( 32 ) );
        $hash       = self::hash_token( $token );
        $expires_at = time() + $expiry;

        $payload = [
            'user_id'    => $user_id,
            'expires_at' => $expires_at,
            'site_id'    => home_url(),
            'issued_by'  => isset( $opts['issued_by'] ) ? substr( (string) $opts['issued_by'], 0, 64 ) : 'plugin',
        ];

        set_transient( self::TRANSIENT_PREFIX . $hash, $payload, $expiry );

        self::audit([
            'status'           => 'issued',
            'user_id'          => $user_id,
            'ip'               => self::get_request_ip(),
            'site_id'          => home_url(),
            'magic_token_hash' => $hash,
            'issued_by'        => $payload['issued_by'],
            'expires_at'       => $expires_at,
        ]);

        return [
            'token'      => $token,
            'hash'       => $hash,
            'expires_at' => $expires_at,
        ];
    }

    /**
     * Validate and consume a token. Returns the issuance payload on success,
     * a WP_Error with the right status code otherwise.
     *
     * @param string $token Raw token from the magic URL.
     * @return array|WP_Error
     */
    public static function consume( $token ) {
        $token = is_string( $token ) ? trim( $token ) : '';
        if ( $token === '' ) {
            return new WP_Error( 'invalid_token', 'Magic-login token is missing.', [ 'status' => 401 ] );
        }

        $hash = self::hash_token( $token );

        // Replay check first: even if the transient is gone (expired) we still
        // want to reject reuse inside the consumed-token window.
        if ( self::is_consumed( $hash ) ) {
            self::audit([
                'status'           => 'rejected',
                'reason'           => 'replayed',
                'user_id'          => 0,
                'ip'               => self::get_request_ip(),
                'site_id'          => home_url(),
                'magic_token_hash' => $hash,
            ]);
            return new WP_Error( 'token_consumed', 'Magic-login token has already been used.', [ 'status' => 401 ] );
        }

        $payload = get_transient( self::TRANSIENT_PREFIX . $hash );
        if ( ! is_array( $payload ) || empty( $payload['user_id'] ) ) {
            self::audit([
                'status'           => 'rejected',
                'reason'           => 'expired_or_invalid',
                'user_id'          => 0,
                'ip'               => self::get_request_ip(),
                'site_id'          => home_url(),
                'magic_token_hash' => $hash,
            ]);
            return new WP_Error( 'token_expired', 'Magic-login token is expired or invalid.', [ 'status' => 401 ] );
        }

        // Belt-and-braces expiry check: transients sometimes survive longer
        // than their declared TTL on misconfigured object stores.
        if ( isset( $payload['expires_at'] ) && (int) $payload['expires_at'] < time() ) {
            delete_transient( self::TRANSIENT_PREFIX . $hash );
            self::audit([
                'status'           => 'rejected',
                'reason'           => 'expired',
                'user_id'          => (int) $payload['user_id'],
                'ip'               => self::get_request_ip(),
                'site_id'          => home_url(),
                'magic_token_hash' => $hash,
            ]);
            return new WP_Error( 'token_expired', 'Magic-login token is expired or invalid.', [ 'status' => 401 ] );
        }

        // Single-use: delete + mark consumed so any retry within the 5-min
        // window is rejected even after the transient is gone.
        delete_transient( self::TRANSIENT_PREFIX . $hash );
        self::mark_consumed( $hash, (int) $payload['user_id'] );

        self::audit([
            'status'           => 'consumed',
            'user_id'          => (int) $payload['user_id'],
            'ip'               => self::get_request_ip(),
            'site_id'          => home_url(),
            'magic_token_hash' => $hash,
        ]);

        return $payload;
    }

    /**
     * Revoke an active token (or the consumed-tracking of a previously-used
     * token) given the RAW token. Used by /magic-login/revoke when callers
     * have the raw token in hand (e.g. an admin script that just generated
     * it, or the legacy admin-initiated revoke flow).
     *
     * Hubs that only have the sha256 hash should call revoke_by_hash()
     * instead — they never had the raw token, and re-hashing it here would
     * produce sha256(sha256(raw)) = double-hash, which would silently miss
     * the active transient and look like a successful revoke (it's a no-op).
     */
    public static function revoke( $raw_token ) {
        $input = is_string( $raw_token ) ? trim( $raw_token ) : '';
        if ( $input === '' ) {
            return new WP_Error( 'invalid_token', 'Magic-login token is required for revocation.', [ 'status' => 400 ] );
        }
        $hash = self::hash_token( $input );
        return self::revoke_by_hash( $hash );
    }

    /**
     * Revoke by sha256 hash. The hash is the storage key for the active
     * transient and the consumed-list entry, so we use it directly without
     * re-hashing.
     *
     * This is the path the hub's WPSites "Recent Logins" tab uses — the
     * raw token is never persisted on the hub, only its sha256 hash, so
     * the hash IS the only identifier available at revoke time.
     *
     * @param string $hash 64-char lowercase hex (sha256 of the raw token).
     */
    public static function revoke_by_hash( $hash ) {
        // Validate the canonical form BEFORE normalizing. This rejects both
        // non-hex chars AND uppercase inputs — sha256 hex output is lowercase
        // by definition; if a caller has a different shape, it's not a hash
        // we recognize, so refuse (don't silently "fix" it for them).
        if ( ! self::looks_like_hash_strict( $hash ) ) {
            return new WP_Error( 'invalid_hash', 'Revoke hash must be a 64-char lowercase hex sha256.', [ 'status' => 400 ] );
        }
        $hash = trim( strtolower( $hash ) );

        $existed = delete_transient( self::TRANSIENT_PREFIX . $hash );

        $list = get_option( self::OPTION_CONSUMED, [] );
        $was_consumed = is_array( $list ) && isset( $list[ $hash ] );
        if ( $was_consumed ) {
            unset( $list[ $hash ] );
            update_option( self::OPTION_CONSUMED, $list );
        }

        self::audit([
            'status'           => 'revoked',
            'user_id'          => 0,
            'ip'               => self::get_request_ip(),
            'site_id'          => home_url(),
            'magic_token_hash' => $hash,
            'reason'           => $was_consumed ? 'manual_revoke_consumed' : 'manual_revoke',
            'existed'          => $existed || $was_consumed,
        ]);

        return [
            'revoked'     => true,
            'hash'        => $hash,
            'existed'     => $existed || $was_consumed,
            'was_consumed' => $was_consumed,
        ];
    }

    /**
     * Cheap shape check: 64 lowercase hex chars. Used internally after
     * canonicalization (see revoke_by_hash for the strict pre-canonical
     * check that also rejects non-hex chars).
     */
    private static function looks_like_hash( $s ) {
        return self::looks_like_hash_strict( $s );
    }

    /**
     * Strict shape check: 64 lowercase hex chars. Used at the public-API
     * boundary (revoke_by_hash) to refuse non-canonical inputs.
     */
    private static function looks_like_hash_strict( $s ) {
        return is_string( $s ) && preg_match( '/^[0-9a-f]{64}$/', $s ) === 1;
    }

    /**
     * Read the audit log. Cap'd to last $limit entries.
     */
    public static function get_audit_log( $limit = 100 ) {
        $limit = max( 1, min( self::AUDIT_LOG_MAX, (int) $limit ) );
        $log   = get_option( self::OPTION_AUDIT_LOG, [] );
        if ( ! is_array( $log ) ) $log = [];
        return array_slice( $log, -$limit );
    }

    /**
     * Per-site rate limit (default 10 / hour, configurable via
     * ashbi_magic_login_rate_limit). Backed by an hourly transient so it
     * always rolls over on the hour boundary without manual GC.
     */
    public static function check_rate_limit() {
        $limit = (int) (
            defined( 'ASHBI_MAGIC_LOGIN_RATE_LIMIT' )
                ? ASHBI_MAGIC_LOGIN_RATE_LIMIT
                : get_option( self::OPTION_RATE_LIMIT, self::RATE_LIMIT_DEFAULT )
        );
        if ( $limit < 1 ) $limit = self::RATE_LIMIT_DEFAULT;

        $window_key = 'ashbi_magic_rl_' . gmdate( 'YmdH' );
        $count      = (int) get_transient( $window_key );
        if ( $count >= $limit ) {
            self::audit([
                'status'           => 'rejected',
                'reason'           => 'rate_limited',
                'user_id'          => 0,
                'ip'               => self::get_request_ip(),
                'site_id'          => home_url(),
                'magic_token_hash' => '',
                'limit'            => $limit,
            ]);
            return new WP_Error( 'rate_limited', 'Magic-login rate limit exceeded. Try again later.', [ 'status' => 429 ] );
        }
        set_transient( $window_key, $count + 1, HOUR_IN_SECONDS );
        return true;
    }

    /**
     * Optional IP allowlist. Empty option = allow all (back-compat).
     * Non-empty = request must come from a CIDR in the list. IPv4 only;
     * IPv6 entries are accepted as exact-match for now (gracefully rejected
     * if mismatched).
     */
    public static function check_ip_allowlist() {
        $raw = (string) get_option( self::OPTION_IP_CIDRS, '' );
        $cidrs = array_values( array_filter( array_map( 'trim', explode( ',', $raw ) ) ) );
        if ( empty( $cidrs ) ) return true;

        $ip = self::get_request_ip();
        foreach ( $cidrs as $cidr ) {
            if ( self::ip_in_cidr( $ip, $cidr ) ) return true;
        }
        self::audit([
            'status'           => 'rejected',
            'reason'           => 'ip_not_allowed',
            'user_id'          => 0,
            'ip'               => $ip,
            'site_id'          => home_url(),
            'magic_token_hash' => '',
            'cidrs'            => $cidrs,
        ]);
        return new WP_Error( 'ip_not_allowed', 'Magic-login request IP is not in the allowlist.', [ 'status' => 403 ] );
    }

    /**
     * Stable sha256 over the raw token. We never persist the raw token — only
     * the hash — so a leaked audit log can't be replayed as a login.
     */
    public static function hash_token( $token ) {
        return hash( 'sha256', (string) $token );
    }

    /**
     * Read the request IP. Behind Cloudflare/Squid we trust the standard
     * REMOTE_ADDR — explicit proxy-header honoring is a separate decision.
     */
    public static function get_request_ip() {
        if ( empty( $_SERVER['REMOTE_ADDR'] ) ) return '0.0.0.0';
        return sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) );
    }

    // --- internals ------------------------------------------------------

    private static function is_consumed( $hash ) {
        $list = get_option( self::OPTION_CONSUMED, [] );
        if ( ! is_array( $list ) || ! isset( $list[ $hash ] ) ) return false;
        self::purge_consumed( $list );
        return isset( $list[ $hash ] );
    }

    private static function mark_consumed( $hash, $user_id ) {
        $list = get_option( self::OPTION_CONSUMED, [] );
        if ( ! is_array( $list ) ) $list = [];
        self::purge_consumed( $list );
        $list[ $hash ] = [
            'user_id'    => (int) $user_id,
            'expires_at' => time() + self::CONSUMED_TTL,
        ];
        update_option( self::OPTION_CONSUMED, $list );
    }

    /**
     * Drop entries older than the consumed-TTL. Called every read/write so
     * the option never grows unbounded. Keeps at most one rewrite per call.
     */
    private static function purge_consumed( &$list ) {
        if ( ! is_array( $list ) ) {
            $list = [];
            return;
        }
        $now  = time();
        $dirty = false;
        foreach ( $list as $h => $entry ) {
            if ( ! is_array( $entry ) || ! isset( $entry['expires_at'] ) || (int) $entry['expires_at'] < $now ) {
                unset( $list[ $h ] );
                $dirty = true;
            }
        }
        if ( $dirty ) update_option( self::OPTION_CONSUMED, $list );
    }

    private static function audit( $entry ) {
        $log = get_option( self::OPTION_AUDIT_LOG, [] );
        if ( ! is_array( $log ) ) $log = [];
        $entry = array_merge( [
            'ts'      => time(),
            'site_id' => home_url(),
        ], $entry );
        $log[] = $entry;
        if ( count( $log ) > self::AUDIT_LOG_MAX ) {
            $log = array_slice( $log, -self::AUDIT_LOG_MAX );
        }
        update_option( self::OPTION_AUDIT_LOG, $log );
    }

    /**
     * CIDR match (IPv4). Supports both /n and exact-IP forms. IPv6 falls
     * through as exact-match (the common case when the hub is on a known
     * IPv6 address that operators add as a single entry).
     */
    private static function ip_in_cidr( $ip, $cidr ) {
        $cidr = trim( $cidr );
        if ( $cidr === '' ) return false;
        if ( strpos( $cidr, '/' ) === false ) {
            return $ip === $cidr;
        }
        list( $subnet, $bits ) = explode( '/', $cidr, 2 );
        $bits        = (int) $bits;
        $ip_long     = ip2long( $ip );
        $subnet_long = ip2long( $subnet );
        if ( $ip_long === false || $subnet_long === false || $bits < 0 || $bits > 32 ) {
            // IPv6 or invalid → fall through to exact match for IPv6 addresses.
            return $ip === $cidr;
        }
        $mask = $bits === 0 ? 0 : ( -1 << ( 32 - $bits ) );
        return ( $ip_long & $mask ) === ( $subnet_long & $mask );
    }
}
