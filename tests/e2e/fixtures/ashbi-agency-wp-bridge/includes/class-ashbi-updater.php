<?php
/**
 * Ashbi Updater Class  
 *
 * Checks GitHub releases for new versions. Integrates with WordPress native plugin update UI.
 * Supports: Check for updates, View details, One-click install from GitHub release ZIP.
 *
 * Defense-in-depth note (auto-update SHA256 verify)
 * -----------------------------------------------
 * This updater deliberately mirrors the `--prefer-source` trust stance used by
 * Debian/Ubuntu's apt: even over an authenticated HTTPS channel, we re-check
 * the integrity of the downloaded artifact against an out-of-band manifest
 * (the `SHA256SUMS` file shipped as a release asset by the CI build).
 *
 * Contract with the release pipeline (see PR #25 in this repo for the CI side):
 *   1. The CI `build` job writes `dist/SHA256SUMS` (standard `sha256sum *.zip` output).
 *   2. The CI `release` job uploads `dist/SHA256SUMS` alongside `dist/*.zip` as
 *      two assets on the GitHub release. The SHA256SUMS file is fetched here
 *      (HTTPS), parsed line-by-line, and the entry matching the .zip filename
 *      is used as the expected hash.
 *   3. On the actual install (the `upgrader_pre_download` hook), we download
 *      the .zip into a temp file, compute `hash_file('sha256', ...)` on it,
 *      and compare with `hash_equals()` against the expected hash. Any mismatch
 *      aborts the upgrade with a `WP_Error`; missing SHA256SUMS or missing
 *      entry emits an `error_log` warning and skips verify (graceful upgrade).
 *
 * Threat model notes:
 *   - GitHub currently does not natively sign release assets, so a full
 *     end-to-end signature (cosign/minisign) check requires extra plumbing and
 *     is out of scope for this verify half. SHA256SUMS over HTTPS raises the
 *     bar against: (a) a compromised mirror serving a tampered zip;
 *     (b) GitHub asset mislabeling (e.g. a stale upload under the same tag);
 *     (c) silent MITM in misconfigured egress environments.
 *   - The `zipball_url` fallback in `get_zip_url()` (used when no .zip asset
 *     exists) is HEAD-tracked, not a release artifact, and has no SHA256SUMS
 *     entry. We refuse to verify it — see MEMORY entry "GitHub zipball_url is
 *     HEAD, never use for plugin auto-update".
 *
 * @package Ashbi_Agency_WP_Bridge
 * @version 1.6.0
 */

if ( ! defined( 'ABSPATH' ) ) exit;

class Ashbi_Updater {
    private $slug            = 'ashbi-agency-wp-bridge';
    private $plugin_file;
    private $current_version;
    private $github_user     = 'camster91';
    private $github_repo     = 'ashbi-agency-wp-bridge';
    private $github_api_url;
    private $cache_key       = 'ashbi_github_release';
    private $cache_ttl       = 3600; // 1 hour

    public function __construct() {
        $this->plugin_file     = plugin_basename( ASHBI_BRIDGE_FILE );
        $this->current_version = ASHBI_BRIDGE_VERSION;
        $this->github_api_url  = "https://api.github.com/repos/{$this->github_user}/{$this->github_repo}/releases/latest";

        add_filter( 'pre_set_site_transient_update_plugins', [ $this, 'check_for_update' ] );
        add_filter( 'plugins_api', [ $this, 'plugin_info' ], 20, 3 );
        add_filter( 'upgrader_post_install', [ $this, 'after_update' ], 10, 3 );
        add_filter( 'upgrader_pre_download', [ $this, 'verify_upgrade_package' ], 10, 3 );
        add_action( 'admin_init', [ $this, 'handle_force_check' ] );
    }

    /**
     * Fetch latest release metadata from GitHub (cached).
     */
    private function fetch_release() {
        $cached = get_transient( $this->cache_key );
        if ( is_array( $cached ) && isset( $cached['tag_name'] ) ) {
            return $cached;
        }

        $response = wp_remote_get( $this->github_api_url, [
            'headers'   => [ 'Accept' => 'application/vnd.github+json', 'User-Agent' => 'AshbiBridge/' . $this->current_version ],
            'timeout'   => 15,
            'sslverify' => true,
        ] );

        if ( is_wp_error( $response ) || wp_remote_retrieve_response_code( $response ) !== 200 ) {
            return false;
        }

        $data = json_decode( wp_remote_retrieve_body( $response ), true );
        if ( empty( $data ) || empty( $data['tag_name'] ) ) {
            return false;
        }

        set_transient( $this->cache_key, $data, $this->cache_ttl );
        return $data;
    }

    /**
     * Get version number from tag (strip leading 'v').
     */
    private function normalize_version( $tag ) {
        return ltrim( $tag, 'vV' );
    }

