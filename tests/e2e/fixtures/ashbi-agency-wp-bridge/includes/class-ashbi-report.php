<?php
if ( ! defined( 'ABSPATH' ) ) exit;

class Ashbi_Report {

    public static function init() {
        if ( ! wp_next_scheduled( 'ashbi_monthly_report' ) ) {
            wp_schedule_event( time(), 'monthly', 'ashbi_monthly_report' );
        }
        add_action( 'ashbi_monthly_report', [ __CLASS__, 'send_monthly_report' ] );
    }

    public static function init_schedule() {
        add_filter( 'cron_schedules', function( $schedules ) {
            if ( ! isset( $schedules['monthly'] ) ) {
                $schedules['monthly'] = [ 'interval' => 30 * DAY_IN_SECONDS, 'display' => __( 'Once Monthly' ) ];
            }
            return $schedules;
        });
    }

    public static function send_monthly_report() {
        $site_name = get_bloginfo( 'name' );
        $site_url  = home_url();
        $month     = date( 'F Y' );

        $uptime  = self::get_uptime_summary();
        $hygiene = get_option( 'ashbi_last_hygiene', [] );
        $backup  = get_option( 'ashbi_last_backup', [] );
        $hours   = Ashbi_Hours::get_status();
        $ssl     = $hygiene['ssl'] ?? [ 'status' => 'unknown', 'days' => 0 ];
        $updates = [
            'plugins' => $hygiene['counts']['plugin_updates'] ?? 0,
            'themes'  => $hygiene['counts']['theme_updates'] ?? 0,
            'core'    => $hygiene['counts']['core_updates'] ?? 0,
        ];
        $cleanup = [
            'revisions'      => $hygiene['counts']['revisions'] ?? 0,
            'spam_comments'  => $hygiene['counts']['spam_comments'] ?? 0,
            'trash_posts'    => $hygiene['counts']['trash_posts'] ?? 0,
            'expired_tokens' => $hygiene['counts']['expired_tokens'] ?? 0,
        ];

        $seo = function_exists( 'Ashbi_SEO' ) ? Ashbi_SEO::get_snapshot() : null;
        $checks = function_exists( 'Ashbi_Checks' ) ? Ashbi_Checks::get_cached() : null;

        $verdict       = self::compute_verdict( $uptime, $updates, $ssl, $backup, $seo, $checks );
        $summary       = self::build_summary( $verdict, $uptime, $updates, $cleanup, $backup, $ssl, $hours );
        $action_items  = self::build_action_items( $verdict, $seo, $ssl, $updates, $uptime, $backup, $cleanup, $hours );

        // Send-mode gate: default internal, client opt-in required
        $send_mode = get_option( 'ashbi_send_mode', 'internal' );
        $send_to   = self::resolve_recipient( $send_mode, $verdict );

        $html = self::build_email_html( $site_name, $site_url, $month, $uptime, $updates, $cleanup, $backup, $hours, $ssl, $seo, $verdict, $summary, $action_items, $send_mode );

        $sent = false;
        if ( $send_to ) {
            $subject_prefix = $send_mode === 'internal' ? '[INTERNAL ' . strtoupper( $verdict['level'] ) . ']' : '[' . $verdict['emoji'] . ']';
            $subject = sprintf( '%s %s — %s', $subject_prefix, $site_name, $month );
            $headers = [ 'Content-Type: text/html; charset=UTF-8' ];
            $sent = wp_mail( $send_to, $subject, $html, $headers );
        }

        update_option( 'ashbi_last_report', [
            'timestamp' => current_time( 'mysql' ),
            'month'     => $month,
            'sent_to'   => $send_to,
            'verdict'   => $verdict['level'],
            'send_mode' => $send_mode,
            'sent'      => $sent,
            'suppressed' => $send_to === null,
            'action_items' => $action_items,
        ] );
        self::send_report_to_hub([
            'siteUrl'      => $site_url,
            'month'        => $month,
            'uptime'       => $uptime,
            'updates'      => $updates,
            'cleanup'      => $cleanup,
            'hours'        => $hours,
            'ssl'          => $ssl,
            'seo'          => $seo,
            'verdict'      => $verdict,
            'action_items' => $action_items,
            'send_mode'    => $send_mode,
        ] );
        return $sent;
    }

