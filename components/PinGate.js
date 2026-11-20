'use client';

import { useState } from 'react';

export default function PinGate({ onSubmit, error, busy }) {
  const [pin, setPin] = useState('');

  function submit(e) {
    e.preventDefault();
    if (pin.trim() && !busy) onSubmit(pin.trim());
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-6 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon-192.png" alt="AureusDesk AI" width="64" height="64" className="mx-auto h-16 w-16 rounded-xl" />
        <div>
          <h1 className="text-lg font-extrabold tracking-tight">
            AureusDesk <span className="text-gold">AI</span>
          </h1>
          <p className="mt-1 text-xs text-muted">Masukkan PIN untuk membuka aplikasi.</p>
        </div>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          autoFocus
          className="input text-center font-mono text-xl tracking-[0.4em]"
          placeholder="••••••"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          aria-label="PIN"
        />
        {error ? <p className="text-xs text-down" role="alert">{error}</p> : null}
        <button type="submit" className="btn btn-gold w-full" disabled={busy || !pin.trim()}>
          {busy ? 'Memeriksa...' : '🔓 Buka'}
        </button>
        <p className="text-[11px] text-muted">PIN disimpan di browser ini, jadi cukup diisi sekali.</p>
      </form>
    </div>
  );
}