    /**
     * Find the ZIP asset URL from release data.
     *
     * Prefers an explicitly uploaded release asset (.zip). When no asset is
     * attached, falls back to the tag-specific archive URL so the install
     * source is always a reviewed tag — never the default-branch HEAD.
     *
     * GitHub's `zipball_url` is the source archive of the default branch at
     * the moment the API responded; using it for an update would silently
     * install unreviewed code if a release was published without an asset.
     * So we never return `zipball_url`. If `tag_name` is missing we return
     * '' so WordPress shows no update instead of installing from HEAD.
     */
    private function get_zip_url( $data ) {
        if ( ! empty( $data['assets'] ) && is_array( $data['assets'] ) ) {
            foreach ( $data['assets'] as $asset ) {
                if ( isset( $asset['content_type'] ) && $asset['content_type'] === 'application/zip' ) {
                    return $asset['browser_download_url'];
                }
                if ( isset( $asset['name'] ) && substr( $asset['name'], -4 ) === '.zip' ) {
                    return $asset['browser_download_url'];
                }
            }
        }
        // No uploaded asset. Build a tag-specific archive URL instead of
        // falling back to `zipball_url` (which is the default-branch HEAD).
        if ( empty( $data['tag_name'] ) ) {
            return '';
        }
        return "https://github.com/{$this->github_user}/{$this->github_repo}/archive/refs/tags/{$data['tag_name']}.zip";
    }

    /**
     * Find the SHA256SUMS asset URL from release data.
     *
     * Returns the `browser_download_url` of the asset whose name is exactly
     * `SHA256SUMS`. Returns '' if not present (no SHA256SUMS published for
     * this release). The caller treats '' as "skip verify with a warning",
     * since blocking upgrades on a missing manifest would hard-fail every
     * install that doesn't yet ship one (including back-versions and repos
     * that haven't adopted the CI hardening from PR #25).
     */
    private function get_sha256sums_url( $data ) {
        if ( empty( $data['assets'] ) || ! is_array( $data['assets'] ) ) {
            return '';
        }
        foreach ( $data['assets'] as $asset ) {
            if ( isset( $asset['name'] ) && $asset['name'] === 'SHA256SUMS' ) {
                return $asset['browser_download_url'] ?? '';
            }
        }
        return '';
    }

    /**
     * Find the asset entry (name + URL) in the release whose URL matches $package_url.
     *
     * Used at upgrade time to identify the asset we're actually downloading so
     * we can look up the matching line in SHA256SUMS. Returns null when the
     * package URL isn't a release asset (e.g. zipball_url HEAD fallback).
     */
    private function find_asset_by_url( $data, $package_url ) {
        if ( empty( $data['assets'] ) || ! is_array( $data['assets'] ) ) {
            return null;
        }
        foreach ( $data['assets'] as $asset ) {
            if ( isset( $asset['browser_download_url'] ) && $asset['browser_download_url'] === $package_url ) {
                return $asset;
            }
        }
        return null;
    }

    /**
     * Fetch the SHA256SUMS manifest and return the hash expected for $asset_name.
     *
     * Format: standard `sha256sum` output, one line per file —
     *   `<64-hex>  <name>`  (text mode; binary mode prefixes the name with `*`).
     * We tolerate either form, leading whitespace is trimmed, hash comparison
     * happens case-insensitively down here and `hash_equals()` does the final
     * check on equal-length lowercase strings.
     *
     * Returns '' (= "no expected hash available") when:
     *   - no SHA256SUMS asset is attached to the release;
     *   - the HTTP fetch fails (5xx, timeout, body empty);
     *   - the file contains no line matching the requested filename.
     *
     * In all three cases the caller logs and proceeds with the upgrade
     * unverified — see `--prefer-source` doc block above.
     */
    private function get_expected_sha256( $release, $asset_name ) {
        $sums_url = $this->get_sha256sums_url( $release );
        if ( '' === $sums_url ) {
            return '';
        }

        $resp = wp_remote_get( $sums_url, [
            'headers'   => [
                'Accept'     => 'text/plain',
                'User-Agent' => 'AshbiBridge/' . $this->current_version,
            ],
            'timeout'   => 10,
            'sslverify' => true,
        ] );

        if ( is_wp_error( $resp ) ) {
            error_log( '[Ashbi Updater] SHA256SUMS fetch error: ' . $resp->get_error_message() );
            return '';
        }
        $code = (int) wp_remote_retrieve_response_code( $resp );
        if ( 200 !== $code ) {
            error_log( sprintf( '[Ashbi Updater] SHA256SUMS HTTP %d from %s', $code, $sums_url ) );
            return '';
        }

        $body = wp_remote_retrieve_body( $resp );
        if ( '' === $body ) {
            return '';
        }

        // sha256sum line: "<64-hex><1+ spaces>NAME_REGEX". We accept
        // both binary-mode "*name" and text-mode "name" forms.
        $expected = '';
        $lines    = preg_split( '/\r?\n/', $body );
        foreach ( $lines as $line ) {
            $line = trim( $line );
            if ( '' === $line ) {
                continue;
            }
            if ( preg_match( '/^([a-f0-9]{64})\s+\*?(.+)$/i', $line, $m ) ) {
                if ( $m[2] === $asset_name ) {
                    $expected = strtolower( $m[1] );
                    break;
                }
            }
        }

        if ( '' === $expected ) {
            error_log( sprintf(
                '[Ashbi Updater] SHA256SUMS has no entry for %s — skipping verify.',
                $asset_name
            ) );
        }
        return $expected;
    }