    /**
     * Resolve where to send the report.
     * - internal mode: always send to internal email, never to site admin
     * - client mode: send to site admin EXCEPT when verdict=fix (suppress by default)
     *   (the override option 'ashbi_send_fix_to_client' lets agencies opt in)
     */
    public static function resolve_recipient( $send_mode, $verdict ) {
        $internal = get_option( 'ashbi_internal_email', '' );
        if ( $send_mode === 'internal' ) {
            if ( empty( $internal ) ) {
                if ( function_exists( 'Ashbi_Logger' ) ) {
                    Ashbi_Logger::log( 'monthly_report', [ 'reason' => 'ashbi_internal_email not configured', 'send_mode' => $send_mode ], 'skipped' );
                }
                throw new \RuntimeException( 'ashbi_internal_email option is not configured; refusing to send report to default address.' );
            }
            return $internal;
        }
        // client mode
        if ( $verdict['level'] === 'fix' ) {
            $allow_fix = (bool) get_option( 'ashbi_send_fix_to_client', false );
            if ( ! $allow_fix ) {
                return null; // suppressed
            }
        }
        return get_option( 'admin_email' );
    }

    /**
     * Build a concrete, human-actionable list of items to fix.
     * Each item: title + what to do + which class/endpoint handles it.
     */
    public static function build_action_items( $verdict, $seo, $ssl, $updates, $uptime, $backup, $cleanup, $hours ) {
        if ( empty( $verdict['issues'] ) ) {
            return [];
        }
        $items = [];
        $fix_map = [
            'uptime dropped' => [
                'title' => 'Investigate uptime drop',
                'do'    => 'Check ashbi_ping_history option for the failed pings. Look at error responses (5xx vs 4xx vs timeout). If 5xx from host, escalate to Hostinger. If 4xx, usually a plugin misfire.',
            ],
            'SSL certificate expires' => [
                'title' => 'Renew SSL certificate',
                'do'    => "Run: wp --allow-root eval 'Ashbi_Hygiene::check_ssl();'. If auto-renew is broken (Let\'s Encrypt via Hostinger panel), trigger manual renewal from hPanel → SSL → Force renew.",
            ],
            'last backup had a failure' => [
                'title' => 'Diagnose backup failure',
                'do'    => "Check /home/u*/domains/*/public_html/wp-content/ashbi-backups/ for partial files. Run: wp --allow-root eval 'Ashbi_Backup::run_full_backup();' manually to reproduce. Check disk space with: df -h /home.",
            ],
            'WordPress core update pending' => [
                'title' => 'Apply core update',
                'do'    => "Run: wp --allow-root core update && wp --allow-root core update-db. Test on staging first if a major version jump (5.x → 6.x). For minor: safe to apply to production after a fresh backup.",
            ],
            'broken external links' => [
                'title' => 'Fix or remove broken external links',
                'do'    => "Review the broken_externals.examples list in get_option('ashbi_last_link_scan'). For 429/403 (rate-limited), wait 24h and re-scan — they may be false positives. For 404, edit the post to remove or replace the link.",
            ],
        ];

        foreach ( $verdict['issues'] as $issue ) {
            foreach ( $fix_map as $key => $fix ) {
                if ( stripos( $issue, $key ) !== false ) {
                    $items[] = [
                        'issue' => $issue,
                        'title' => $fix['title'],
                        'do'    => $fix['do'],
                    ];
                    break;
                }
            }
        }
        return $items;
    }

