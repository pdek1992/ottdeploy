import { supabase } from '../../src/lib/supabase.js';
import cookie from 'cookie';
import crypto from 'crypto';

export default async function handler(req, res) {
  const cookies = cookie.parse(req.headers.cookie || '');
  const sessionToken = cookies.ott_session;

  if (sessionToken) {
    const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
    await supabase
      .from('user_sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('session_token_hash', tokenHash);
  }

  res.setHeader('Set-Cookie', cookie.serialize('ott_session', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: new Date(0)
  }));

  return res.status(200).json({ success: true });
}