    /**
     * Hook: upgrader_pre_download — gate the actual zip download on a hash check.
     *
     * Triggered by WP core when Plugin_Upgrader (or any WP_Upgrader subclass)
     * is about to fetch a non-local package. We interpose to:
     *   1. Identify which release asset is being downloaded by matching the
     *      $package URL against `$release['assets']`. If no match, the
     *      package isn't ours (a different plugin's update, or a WP core
     *      update) — return the filter default (false) and let WP proceed.
     *   2. Look up the expected SHA256 from the SHA256SUMS asset. If absent,
     *      warn and skip verify (out of scope for hard-fail; see class-level
     *      docblock for rationale).
     *   3. Download to a temp file via `download_url()`, compute its hash,
     *      and either return the verified temp path to WP (which uses it
     *      instead of re-downloading) or return a WP_Error to abort.
     *
     * On mismatch, returns WP_Error so WordPress shows the standard
     * "could not install" error screen — the site admin sees the message
     * we attached (logged + bubbled to the upgrader skin).
     *
     * NOTE: `download_url()` writes to WP's `wp-content/uploads` (or
     * sys_get_temp_dir fallback). The file is left in place when we return
     * it as the local package; WP cleans it up after extraction.
     */
    public function verify_upgrade_package( $reply, $package, $upgrader ) {
        // Default behavior unchanged for everything that isn't a remote URL
        // (already a local path, WP core update, theme update, etc.).
        if ( ! is_string( $package ) || '' === $package ) {
            return $reply;
        }
        if ( file_exists( $package ) ) {
            return $reply;
        }

        // Defense-in-depth gate: only act on our plugin's upgrade.
        // The Plugin_Upgrader skin stores the plugin file in $upgrader->skin->plugin,
        // but some custom skins / `wp-cli` flows don't use that, so we ALSO
        // confirm the package URL is a release asset from our cached release.
        $release = $this->fetch_release();
        if ( ! $release ) {
            return $reply;
        }
        $asset = $this->find_asset_by_url( $release, $package );
        if ( null === $asset ) {
            // zipball_url or third-party URL — not ours to verify.
            return $reply;
        }
        $asset_name = $asset['name'] ?? '';

        $expected = $this->get_expected_sha256( $release, $asset_name );
        if ( '' === $expected ) {
            // Manifest missing or no entry for this asset — warn + skip.
            // (See class-level docblock. Hard-fail on this would refuse
            // upgrades for any release that predates the CI hardening,
            // which is the wrong default.)
            return $reply;
        }

        // Download to a fresh temp file we can hash + hand to WP.
        $tmp = download_url( $package, 30 );
        if ( is_wp_error( $tmp ) ) {
            // Network error during download — surface it; don't risk a half-fetched zip.
            error_log( '[Ashbi Updater] download_url failed: ' . $tmp->get_error_message() );
            return $tmp;
        }

        $actual = hash_file( 'sha256', $tmp );
        if ( false === $actual ) {
            @unlink( $tmp );
            error_log( '[Ashbi Updater] hash_file failed on ' . $tmp );
            return new WP_Error(
                'ashbi_sha256_unreadable',
                '[Ashbi Updater] Auto-update refused: could not hash the downloaded package.'
            );
        }
        $actual = strtolower( $actual );

        if ( ! hash_equals( $expected, $actual ) ) {
            @unlink( $tmp );
            $err = sprintf(
                '[Ashbi Updater] Auto-update REFUSED: SHA256 mismatch for %s. expected=%s got=%s',
                $asset_name,
                $expected,
                $actual
            );
            error_log( $err );
            return new WP_Error(
                'ashbi_sha256_mismatch',
                sprintf(
                    'Auto-update blocked: SHA256 of %s did not match the SHA256SUMS manifest. The release may have been tampered with — see your PHP error log for details.',
                    $asset_name
                )
            );
        }

        // Verified — hand the temp file back to WP. It will be moved into
        // the upgrade working dir and cleaned up by WP_Upgrader.
        return $tmp;
    }

