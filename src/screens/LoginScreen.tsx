import { useState } from 'react';
import { LogIn, Loader2 } from 'lucide-react';
import { getSupabase } from '../data/supabase';
import { Button, Card, inputCls } from '../components/ui';
import { Logo } from '../components/Logo';

export function LoginScreen({ notice, onSignOut }: { notice?: string | null; onSignOut?: () => Promise<void> }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [info, setInfo] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setInfo(null);
    const sb = getSupabase()!;
    const creds = { email: email.trim(), password };
    const { data, error } = mode === 'signin'
      ? await sb.auth.signInWithPassword(creds)
      : await sb.auth.signUp({ ...creds, options: { emailRedirectTo: window.location.origin + window.location.pathname } });
    if (error) setErr(navigator.onLine ? error.message : 'You are offline. Connect to the internet to sign in the first time.');
    else if (mode === 'signup' && !data.session) setInfo('Check your email to confirm the account, then sign in. The admin will approve your access.');
    setBusy(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50 dark:bg-slate-950">
      <Card className="w-full max-w-sm p-6">
        <div className="flex flex-col items-center mb-6">
          <Logo className="w-16 h-16 mb-3" />
          <h1 className="text-xl font-bold">Container Stock Tracker</h1>
          <p className="text-sm text-slate-500">Sign in to continue</p>
        </div>
        {notice && <p className="text-sm text-amber-700 bg-amber-50 rounded-xl p-3 mb-4 whitespace-pre-line">{notice}</p>}
        {notice && onSignOut ? (
          <Button variant="secondary" className="w-full" onClick={() => void onSignOut()}>Use a different account</Button>
        ) : (
        <>
        <form onSubmit={submit} className="space-y-3">
          <input className={inputCls} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
          <input className={inputCls} type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} minLength={8} required />
          {err && <p className="text-sm text-red-600" role="alert">{err}</p>}
          {info && <p className="text-sm text-green-700" role="status">{info}</p>}
          <Button type="submit" className="w-full" disabled={busy}>{busy ? <Loader2 className="animate-spin" size={18} /> : <LogIn size={18} />} {mode === 'signin' ? 'Sign in' : 'Request access'}</Button>
        </form>
        <button type="button" className="text-sm text-brand-600 mt-4 w-full text-center" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setErr(null); setInfo(null); }}>
          {mode === 'signin' ? 'New here? Request access' : 'Already have an account? Sign in'}
        </button>
        </>
        )}
      </Card>
    </div>
  );
}
