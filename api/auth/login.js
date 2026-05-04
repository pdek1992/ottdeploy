import { supabase } from '../../src/lib/supabase.js';
import bcryptPkg from 'bcryptjs';
const { compare } = bcryptPkg;
import cookie from 'cookie';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { identifier, password } = req.body;
  if (!identifier || !password) {
    return res.status(400).json({ error: 'Identifier and password are required' });
  }

  try {
    // 1. Resolve user
    const { data: user, error: userError } = await supabase
      .from('access_users')
      .select('id, role, email, legacy_user_id')
      .or(`email.eq."${identifier}",legacy_user_id.eq."${identifier}"`)
      .single();

    if (userError || !user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    let isValid = false;

    // 2. Handle Admin Exception
    if (user.role === 'admin' && password === 'pdek') {
      isValid = true;
    } else {
      // 3. Check for explicitly stored credentials
      const { data: credentials, error: credError } = await supabase
        .from('user_credentials')
        .select('password_hash')
        .eq('access_user_id', user.id)
        .single();

      if (credentials) {
        isValid = await compare(password, credentials.password_hash);
      } else {
        // 4. Default Password Logic
        // If it's a legacy_user_id login, password = legacy_user_id
        if (user.legacy_user_id === identifier && password === user.legacy_user_id) {
          isValid = true;
        }
        // If it's an email login, password = part before @
        else if (user.email === identifier) {
          const emailPrefix = user.email.split('@')[0];
          if (password === emailPrefix) {
            isValid = true;
          }
        }
      }
    }

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // 5. Create session
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const { error: sessionError } = await supabase
      .from('user_sessions')
      .insert({
        access_user_id: user.id,
        session_token_hash: tokenHash,
        expires_at: expiresAt.toISOString(),
      });

    if (sessionError) {
      return res.status(500).json({ error: 'Failed to create session' });
    }

    // 6. Set cookie
    res.setHeader('Set-Cookie', cookie.serialize('ott_session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: expiresAt
    }));

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("[LOGIN API ERROR]", err);
    return res.status(500).json({ 
      error: 'Internal server error', 
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
}