    /**
     * Hook into WordPress update transient.
     */
    public function check_for_update( $transient ) {
        if ( empty( $transient->checked ) ) {
            return $transient;
        }

        $release = $this->fetch_release();
        if ( ! $release ) {
            return $transient;
        }

        $new_version = $this->normalize_version( $release['tag_name'] );
        $zip_url     = $this->get_zip_url( $release );

        if ( empty( $new_version ) || empty( $zip_url ) ) {
            return $transient;
        }

        if ( version_compare( $this->current_version, $new_version, '>=' ) ) {
            return $transient;
        }

        $transient->response[ $this->plugin_file ] = (object) [
            'slug'         => $this->slug,
            'plugin'       => $this->plugin_file,
            'new_version'  => $new_version,
            'package'      => $zip_url,
            'url'          => $release['html_url'] ?? "https://github.com/{$this->github_user}/{$this->github_repo}",
            'tested'       => get_bloginfo( 'version' ),
            'requires'     => '5.5',
            'requires_php' => '7.4',
        ];

        return $transient;
    }

    /**
     * Provide plugin info for "View version details" popup.
     */
    public function plugin_info( $result, $action, $args ) {
        if ( $action !== 'plugin_information' || $args->slug !== $this->slug ) {
            return $result;
        }

        $release = $this->fetch_release();
        if ( ! $release ) {
            return $result;
        }

        $new_version = $this->normalize_version( $release['tag_name'] );
        $zip_url     = $this->get_zip_url( $release );

        $sections = [];
        if ( ! empty( $release['body'] ) ) {
            $sections['changelog'] = wp_kses_post( $release['body'] );
        }

        return (object) [
            'name'          => 'Ashbi Agency WP Bridge',
            'slug'          => $this->slug,
            'version'       => $new_version ?: $this->current_version,
            'author'        => 'Ashbi Design',
            'homepage'      => "https://github.com/{$this->github_user}/{$this->github_repo}",
            'requires'      => '5.5',
            'requires_php'  => '7.4',
            'tested'        => get_bloginfo( 'version' ),
            'last_updated'  => $release['published_at'] ?? '',
            'sections'      => $sections,
            'download_link' => $zip_url,
        ];
    }

    /**
     * After update: flush caches and re-register with Hub.
     */
    public function after_update( $response, $hook_extra, $result ) {
        if ( isset( $hook_extra['plugin'] ) && $hook_extra['plugin'] === $this->plugin_file ) {
            // PR #27: skip re-register entirely if the site has explicitly
            // marked itself unregistered (hub-deprecated path). Otherwise,
            // wrap the call in try/catch so a transient hub failure doesn't
            // break the upgrade — cache flush + transient delete still run.
            if ( false === get_option( 'ashbi_hub_registered', true ) ) {
                error_log( '[ashbi] after_update: skip hub re-register (ashbi_hub_registered is false — hub deprecated)' );
            } else {
                $hub_url = get_option( 'ashbi_hub_url', '' );
                $api_key = get_option( 'ashbi_api_key', '' );
                if ( ! empty( $hub_url ) && ! empty( $api_key ) && class_exists( 'Ashbi_Health' ) ) {
                    try {
                        $reg = Ashbi_Health::register_with_hub( $hub_url, $api_key );
                        if ( is_wp_error( $reg ) ) {
                            if ( class_exists( 'Ashbi_Logger' ) ) {
                                Ashbi_Logger::log( 'after_update_reregister', [ 'hub_url' => $hub_url ], 'error: ' . $reg->get_error_message() );
                            } else {
                                error_log( '[Ashbi Bridge] post-update re-register failed: ' . $reg->get_error_message() );
                            }
                        } elseif ( class_exists( 'Ashbi_Logger' ) ) {
                            Ashbi_Logger::log( 'after_update_reregister', [ 'hub_url' => $hub_url ], 'ok' );
                        }
                    } catch ( \Throwable $e ) {
                        error_log( '[ashbi] after_update: hub re-register threw: ' . $e->getMessage() );
                    }
                }
            }
            wp_cache_flush();
            delete_transient( $this->cache_key );
        }
        return $result;
    }

    /**
     * Force-check endpoint — triggered by admin "Check for Updates" button.
     */
    public function handle_force_check() {
        if ( ! current_user_can( 'manage_options' ) ) {
            return;
        }
        if ( ! isset( $_GET['ashbi_force_check'] ) || ! wp_verify_nonce( $_GET['_wpnonce'] ?? '', 'ashbi_force_check' ) ) {
            return;
        }
        delete_transient( $this->cache_key );
        wp_redirect( admin_url( 'plugins.php?ashbi_checked=1' ) );
        exit;
    }
}
