import { supabase } from '../../src/lib/supabase.js';
import { verifySession } from '../../src/lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await verifySession(req);
    if (!user || user.role !== 'admin') {
      return res.status(401).json({ error: 'Unauthorized: Admin access required' });
    }

    // Fetch latest 10 CDN metric runs
    const { data: metrics, error } = await supabase
      .from('cdn_metrics_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(10);

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch dashboard data' });
    }

    // Also get active user count
    const { count: userCount, error: userError } = await supabase
      .from('access_users')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active');

    return res.status(200).json({
      latestMetrics: metrics,
      activeUsers: userCount || 0,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