    /**
     * Compute a simple verdict from the report data.
     * Returns: level (good|attention|fix), emoji, headline, why.
     */
    public static function compute_verdict( $uptime, $updates, $ssl, $backup, $seo, $checks = null ) {
        $issues = [];

        if ( $uptime['pct'] !== 'N/A' && $uptime['pct'] < 99 ) {
            $issues[] = "uptime dropped to {$uptime['pct']}%";
        }
        if ( $ssl['status'] === 'EXPIRING' || ( isset( $ssl['days'] ) && $ssl['days'] < 14 && $ssl['status'] !== 'OK' ) ) {
            $issues[] = 'SSL certificate expires in ' . (int) $ssl['days'] . ' days';
        }
        if ( ! empty( $backup ) && ( empty( $backup['dbSuccess'] ) || empty( $backup['filesSuccess'] ) ) ) {
            $issues[] = 'last backup had a failure';
        }
        if ( $updates['core'] > 0 ) {
            $issues[] = "WordPress core update pending";
        }
        if ( is_array( $seo ) && isset( $seo['broken_externals']['count'] ) && $seo['broken_externals']['count'] > 5 ) {
            $issues[] = "{$seo['broken_externals']['count']} broken external links found";
        }
        // Custom checks: surface any 'bad' status as an issue
        if ( is_array( $checks ) && ! empty( $checks['results'] ) ) {
            foreach ( $checks['results'] as $name => $result ) {
                if ( isset( $result['status'] ) && $result['status'] === 'bad' ) {
                    $issues[] = "custom check failed: {$result['label']}";
                }
            }
        }

        if ( empty( $issues ) ) {
            return [
                'level'    => 'good',
                'emoji'    => '✅',
                'headline' => 'All good',
                'summary'  => 'Your site is healthy — all systems normal for the month.',
                'issues'   => [],
            ];
        }
        if ( count( $issues ) <= 2 ) {
            return [
                'level'    => 'attention',
                'emoji'    => '⚠️',
                'headline' => 'Worth a look',
                'summary'  => 'A few items need attention, but nothing urgent.',
                'issues'   => $issues,
            ];
        }
        return [
            'level'    => 'fix',
            'emoji'    => '🔧',
            'headline' => 'Action needed',
            'summary'  => 'Several items need attention this month.',
            'issues'   => $issues,
        ];
    }

    /**
     * Build 3 plain-English bullets summarizing the month.
     */
    public static function build_summary( $verdict, $uptime, $updates, $cleanup, $backup, $ssl, $hours ) {
        $bullets = [];

        // Uptime
        if ( $uptime['pct'] !== 'N/A' ) {
            if ( $uptime['pct'] >= 99.9 ) {
                $bullets[] = "Your site stayed online {$uptime['pct']}% of the time this month.";
            } elseif ( $uptime['pct'] >= 99 ) {
                $bullets[] = "Your site was up {$uptime['pct']}% of the time — a few brief interruptions occurred.";
            } else {
                $bullets[] = "Your site had some downtime this month ({$uptime['pct']}% uptime). We've reviewed the cause.";
            }
        } else {
            $bullets[] = "Uptime tracking just started — we'll have a full picture next month.";
        }

        // Updates
        $pending = ( $updates['core'] ?? 0 ) + ( $updates['plugins'] ?? 0 ) + ( $updates['themes'] ?? 0 );
        if ( $pending === 0 ) {
            $bullets[] = "WordPress core, plugins, and themes are all up to date.";
        } elseif ( $pending <= 2 ) {
            $bullets[] = "{$pending} update" . ( $pending === 1 ? '' : 's' ) . " applied this month.";
        } else {
            $bullets[] = "{$pending} updates available — scheduled for the next maintenance window.";
        }

        // Cleanup
        $total_cleaned = ( $cleanup['revisions'] ?? 0 ) + ( $cleanup['spam_comments'] ?? 0 ) + ( $cleanup['trash_posts'] ?? 0 ) + ( $cleanup['expired_tokens'] ?? 0 );
        if ( $total_cleaned > 0 ) {
            $bullets[] = "Database cleanup: removed {$total_cleaned} junk items to keep things fast.";
        } else {
            $bullets[] = "Database is clean — no bloat to remove.";
        }

        return $bullets;
    }

    private static function get_uptime_summary() {
        $pings = get_option( 'ashbi_ping_history', [] );
        if ( empty( $pings ) ) return [ 'total' => 0, 'ok' => 0, 'failed' => 0, 'pct' => 'N/A' ];
        $total = count( $pings );
        $ok    = count( array_filter( $pings, function( $p ) { return ( $p['status'] ?? '' ) === 'ok'; } ) );
        return [ 'total' => $total, 'ok' => $ok, 'failed' => $total - $ok, 'pct' => round( ( $ok / $total ) * 100, 1 ) ];
    }

