import { supabase } from './supabase.js';
import cookie from 'cookie';
import crypto from 'crypto';

export async function verifySession(req) {
  const cookies = cookie.parse(req.headers.cookie || '');
  const sessionToken = cookies.ott_session;

  if (!sessionToken) {
    return null;
  }

  const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
  const now = new Date().toISOString();

  const { data: session, error } = await supabase
    .from('user_sessions')
    .select('*, access_users(*)')
    .eq('session_token_hash', tokenHash)
    .is('revoked_at', null)
    .gt('expires_at', now)
    .single();

  if (error || !session) {
    return null;
  }

  return session.access_users;
}
