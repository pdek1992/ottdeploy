import { supabase } from '../../src/lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { data: videos, error: videoError } = await supabase
      .from('catalog_videos')
      .select('*')
      .eq('playable', true);

    if (videoError) {
      return res.status(500).json({ error: 'Failed to fetch catalog' });
    }

    // Return in a shape similar to staticVideos in config.js
    return res.status(200).json(videos);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
