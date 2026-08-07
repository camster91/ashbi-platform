<?php
if ( ! defined( 'ABSPATH' ) ) exit;

class Ashbi_Executor {
	public static function run_wp_cli( $command ) {
		if ( ! self::is_wp_cli_available() ) {
			return [ 'success' => false, 'output' => 'shell_exec is disabled on this server.' ];
		}
		$allowed_subcommands = array( 'plugin', 'theme', 'core', 'transient', 'cache', 'db', 'cron' );
		$parts               = preg_split( '/\s+/', trim( $command ) );
		$subcommand          = isset( $parts[0] ) ? strtolower( $parts[0] ) : '';
		if ( ! in_array( $subcommand, $allowed_subcommands, true ) ) {
			return [ 'success' => false, 'output' => "Command '$subcommand' is not in the allowed list." ];
		}
		// Per-subcommand second-token allowlist. The top-level allowlist above
		// only screens the first token, which means `wp plugin install <slug>`
		// would otherwise let the hub pull any plugin from WordPress.org without
		// local review. Deny the high-impact verbs; keep `list`, `status`,
		// `update` open since they're how the rest of the bridge is wired.
		$second               = isset( $parts[1] ) ? strtolower( $parts[1] ) : '';
		$denied_second_tokens = [
			'plugin'  => [ 'install', 'activate', 'deactivate', 'uninstall', 'delete', 'enable', 'disable', 'toggle' ],
			'theme'   => [ 'install', 'activate', 'uninstall', 'delete', 'enable', 'disable' ],
			'core'    => [ 'download', 'install' ],
		];
		if ( isset( $denied_second_tokens[ $subcommand ] ) && in_array( $second, $denied_second_tokens[ $subcommand ], true ) ) {
			return [ 'success' => false, 'output' => "Verb '$second' for '$subcommand' is denied for remote use. Run it from the host shell instead." ];
		}
		if ( 'db' === $subcommand ) {
			$db_action          = isset( $parts[1] ) ? strtolower( $parts[1] ) : '';
			$allowed_db_actions = array( 'size', 'tables', 'optimize', 'check', 'repair' );
			if ( ! in_array( $db_action, $allowed_db_actions, true ) ) {
				return [ 'success' => false, 'output' => "Database action '$db_action' is not allowed." ];
			}
		}
		$escaped_parts = array_map( 'escapeshellarg', $parts );
		$full_cmd      = 'wp ' . implode( ' ', $escaped_parts ) . ' --allow-root 2>&1';
		$output        = shell_exec( $full_cmd );
		return [ 'success' => true, 'output' => $output ?: 'No output returned.' ];
	}

	public static function is_wp_cli_available() {
		return function_exists( 'shell_exec' ) && ! in_array( 'shell_exec', array_map( 'trim', explode( ',', ini_get( 'disable_functions' ) ) ), true );
	}

	public static function read_file( $path ) {
		$abs_path = ABSPATH . ltrim( $path, '/' );
		if ( ! file_exists( $abs_path ) ) {
			return [ 'success' => false, 'error' => 'File not found: ' . $path ];
		}
		$abspath_real = realpath( ABSPATH );
		$resolved     = realpath( $abs_path );
		if ( false === $abspath_real || false === $resolved || 0 !== strpos( $resolved, $abspath_real . DIRECTORY_SEPARATOR ) ) {
			return [ 'success' => false, 'error' => 'Access denied: path outside WordPress root.' ];
		}
		return [ 'success' => true, 'content' => file_get_contents( $abs_path ) ];
	}

	public static function patch_file( $path, $find, $replace ) {
		$abs_path = ABSPATH . ltrim( $path, '/' );
		if ( ! file_exists( $abs_path ) ) {
			return [ 'success' => false, 'error' => 'File not found: ' . $path ];
		}
		$abspath_real = realpath( ABSPATH );
		$resolved     = realpath( $abs_path );
		if ( false === $abspath_real || false === $resolved || 0 !== strpos( $resolved, $abspath_real . DIRECTORY_SEPARATOR ) ) {
			return [ 'success' => false, 'error' => 'Access denied: path outside WordPress root.' ];
		}
		// Refuse to proceed without a usable auto-backup. Silent backup failure
		// would let a bad patch ship without a recovery path.
		if ( ! class_exists( 'Ashbi_Backup' ) ) {
			return [ 'success' => false, 'error' => 'Auto-backup class unavailable; patch refused for safety.' ];
		}
		$backup_result = Ashbi_Backup::backup_file_before_change( $abs_path );
		if ( empty( $backup_result ) ) {
			return [ 'success' => false, 'error' => 'Auto-backup failed (disk full? perms?); patch refused to protect your recovery path.' ];
		}

		$content     = file_get_contents( $abs_path );
		$occurrences = substr_count( $content, $find );

		// Refuse ambiguous patches. `str_replace` would happily rewrite every
		// match in the file — a footgun when the hub UI says "fix this typo"
		// but the same string exists elsewhere in the file.
		if ( 0 === $occurrences ) {
			return [ 'success' => false, 'error' => 'Search string not found in file.' ];
		}
		if ( $occurrences > 1 ) {
			return [
				'success'    => false,
				'error'      => sprintf(
					'Search string appears %d times in this file. Provide a more specific `find` (with surrounding context) so only one occurrence is matched.',
					$occurrences
				),
			];
		}

		$new_content = str_replace( $find, $replace, $content );

		// Side-of-file `<path>.bak` for ops who expect it next to the source.
		// The timestamped snapshot is already at $backup_result in the backup
		// dir, so this is a secondary convenience copy that overwrites on a
		// second patch — the timestamped one in the backup dir is the recovery
		// path that survives.
		copy( $abs_path, $abs_path . '.bak' );
		if ( false === file_put_contents( $abs_path, $new_content ) ) {
			return [ 'success' => false, 'error' => 'Failed to write to file. Permission issue?' ];
		}
		return [
			'success' => true,
			'message' => sprintf( 'File patched (%d occurrence). Auto-backup: %s', $occurrences, basename( $backup_result ) ),
		];
	}
}
