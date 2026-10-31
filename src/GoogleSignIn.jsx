import React, {useEffect, useState} from 'react';
import {supabase} from './supabase';

export function GoogleSignIn({onError}) {
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/auth/v1/settings`, {
      headers: {apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY},
      signal: controller.signal,
    }).then(r => r.ok ? r.json() : null)
      .then(settings => setAvailable(settings?.external?.google === true))
      .catch(() => {});
    return () => controller.abort();
  }, []);
  if (!available) return null;
  return <><button type="button" className="full google-signin" disabled={busy} onClick={async () => {
    setBusy(true);
    onError('');
    try {
      const {error} = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {redirectTo: window.location.origin + window.location.pathname},
      });
      if (error) throw error;
    } catch (error) {
      onError(error.message);
      setBusy(false);
    }
  }}><span aria-hidden="true" style={{fontWeight:700,fontSize:18,color:'#4285f4'}}>G</span>{busy ? 'Opening Google…' : 'Continue with Google'}</button><p className="auth-divider">or use email and password</p></>;
}
