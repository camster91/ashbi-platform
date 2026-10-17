import { useCallback, useEffect, useRef, useState } from 'react';
import { setReauthHandler } from '../lib/api';

/** Register immediately; fetch the sensitive-action dialog only when needed. */
export function ReauthProvider({ children }) {
  const [Dialog, setDialog] = useState(null);
  const pending = useRef(null);

  const settle = useCallback((result) => {
    const request = pending.current;
    pending.current = null;
    setDialog(null);
    request?.resolve(result);
  }, []);

  useEffect(() => {
    let active = true;
    setReauthHandler(() => {
      if (!active) return Promise.resolve(false);
      if (pending.current) return pending.current.promise;
      const request = {};
      request.promise = new Promise((resolve) => { request.resolve = resolve; });
      pending.current = request;
      import('./ReauthDialog')
        .then((module) => {
          if (pending.current === request) setDialog(() => module.default);
        })
        .catch(() => {
          // Fail closed: a missing dialog chunk must never authorize a retry.
          if (pending.current === request) settle(false);
        });
      return request.promise;
    });
    return () => {
      active = false;
      setReauthHandler(null);
      pending.current?.resolve(false);
      pending.current = null;
    };
  }, [settle]);

  return (
    <>
      {children}
      {Dialog && <Dialog isOpen onSuccess={() => settle(true)} onCancel={() => settle(false)} />}
    </>
  );
}
