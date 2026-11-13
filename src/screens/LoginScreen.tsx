import { useState } from 'react';
import { LogIn, Loader2 } from 'lucide-react';
import { getSupabase } from '../data/supabase';
import { Button, Card, inputCls } from '../components/ui';
import { Logo } from '../components/Logo';

export function LoginScreen({ notice }: { notice?: string | null }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { error } = await getSupabase()!.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setErr(navigator.onLine ? error.message : 'You are offline. Connect to the internet to sign in the first time.');
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
        <form onSubmit={submit} className="space-y-3">
          <input className={inputCls} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
          <input className={inputCls} type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          {err && <p className="text-sm text-red-600" role="alert">{err}</p>}
          <Button type="submit" className="w-full" disabled={busy}>{busy ? <Loader2 className="animate-spin" size={18} /> : <LogIn size={18} />} Sign in</Button>
        </form>
        <p className="text-xs text-slate-400 mt-4 text-center">Accounts are created by the administrator in Supabase.</p>
      </Card>
    </div>
  );
}
