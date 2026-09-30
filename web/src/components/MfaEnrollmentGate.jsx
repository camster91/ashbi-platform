import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { MFA_ENROLLMENT_PATH } from '../lib/mfa-enrollment';

/**
 * Organization MFA requirement: a signed-in staff member who must set up
 * two-factor authentication sees only the setup page. The API enforces this
 * too (403 MFA_ENROLLMENT_REQUIRED); this keeps the app from rendering screens
 * whose every request would be refused.
 */
export default function MfaEnrollmentGate({ children }) {
  const { user } = useAuth();
  const location = useLocation();
  if (user?.mfaEnrollmentRequired && location.pathname !== MFA_ENROLLMENT_PATH) {
    return <Navigate to={MFA_ENROLLMENT_PATH} replace />;
  }
  return children;
}