    private static function build_email_html( $site_name, $site_url, $month, $uptime, $updates, $cleanup, $backup, $hours, $ssl, $seo, $verdict, $summary_bullets, $checks = null, $send_mode = 'client' ) {
        $brand = self::brand();

        $logo_url  = $brand['logo_url'];
        $primary   = $brand['primary'];    // #2e2958 deep purple
        $accent    = $brand['accent'];     // #e6f354 lime
        $light     = $brand['light'];      // #faf9f2 off-white
        $text      = $brand['text'];       // #1a1a1a
        $muted     = $brand['muted'];      // #6b6b7a
        $ok        = $brand['ok'];         // #16a34a
        $warn      = $brand['warn'];       // #d97706
        $bad       = $brand['bad'];        // #dc2626
        $border    = $brand['border'];     // #e5e5e5

        // Escape all dynamic inputs that flow into the HTML template. The email
        // is rendered as text/html, so any unsanitized site-controlled value
        // (blogname, blogdescription, custom check labels) becomes an XSS vector
        // for the recipient. esc_html on every external input; brand colors are
        // already whitelisted hex from the brand() filter.
        $site_name = esc_html( $site_name );
        $site_url  = esc_url( $site_url );
        $month     = esc_html( $month );

        $verdict_color = $verdict['level'] === 'good' ? $ok : ( $verdict['level'] === 'attention' ? $warn : $bad );
        $verdict['headline'] = esc_html( $verdict['headline'] );
        $verdict['summary']  = esc_html( $verdict['summary'] );
        $verdict['emoji']    = esc_html( $verdict['emoji'] );

        $ssl_color = $ssl['status'] === 'OK' ? $ok : ( $ssl['status'] === 'WARNING' ? $warn : $bad );

        // Escape the values that flow into the SSL status row. Today these are
        // hardcoded enums from check_ssl_expiry() (OK/WARNING/CRITICAL/EXPIRED/
        // check_failed/no_ssl) so the XSS surface is empty — but a future plugin
        // or filter could feed arbitrary HTML through here. Defense-in-depth.
        $ssl_status_esc = esc_html( (string) ( $ssl['status'] ?? 'unknown' ) );
        $ssl_days_esc   = (int) ( $ssl['days'] ?? 0 );

        $uptime_row = $uptime['pct'] !== 'N/A'
            ? esc_html( $uptime['pct'] ) . "% <span style='color:{$muted};font-weight:400;'>(" . (int) $uptime['ok'] . "/" . (int) $uptime['total'] . " checks)</span>"
            : "<span style='color:{$muted};font-weight:400;'>Collecting data…</span>";

        $core_label = $updates['core'] > 0 ? 'Update available' : 'Up to date';
        $plugin_label = $updates['plugins'] > 0 ? esc_html( $updates['plugins'] ) . " pending" : 'Up to date';
        $theme_label  = $updates['themes'] > 0 ? esc_html( $updates['themes'] ) . " pending" : 'Up to date';

        $db_ok    = ! empty( $backup ) && $backup['dbSuccess']    ? "<span style='color:{$ok};font-weight:600;'>Success</span>" : "<span style='color:{$bad};font-weight:600;'>Not run</span>";
        $files_ok = ! empty( $backup ) && $backup['filesSuccess'] ? "<span style='color:{$ok};font-weight:600;'>Success</span>" : "<span style='color:{$bad};font-weight:600;'>Not run</span>";
        $backup_meta = ! empty( $backup ) ? esc_html( $backup['timestamp'] ) : 'No backup recorded yet (first backup runs on next scheduled cycle).';

        $hours_remaining = number_format( (float) ( $hours['remaining'] ?? 0 ), 1 );
        $hours_used      = number_format( (float) ( $hours['used_this_month'] ?? 0 ), 1 );
        $hours_total     = number_format( (float) ( $hours['available'] ?? 1 ), 1 );
        $hours_tier      = esc_html( ucfirst( $hours['tier'] ?? 'professional' ) );

        $summary_html = '<ul>';
        foreach ( $summary_bullets as $bullet ) {
            $summary_html .= "<li style='margin-bottom:8px;line-height:1.5;'>" . esc_html( $bullet ) . "</li>";
        }
        $summary_html .= '</ul>';

        // Build custom-checks section (only when checks exist and are non-default)
        $checks_html = '';
        if ( is_array( $checks ) && ! empty( $checks['results'] ) ) {
            $check_status_color = [
                'ok'   => $ok,
                'warn' => $warn,
                'bad'  => $bad,
            ];
            $rows = '';
            foreach ( $checks['results'] as $name => $r ) {
                $status = $r['status'] ?? 'warn';
                $color  = $check_status_color[ $status ] ?? $muted;
                $icon   = $status === 'ok' ? '✓' : ( $status === 'bad' ? '✗' : '!' );
                $rows  .= "          <tr><td style=\"padding:6px 0;font-size:14px;\"><span style=\"color:{$color};font-weight:700;margin-right:6px;\">{$icon}</span>" . esc_html( $r['label'] ?? '' ) . "</td><td style=\"padding:6px 0;font-size:13px;text-align:right;color:{$muted};\">" . esc_html( $r['detail'] ?? '' ) . "</td></tr>\n";
            }
            $checks_html = <<<CHECKS
      <tr><td style="padding:24px 40px 0;">
        <div style="font-size:11px;color:{$muted};font-weight:700;letter-spacing:1.2px;text-transform:uppercase;border-bottom:1px solid {$border};padding-bottom:8px;margin-bottom:12px;">Health Checks</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
{$rows}        </table>
      </td></tr>

CHECKS;
        }

        $html = <<<HTML
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:{$light};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:{$text};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{$light};padding:32px 0;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(46,41,88,0.08);">

      <!-- Top Header: Logo + Contact -->
      <tr>
        <td style="background:{$primary};padding:24px 40px;text-align:center;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td align="left" width="50%" style="padding-bottom:16px;">
                <img src="{$logo_url}" alt="Ashbi Design" width="180" style="display:block;max-width:180px;height:auto;">
              </td>
              <td align="right" width="50%" style="padding-bottom:16px;font-size:13px;">
                <a href="mailto:hello@ashbi.ca" style="color:#ffffff;text-decoration:none;border-bottom:1px solid {$accent};">hello@ashbi.ca</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Report Title -->
      <tr>
        <td style="padding:28px 40px 8px;text-align:center;">
          <div style="font-size:11px;color:{$muted};font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 8px;">Monthly Maintenance Report</div>
          <div style="font-size:26px;font-weight:700;color:{$primary};line-height:1.2;">{$site_name}</div>
          <div style="font-size:16px;color:{$muted};line-height:1.4;margin:4px 0 16px;">{$month} · <a href="{$site_url}" style="color:{$primary};text-decoration:none;border-bottom:1px solid {$accent};">{$site_url}</a></div>
        </td>
      </tr>

      <!-- Verdict -->
      <tr>
        <td style="padding:0 40px;">
          <div style="background:{$light};border-left:4px solid {$verdict_color};border-radius:4px;padding:16px 20px;">
            <div style="font-size:11px;color:{$muted};font-weight:600;letter-spacing:1.2px;text-transform:uppercase;margin-bottom:4px;">Status Overview</div>
            <div style="font-size:24px;font-weight:700;color:{$primary};line-height:1.1;margin-bottom:8px;">{$verdict['emoji']} {$verdict['headline']}</div>
            <p style="font-size:15px;line-height:1.5;color:{$muted};margin:0;">{$verdict['summary']}</p>
          </div>
        </td>
      </tr>

      <!-- Summary bullets (if any issues) -->
      <tr>
        <td style="padding:16px 40px 0;">
          <div style="font-size:11px;color:{$muted};font-weight:700;letter-spacing:1.2px;text-transform:uppercase;border-bottom:1px solid {$border};padding-bottom:8px;margin-bottom:12px;">Summary of Activity</div>
          {$summary_html}
        </td>
      </tr>

      <!-- Section: Uptime -->
      <tr><td style="padding:16px 40px 0;">
        <div style="font-size:11px;color:{$muted};font-weight:700;letter-spacing:1.2px;text-transform:uppercase;border-bottom:1px solid {$border};padding-bottom:8px;margin-bottom:12px;">Uptime</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:6px 0;font-size:14px;width:50%;"><span style="color:{$muted};">This Month</span></td>
            <td style="padding:6px 0;font-size:14px;text-align:right;font-weight:600;color:{$primary};">{$uptime_row}</td>
          </tr>
        </table>
      </td></tr>

      <!-- Section: Updates -->
      <tr><td style="padding:24px 40px 0;">
        <div style="font-size:11px;color:{$muted};font-weight:700;letter-spacing:1.2px;text-transform:uppercase;border-bottom:1px solid {$border};padding-bottom:8px;margin-bottom:12px;">Updates</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:6px 0;font-size:14px;width:50%;"><span style="color:{$muted};">WordPress Core</span></td>
            <td style="padding:6px 0;font-size:14px;text-align:right;font-weight:600;color:{$primary};">{$core_label}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;font-size:14px;border-top:1px solid {$border};"><span style="color:{$muted};">Plugins</span></td>
            <td style="padding:6px 0;font-size:14px;text-align:right;font-weight:600;color:{$primary};border-top:1px solid {$border};">{$plugin_label}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;font-size:14px;border-top:1px solid {$border};"><span style="color:{$muted};">Themes</span></td>
            <td style="padding:6px 0;font-size:14px;text-align:right;font-weight:600;color:{$primary};border-top:1px solid {$border};">{$theme_label}</td>
          </tr>
        </table>
      </td></tr>

      <!-- Section: Cleanup -->
      <tr><td style="padding:24px 40px 0;">
        <div style="font-size:11px;color:{$muted};font-weight:700;letter-spacing:1.2px;text-transform:uppercase;border-bottom:1px solid {$border};padding-bottom:8px;margin-bottom:12px;">Database Optimization</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
HTML;
        $rows = [
            [ 'Old revisions removed',  (int) $cleanup['revisions'] ],
            [ 'Spam comments removed',  (int) $cleanup['spam_comments'] ],
            [ 'Trash posts removed',    (int) $cleanup['trash_posts'] ],
            [ 'Expired tokens purged',  (int) $cleanup['expired_tokens'] ],
        ];
        foreach ( $rows as $i => $r ) {
            $border_top = $i > 0 ? "border-top:1px solid {$border};" : '';
            $html .= "          <tr><td style=\"padding:6px 0;font-size:14px;{$border_top}\"><span style=\"color:{$muted};\">{$r[0]}</span></td><td style=\"padding:6px 0;font-size:14px;text-align:right;font-weight:600;color:{$primary};{$border_top}\">{$r[1]}</td></tr>\n";
        }

        $html .= <<<HTML
        </table>
      </td></tr>

      <!-- Section: SEO (new) -->
      HTML;
        if ( is_array( $seo ) && ! empty( $seo ) ) {
            $sitemap_label = $seo['sitemap']['present'] ? 'Yes' : 'No';
        $robots_label  = $seo['robots']['present'] ? 'Yes' : 'No';
        $meta_pct      = $seo['meta_descriptions']['pct'] . '% coverage';
        $alt_pct       = $seo['image_alts']['pct'] . '% coverage';
        $broken_count  = $seo['broken_externals']['count'] ?? 0;
        $broken_row    = '';
        if ( $broken_count > 0 ) {
            $broken_row = "          <tr>\n            <td style=\"padding:6px 0;font-size:14px;border-top:1px solid {$border};\"><span style=\"color:{$muted};\">Broken external links</span></td>\n            <td style=\"padding:6px 0;font-size:14px;text-align:right;font-weight:600;color:{$bad};border-top:1px solid {$border};\">{$broken_count} found</td>\n          </tr>\n";
        }

        $html .= <<<HTML
      <tr><td style="padding:24px 40px 0;">
        <div style="font-size:11px;color:{$muted};font-weight:700;letter-spacing:1.2px;text-transform:uppercase;border-bottom:1px solid {$border};padding-bottom:8px;margin-bottom:12px;">SEO Health</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:6px 0;font-size:14px;width:50%;"><span style="color:{$muted};">Sitemap detected</span></td>
            <td style="padding:6px 0;font-size:14px;text-align:right;font-weight:600;color:{$primary};">{$sitemap_label}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;font-size:14px;border-top:1px solid {$border};"><span style="color:{$muted};">robots.txt present</span></td>
            <td style="padding:6px 0;font-size:14px;text-align:right;font-weight:600;color:{$primary};border-top:1px solid {$border};">{$robots_label}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;font-size:14px;border-top:1px solid {$border};"><span style="color:{$muted};">Meta descriptions</span></td>
            <td style="padding:6px 0;font-size:14px;text-align:right;font-weight:600;color:{$primary};border-top:1px solid {$border};">{$meta_pct}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;font-size:14px;border-top:1px solid {$border};"><span style="color:{$muted};">Image alt text</span></td>
            <td style="padding:6px 0;font-size:14px;text-align:right;font-weight:600;color:{$primary};border-top:1px solid {$border};">{$alt_pct}</td>
          </tr>
{$broken_row}        </table>
      </td></tr>
HTML;
        }

        $html .= <<<HTML
      <!-- Section: SSL -->
      {$checks_html}
      <!-- Section: SSL continued -->
      <tr><td style="padding:24px 40px 0;">
        <div style="font-size:11px;color:{$muted};font-weight:700;letter-spacing:1.2px;text-transform:uppercase;border-bottom:1px solid {$border};padding-bottom:8px;margin-bottom:12px;">SSL Certificate</div>
        <div style="font-size:14px;line-height:1.5;padding:8px 0;">
          Status: <span style="color:{$ssl_color};font-weight:700;">{$ssl_status_esc}</span>
          <span style="color:{$muted};"> · {$ssl_days_esc} days remaining</span>
        </div>
      </td></tr>

      <!-- Section: Backup -->
      <tr><td style="padding:24px 40px 0;">
        <div style="font-size:11px;color:{$muted};font-weight:700;letter-spacing:1.2px;text-transform:uppercase;border-bottom:1px solid {$border};padding-bottom:8px;margin-bottom:12px;">Last Backup</div>
        <div style="font-size:13px;color:{$muted};margin-bottom:8px;">{$backup_meta}</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:6px 0;font-size:14px;width:50%;"><span style="color:{$muted};">Database</span></td>
            <td style="padding:6px 0;font-size:14px;text-align:right;">{$db_ok}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;font-size:14px;border-top:1px solid {$border};"><span style="color:{$muted};">Files</span></td>
            <td style="padding:6px 0;font-size:14px;text-align:right;border-top:1px solid {$border};">{$files_ok}</td>
          </tr>
        </table>
      </td></tr>

      <!-- Section: Support Hours -->
      <tr><td style="padding:24px 40px 0;">
        <div style="font-size:11px;color:{$muted};font-weight:700;letter-spacing:1.2px;text-transform:uppercase;border-bottom:1px solid {$border};padding-bottom:8px;margin-bottom:12px;">Support Hours <span style="color:{$accent};background:{$primary};font-size:9px;padding:2px 6px;border-radius:8px;margin-left:6px;letter-spacing:0.5px;">{$hours_tier}</span></div>
        <div style="font-size:14px;line-height:1.5;">
          <span style="color:{$primary};font-weight:700;font-size:18px;">{$hours_remaining}h</span>
          <span style="color:{$muted};"> remaining this cycle · {$hours_used}h used of {$hours_total}h</span>
        </div>
      </td></tr>

      <!-- CTA + footer -->
      <tr>
        <td style="padding:32px 40px 16px;text-align:center;">
          <a href="https://ashbi.ca" style="display:inline-block;background:{$primary};color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;letter-spacing:0.5px;padding:12px 28px;border-radius:24px;">View live site</a>
        </td>
      </tr>
      <tr>
        <td style="background:{$light};padding:24px 40px;border-top:1px solid {$border};">
          <div style="font-size:12px;color:{$muted};line-height:1.5;text-align:center;">
            <div style="color:{$primary};font-weight:600;margin-bottom:4px;">Ashbi Design</div>
            <div>Toronto, Canada · CPG &amp; DTC Branding Agency</div>
            <div style="margin-top:8px;">Need to request a change or have a question? <a href="mailto:hello@ashbi.ca" style="color:{$primary};text-decoration:none;border-bottom:1px solid {$accent};">hello@ashbi.ca</a></div>
            <div style="margin-top:12px;font-size:11px;color:{$muted};">Generated automatically by the Ashbi Agency WP Bridge on your site.</div>
          </div>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>
HTML;
        return $html;
    }


