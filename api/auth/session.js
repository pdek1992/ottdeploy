import { supabase } from '../../src/lib/supabase.js';
import cookie from 'cookie';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cookies = cookie.parse(req.headers.cookie || '');
  const sessionToken = cookies.ott_session;

  if (!sessionToken) {
    return res.status(401).json({ error: 'Not authenticated' });
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
    return res.status(401).json({ error: 'Invalid session' });
  }

  // Update last seen (optional, you might want to debounce this)
  await supabase
    .from('user_sessions')
    .update({ last_seen_at: now })
    .eq('id', session.id);

  return res.status(200).json({ user: session.access_users });
}
