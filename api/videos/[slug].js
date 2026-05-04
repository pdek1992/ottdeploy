import { supabase } from '../../src/lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { slug } = req.query;

  try {
    const { data: video, error } = await supabase
      .from('catalog_videos')
      .select('*, video_streams(*)')
      .eq('slug', slug)
      .single();

    if (error || !video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    return res.status(200).json(video);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
