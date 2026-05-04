import { supabase } from '../../src/lib/supabase.js';
import cookie from 'cookie';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { slug } = req.query;
  const cookies = cookie.parse(req.headers.cookie || '');
  const sessionToken = cookies.ott_session;

  if (!sessionToken) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');

  try {
    // 1. Verify session
    const { data: session, error: sessionError } = await supabase
      .from('user_sessions')
      .select('access_user_id')
      .eq('session_token_hash', tokenHash)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (sessionError || !session) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    // 2. Resolve video ID from slug
    const { data: video, error: videoError } = await supabase
      .from('catalog_videos')
      .select('id')
      .eq('slug', slug)
      .single();

    if (videoError || !video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // 3. Get license key
    const { data: license, error: licenseError } = await supabase
      .from('video_keys')
      .select('key_id_hex, key_hex')
      .eq('video_id', video.id)
      .eq('is_active', true)
      .single();

    if (licenseError || !license) {
      // If no license found, maybe it is a free/unencrypted stream
      return res.status(204).end();
    }

    // Return only the keys needed
    return res.status(200).json({
      keys: [
        {
          kid: license.key_id_hex,
          k: license.key_hex
        }
      ]
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
