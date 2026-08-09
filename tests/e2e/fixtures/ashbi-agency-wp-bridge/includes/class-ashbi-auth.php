<?php
/**
 * Ashbi HMAC Authentication Class
 *
 * @package Ashbi_Agency_WP_Bridge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Ashbi_Auth {
	/**
	 * Verify the HMAC signature of a request with optional replay protection.
	 *
	 * Canonical string = X-Ashbi-Timestamp header + raw request body.
	 * Matches hub/src/lib/hmac-client.js which signs `timestamp + raw_body`.
	 *
	 * After a successful verify, the signature is recorded for the replay
	 * window so the exact same request cannot be replayed (timestamp window
	 * alone is not enough — an intercepted packet is valid for up to
	 * ASHBI_REPLAY_WINDOW seconds).
	 *
	 * @param WP_REST_Request $request The incoming REST request.
	 * @return bool|WP_Error True if the signature is valid, or WP_Error on failure.
	 */
	public static function verify_signature( $request ) {
		$key = get_option( 'ashbi_secret_key' );
		if ( ! $key ) {
			return new WP_Error( 'ashbi_missing_key', 'Secret key not configured on client site.', array( 'status' => 403 ) );
		}

		$signature = $request->get_header( 'X-ASHBI-SIGNATURE' );
		if ( ! $signature ) {
			return new WP_Error( 'ashbi_missing_signature', 'X-ASHBI-SIGNATURE header is missing.', array( 'status' => 403 ) );
		}

		// Timestamp header is required so we can sign `timestamp + body`
		// instead of just `body`. Mirrors the hub's hmac-client.js behavior.
		$timestamp = $request->get_header( 'X-ASHBI-TIMESTAMP' );
		if ( ! $timestamp ) {
			return new WP_Error( 'ashbi_missing_timestamp', 'X-ASHBI-TIMESTAMP header is missing.', array( 'status' => 403 ) );
		}

		// Reject non-numeric timestamps — strtotime() on attacker-controlled
		// strings is ambiguous and can slip past the window check.
		if ( ! is_numeric( $timestamp ) ) {
			return new WP_Error( 'ashbi_invalid_timestamp', 'X-ASHBI-TIMESTAMP must be a Unix epoch integer.', array( 'status' => 403 ) );
		}

		$body     = $request->get_body();
		$expected = hash_hmac( 'sha256', $timestamp . $body, $key );

		// Accept both raw HMAC and the `sha256=<hmac>` form (mirrors the
		// plugin's own outbound format in Ashbi_Backup::send_backup_report()).
		$received_sig = preg_replace( '/^sha256=/', '', (string) $signature );

		if ( ! hash_equals( $expected, $received_sig ) ) {
			return new WP_Error( 'ashbi_invalid_signature', 'HMAC signature verification failed.', array( 'status' => 403 ) );
		}

		// Replay protection: reject requests with stale timestamps.
		$request_time = (int) $timestamp;
		$window       = defined( 'ASHBI_REPLAY_WINDOW' ) ? (int) ASHBI_REPLAY_WINDOW : 300;
		if ( abs( time() - $request_time ) > $window ) {
			return new WP_Error( 'ashbi_replay', 'Request timestamp is outside the allowed window.', array( 'status' => 403 ) );
		}

		// Single-use within the window: bind on signature + timestamp so an
		// intercepted packet cannot be replayed while still fresh.
		$replay_key = 'ashbi_hmac_' . hash( 'sha256', $received_sig . '|' . $timestamp );
		if ( false !== get_transient( $replay_key ) ) {
			return new WP_Error( 'ashbi_replay', 'Request has already been processed (replay detected).', array( 'status' => 403 ) );
		}
		set_transient( $replay_key, 1, $window );

		return true;
	}

	/**
	 * Build outbound HMAC headers for hub POSTs/PUTs.
	 *
	 * Canonical string for hub-bound writes: timestamp.nonce.raw body.
	 *
	 * @param string      $body   Exact JSON body that will be sent.
	 * @param string|null $secret Optional override; defaults to ashbi_secret_key.
	 * @return array{body:string,headers:array<string,string>} Headers to merge
	 *         into wp_remote_* args. Includes Content-Type.
	 */
	public static function sign_outbound( $body, $secret = null ) {
		$secret = is_string( $secret ) ? $secret : (string) get_option( 'ashbi_secret_key', '' );
		$body   = (string) $body;
		$timestamp = (string) time();
		$nonce = bin2hex( random_bytes( 16 ) );
		$signature = $secret !== ''
			? hash_hmac( 'sha256', $timestamp . '.' . $nonce . '.' . $body, $secret )
			: '';

		$headers = [
			'Content-Type' => 'application/json',
		];
		if ( $signature !== '' ) {
			$headers['X-Ashbi-Timestamp'] = $timestamp;
			$headers['X-Ashbi-Nonce'] = $nonce;
			$headers['X-Ashbi-Signature'] = 'sha256=' . $signature;
		}

		return [
			'body'    => $body,
			'headers' => $headers,
		];
	}
}
