<?php
/**
 * Tests for Ashbi_Hours — tier-driven retainer rollover + use_hours.
 *
 * Covers:
 *   - No-op when current month == cycle_start month
 *   - Month boundary rollover with tier caps:
 *       basic        : 0h included, 0h max_banked
 *       professional : 1h included, 3h max_banked
 *       agency       : 4h included, 6h max_banked
 *   - use_hours deducts from available
 *   - use_hours over available returns "exceeds retainer" error
 */
class RolloverTest extends Ashbi_TestCase {
    private function setClock( string $ymd ): void {
        $GLOBALS['__ashbi_test_now'] = strtotime( $ymd . ' 12:00:00' );
    }

    private function setCycleStart( string $ymd ): void {
        update_option( 'ashbi_hours_cycle_start', $ymd );
    }

    public function test_no_op_when_same_month(): void {
        $this->setClock( '2026-07-15' );
        $this->setCycleStart( '2026-07-01' );
        update_option( 'ashbi_hours_available', 1.5 );
        update_option( 'ashbi_hours_used_this_month', 0.5 );

        Ashbi_Hours::maybe_cycle_month();

        $this->assertSame( 1.5, (float) get_option( 'ashbi_hours_available' ) );
        $this->assertSame( 0.5, (float) get_option( 'ashbi_hours_used_this_month' ) );
        $this->assertSame( '2026-07-01', get_option( 'ashbi_hours_cycle_start' ) );
    }

    public function test_basic_tier_rolls_with_zero_included(): void {
        update_option( 'ashbi_tier', 'basic' );
        $this->setClock( '2026-07-01' );
        $this->setCycleStart( '2026-06-01' );
        update_option( 'ashbi_hours_available', 0 );
        update_option( 'ashbi_hours_used_this_month', 0 );

        Ashbi_Hours::maybe_cycle_month();

        // basic: included=0, max_banked=0 → new_available = min(0+0, 0) = 0
        $this->assertSame( 0.0, (float) get_option( 'ashbi_hours_available' ) );
        $this->assertSame( 0.0, (float) get_option( 'ashbi_hours_used_this_month' ) );
        $this->assertSame( '2026-07-01', get_option( 'ashbi_hours_cycle_start' ) );
    }

    public function test_professional_banks_unused_up_to_cap(): void {
        update_option( 'ashbi_tier', 'professional' );
        $this->setClock( '2026-08-01' );
        $this->setCycleStart( '2026-07-01' );
        // 1h included, used 0 → unused=1 → new_available = min(1+1, 3) = 2
        update_option( 'ashbi_hours_available', 1.0 );
        update_option( 'ashbi_hours_used_this_month', 0.0 );

        Ashbi_Hours::maybe_cycle_month();

        $this->assertSame( 2.0, (float) get_option( 'ashbi_hours_available' ) );
    }

    public function test_professional_caps_unused_at_max_banked(): void {
        update_option( 'ashbi_tier', 'professional' );
        $this->setClock( '2026-09-01' );
        $this->setCycleStart( '2026-08-01' );
        // available=3, used=0 → unused=3 → new_available = min(1+3, 3) = 3 (capped)
        update_option( 'ashbi_hours_available', 3.0 );
        update_option( 'ashbi_hours_used_this_month', 0.0 );

        Ashbi_Hours::maybe_cycle_month();

        $this->assertSame( 3.0, (float) get_option( 'ashbi_hours_available' ) );
    }

    public function test_agency_tier_caps_at_six(): void {
        update_option( 'ashbi_tier', 'agency' );
        $this->setClock( '2026-10-01' );
        $this->setCycleStart( '2026-09-01' );
        // 4h included, used 0 → unused=4 → new_available = min(4+4, 6) = 6 (capped)
        update_option( 'ashbi_hours_available', 4.0 );
        update_option( 'ashbi_hours_used_this_month', 0.0 );

        Ashbi_Hours::maybe_cycle_month();

        $this->assertSame( 6.0, (float) get_option( 'ashbi_hours_available' ) );
    }

    public function test_agency_full_unused_returns_six(): void {
        // agency: 4 included + 6 unused banked → capped at 6
        update_option( 'ashbi_tier', 'agency' );
        $this->setClock( '2026-11-01' );
        $this->setCycleStart( '2026-10-01' );
        update_option( 'ashbi_hours_available', 6.0 );
        update_option( 'ashbi_hours_used_this_month', 0.0 );

        Ashbi_Hours::maybe_cycle_month();

        $this->assertSame( 6.0, (float) get_option( 'ashbi_hours_available' ) );
    }

    public function test_use_hours_deducts_from_available(): void {
        $this->setClock( '2026-07-10' );
        $this->setCycleStart( '2026-07-01' );
        update_option( 'ashbi_tier', 'professional' );
        update_option( 'ashbi_hours_available', 2.0 );
        update_option( 'ashbi_hours_used_this_month', 0.0 );

        $result = Ashbi_Hours::use_hours( 1.5, 'CSS tweaks' );

        $this->assertTrue( $result['success'] );
        $this->assertSame( 0.5, (float) $result['remaining'] );
        $this->assertSame( 1.5, (float) get_option( 'ashbi_hours_used_this_month' ) );
    }

    public function test_use_hours_over_available_returns_error(): void {
        $this->setClock( '2026-07-10' );
        $this->setCycleStart( '2026-07-01' );
        update_option( 'ashbi_tier', 'basic' );
        update_option( 'ashbi_hours_available', 0.0 );
        update_option( 'ashbi_hours_used_this_month', 0.0 );

        $result = Ashbi_Hours::use_hours( 0.5, 'Anything' );

        $this->assertFalse( $result['success'] );
        $this->assertStringContainsString( 'exceeds', strtolower( $result['message'] ) );
    }

    public function test_use_hours_zero_or_negative_rejected(): void {
        $this->setClock( '2026-07-10' );
        update_option( 'ashbi_tier', 'professional' );
        update_option( 'ashbi_hours_available', 5.0 );

        $result = Ashbi_Hours::use_hours( 0, 'Nothing' );
        $this->assertFalse( $result['success'] );
        $this->assertStringContainsString( 'invalid', strtolower( $result['message'] ) );

        $result = Ashbi_Hours::use_hours( -1, 'Negative' );
        $this->assertFalse( $result['success'] );
    }

    public function test_tier_constants_match_documented_values(): void {
        $this->assertSame( 0.0, Ashbi_Hours::TIERS['basic']['included'] );
        $this->assertSame( 0.0, Ashbi_Hours::TIERS['basic']['max_banked'] );
        $this->assertSame( 1.0, Ashbi_Hours::TIERS['professional']['included'] );
        $this->assertSame( 3.0, Ashbi_Hours::TIERS['professional']['max_banked'] );
        $this->assertSame( 4.0, Ashbi_Hours::TIERS['agency']['included'] );
        $this->assertSame( 6.0, Ashbi_Hours::TIERS['agency']['max_banked'] );
    }

    public function test_default_tier_is_professional(): void {
        $this->assertSame( 'professional', Ashbi_Hours::tier()['tier'] );
    }
}