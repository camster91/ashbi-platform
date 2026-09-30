// Organization MFA requirement (docs/privileged-actions.md, "Organization MFA
// requirement"). While a staff member's organization requires two-factor
// authentication and they have not set it up, the API answers every request
// except enrollment, /auth/me and sign-out with
// 403 { code: "MFA_ENROLLMENT_REQUIRED" }. The API layer announces that with a
// window event; AuthProvider marks the user and MfaEnrollmentGate routes them
// to the setup page.

export const MFA_ENROLLMENT_REQUIRED = 'MFA_ENROLLMENT_REQUIRED';
export const MFA_ENROLLMENT_REQUIRED_EVENT = 'api:mfa-enrollment-required';
export const MFA_ENROLLMENT_PATH = '/security/two-factor-setup';

export function announceMfaEnrollmentRequired() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(MFA_ENROLLMENT_REQUIRED_EVENT));
}
