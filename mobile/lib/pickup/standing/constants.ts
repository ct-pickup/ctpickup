/** Rolling window for automatic standing signals (no-shows, late cancels, payment rows). */
export const PICKUP_STANDING_LOOKBACK_DAYS = 90;

/** No-show incidents in the lookback window → automatic warning. */
export const PICKUP_STANDING_WARN_NO_SHOWS = 2;

/** No-show incidents in the lookback window → automatic suspension. */
export const PICKUP_STANDING_SUSPEND_NO_SHOWS = 5;

/** Late-cancel incidents in the lookback window → automatic warning. */
export const PICKUP_STANDING_WARN_LATE_CANCELS = 1;

/** Failed / unfulfilled pickup payment rows in the lookback window → warning from this count. */
export const PICKUP_STANDING_WARN_PAYMENT_ISSUES = 1;

/** Same as above but escalates to automatic suspension. */
export const PICKUP_STANDING_SUSPEND_PAYMENT_ISSUES = 4;
