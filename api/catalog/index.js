import { supabase } from '../../src/lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { data: videos, error: videoError } = await supabase
      .from('catalog_videos')
      .select(`
        *,
        video_streams (
          manifest_url,
          thumbnail_url,
          is_primary
        )
      `)
      .eq('playable', true)
      .order('created_at', { ascending: false });

    if (videoError) {
      console.error('Catalog Error:', videoError);
      return res.status(500).json({ error: 'Failed to fetch catalog' });
    }

    // Normalize: use slug as the canonical id so the frontend never sees UUIDs
    const normalized = videos.map(v => {
      // Prefer the primary stream, fall back to first
      const stream = v.video_streams?.find(s => s.is_primary) || v.video_streams?.[0];
      return {
        ...v,
        // Override the UUID 'id' with the slug so UI renders descriptive names
        id: v.slug,
        // Flatten the first stream URL to a top-level field the player expects
        mpdUrl: stream?.manifest_url || `https://ott.prashantkadam.in/${v.slug}/manifest.mpd`,
        thumbnail: stream?.thumbnail_url || v.thumbnail || `https://ott.prashantkadam.in/${v.slug}/thumbnail.jpeg`,
      };
    });

    return res.status(200).json(normalized);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
