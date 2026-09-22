import React, { useEffect, useRef, useState } from 'react';

// Same value as the server's GOOGLE_CLIENT_ID, baked into the build. When it's
// empty (or missing) only email/password sign-in is shown.
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

// "Continue with Google" button rendered by Google Identity Services (GIS). It
// loads the gsi/client script on demand and hands the verified credential (a
// JWT id_token) to the parent via onSuccess(credential).
export default function GoogleSignIn({ onSuccess, disabled = false }) {
  const btnRef = useRef(null);
  const cbRef = useRef(onSuccess);
  cbRef.current = onSuccess;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!CLIENT_ID) return;
    let cancelled = false;

    function init() {
      if (cancelled || !window.google?.accounts?.id) return;
      window.google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: (resp) => {
          if (resp?.credential) cbRef.current?.(resp.credential);
        },
      });
      setReady(true);
    }

    if (window.google?.accounts?.id) {
      init();
    } else {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = init;
      s.onerror = () => setError('Could not load Google sign-in.');
      document.head.appendChild(s);
    }
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (ready && btnRef.current) {
      try {
        window.google.accounts.id.renderButton(btnRef.current, {
          theme: 'outline',
          size: 'large',
          shape: 'rectangular',
          text: 'continue_with',
          width: 300,
        });
      } catch {
        setError('Could not render Google sign-in.');
      }
    }
  }, [ready]);

  if (!CLIENT_ID) {
    return <p className="google-hint">Google sign-in appears once VITE_GOOGLE_CLIENT_ID is set.</p>;
  }

  return (
    <div className={`auth-google${disabled ? ' is-disabled' : ''}`}>
      <div ref={btnRef} />
      {error && <p className="auth-error">{error}</p>}
    </div>
  );
}