    /**
     * Ashbi brand identity used in all outbound reports.
     * Override via filter 'ashbi_brand' to customize per client.
     */
    public static function brand() {
        $default = [
            'logo_url' => plugins_url( 'assets/ashbi-logo.png', ASHBI_BRIDGE_DIR . 'ashbi-agency-wp-bridge.php' ),
            'primary'  => '#2e2958',  // deep purple
            'accent'   => '#e6f354',  // electric lime
            'light'    => '#faf9f2',  // off-white background
            'text'     => '#1a1a1a',
            'muted'    => '#6b6b7a',
            'ok'       => '#16a34a',
            'warn'     => '#d97706',
            'bad'      => '#dc2626',
            'border'   => '#e5e5e5',
        ];
        return apply_filters( 'ashbi_brand', $default );
    }

    private static function send_report_to_hub( $report ) {
        $hub_url = get_option( 'ashbi_hub_url', '' );
        $secret  = get_option( 'ashbi_secret_key', '' );
        if ( empty( $hub_url ) || empty( $secret ) ) return;

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
                'Content-Type'      => 'application/json',
                'X-Ashbi-Timestamp' => $timestamp,
                'X-Ashbi-Signature' => 'sha256=' . $signature,
            ],
            'timeout'   => 10,
            'blocking'  => false,
            'sslverify' => true,
        ] );
    }
}
