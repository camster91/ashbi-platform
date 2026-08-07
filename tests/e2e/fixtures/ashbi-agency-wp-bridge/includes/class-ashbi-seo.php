<?php
/**
 * Ashbi SEO Class
 *
 * Lightweight SEO health snapshot for the monthly report.
 * Detects sitemap presence, robots.txt, meta description coverage,
 * image alt coverage, and counts broken external links from recent posts.
 *
 * Intentionally avoids heavy crawlers — designed to run in <5s on a typical WP site.
 *
 * @package Ashbi_Agency_WP_Bridge
 * @version 1.9.0
 */
if ( ! defined( 'ABSPATH' ) ) exit;

class Ashbi_SEO {

    const CACHE_OPTION = 'ashbi_last_seo';

    /**
     * Collect a full SEO snapshot. Safe to call on any request.
     */
    public static function snapshot() {
        $snapshot = [
            'timestamp'        => current_time( 'mysql' ),
            'sitemap'          => self::check_sitemap(),
            'robots'           => self::check_robots(),
            'meta_descriptions'=> self::check_meta_descriptions(),
            'image_alts'       => self::check_image_alts(),
            'broken_externals' => self::check_broken_externals( 10 ), // sample 10 most recent
        ];
        update_option( self::CACHE_OPTION, $snapshot, false );
        return $snapshot;
    }

    /**
     * Returns the cached snapshot (or runs one if cache is empty).
     */
    public static function get_snapshot() {
        $cached = get_option( self::CACHE_OPTION, null );
        if ( ! is_array( $cached ) || empty( $cached['timestamp'] ) ) {
            return self::snapshot();
        }
        return $cached;
    }

    /**
     * Check for XML sitemap at the common locations.
     */
    private static function check_sitemap() {
        $home = trailingslashit( home_url() );
        $candidates = [
            'sitemap.xml',
            'sitemap_index.xml',
            'wp-sitemap.xml',
            'sitemap/sitemap.xml',
        ];
        foreach ( $candidates as $path ) {
            $response = wp_remote_head( $home . $path, [ 'timeout' => 5, 'sslverify' => true, 'redirection' => 3 ] );
            if ( ! is_wp_error( $response ) && wp_remote_retrieve_response_code( $response ) === 200 ) {
                return [
                    'present' => true,
                    'url'     => $home . $path,
                ];
            }
        }
        // Fall back to checking common SEO plugins
        $plugins = [
            'wordpress-seo/wordpress-seo.php'  => 'Yoast SEO',
            'seo-by-rank-math/rank-math.php'  => 'Rank Math',
            'all-in-one-seo-pack/all_in_one_seo_pack.php' => 'AIOSEO',
            'autodescription/autodescription.php' => 'The SEO Framework',
        ];
        foreach ( $plugins as $slug => $name ) {
            if ( is_plugin_active( $slug ) ) {
                return [ 'present' => true, 'url' => $name . ' (serves dynamically)' ];
            }
        }
        return [ 'present' => false, 'url' => null ];
    }

    /**
     * Check robots.txt presence.
     */
    private static function check_robots() {
        $url = trailingslashit( home_url() ) . 'robots.txt';
        $response = wp_remote_get( $url, [ 'timeout' => 5, 'sslverify' => true ] );
        if ( is_wp_error( $response ) ) {
            return [ 'present' => false, 'blocked' => true ];
        }
        $code = wp_remote_retrieve_response_code( $response );
        return [
            'present' => $code === 200,
            'url'     => $url,
        ];
    }

    /**
     * Count published posts/pages missing meta description.
     * Samples recent 50 to keep the query fast.
     */
    private static function check_meta_descriptions() {
        global $wpdb;
        $sample = 50;
        $total = (int) $wpdb->get_var(
            "SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_status = 'publish' AND post_type IN ('post','page')"
        );
        if ( $total === 0 ) {
            return [ 'total' => 0, 'missing' => 0, 'pct' => 100 ];
        }
        // Posts that have any meta_description-like meta set
        $with_desc = (int) $wpdb->get_var(
            $wpdb->prepare(
                "SELECT COUNT(DISTINCT p.ID) FROM {$wpdb->posts} p
                 INNER JOIN {$wpdb->postmeta} pm ON pm.post_id = p.ID
                 WHERE p.post_status = 'publish'
                   AND p.post_type IN ('post','page')
                   AND (pm.meta_key = '_yoast_wpseo_metadesc'
                        OR pm.meta_key = 'rank_math_description'
                        OR pm.meta_key = '_aioseo_description'
                        OR pm.meta_key = '_genesis_description'
                        OR pm.meta_key = '_tdc_description'
                        OR pm.meta_key = 'description')
                 LIMIT %d",
                $sample
            )
        );
        $sampled = min( $sample, $total );
        $missing = max( 0, $sampled - $with_desc );
        $pct = $sampled > 0 ? round( ( $with_desc / $sampled ) * 100, 1 ) : 100;
        return [
            'total'   => $total,
            'sampled' => $sampled,
            'missing' => $missing,
            'pct'     => $pct,
        ];
    }

    /**
     * Check image alt coverage. Counts total <img> tags in recent posts and how many have alt.
     */
    private static function check_image_alts() {
        global $wpdb;
        $sample = 20;
        $posts = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT post_content FROM {$wpdb->posts}
                 WHERE post_status = 'publish' AND post_type IN ('post','page')
                 ORDER BY post_date DESC LIMIT %d",
                $sample
            )
        );
        $total = 0;
        $with_alt = 0;
        foreach ( $posts as $p ) {
            preg_match_all( '/<img[^>]*>/i', $p->post_content, $imgs );
            foreach ( $imgs[0] as $img ) {
                $total++;
                if ( preg_match( '/alt\s*=\s*"[^"]+"|alt\s*=\s*\'[^\']+\'/i', $img ) ) {
                    $with_alt++;
                }
            }
        }
        $missing = max( 0, $total - $with_alt );
        $pct = $total > 0 ? round( ( $with_alt / $total ) * 100, 1 ) : 100;
        return [
            'total'   => $total,
            'missing' => $missing,
            'pct'     => $pct,
        ];
    }

    /**
     * Count broken external links in recent posts. Returns count + sample URLs.
     */
    private static function check_broken_externals( $post_limit = 10 ) {
        // Reuse the existing hygiene scan results if available
        $stored = get_option( 'ashbi_last_link_scan', null );
        if ( is_array( $stored ) && ! empty( $stored['timestamp'] ) ) {
            // Only use if it's recent (within 14 days)
            $ts = strtotime( $stored['timestamp'] );
            if ( $ts && ( time() - $ts ) < 14 * DAY_IN_SECONDS ) {
                return [
                    'count'     => count( $stored['broken'] ?? [] ),
                    'sampled'   => $stored['total_checked'] ?? 0,
                    'timestamp' => $stored['timestamp'],
                    'examples'  => array_slice( $stored['broken'] ?? [], 0, 3 ),
                ];
            }
        }
        return [
            'count'   => 0,
            'sampled' => 0,
            'note'    => 'Run a link scan to populate',
        ];
    }
}
