import { supabase } from '../../src/lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify secret
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { video, streams, keys, rails } = req.body;

  try {
    // 1. Upsert video metadata (includes thumbnails)
    const { data: videoRow, error: videoError } = await supabase
      .from('catalog_videos')
      .upsert(video, { onConflict: 'slug' })
      .select('id')
      .single();

    if (videoError) throw videoError;

    // 2. Upsert streams
    if (streams && streams.length > 0) {
      const streamsToInsert = streams.map(s => ({ ...s, video_id: videoRow.id }));
      const { error: streamError } = await supabase
        .from('video_streams')
        .upsert(streamsToInsert, { onConflict: 'video_id, is_primary' });
      if (streamError) throw streamError;
    }

    // 3. Upsert keys
    if (keys && keys.length > 0) {
      const keysToInsert = keys.map(k => ({ ...k, video_id: videoRow.id }));
      const { error: keyError } = await supabase
        .from('video_keys')
        .upsert(keysToInsert, { onConflict: 'video_id, key_version' });
      if (keyError) throw keyError;
    }

    // 4. Upsert Rail Assignments
    if (rails && rails.length > 0) {
      for (const r of rails) {
        // Ensure rail exists or get its ID
        const { data: railRow, error: railFetchError } = await supabase
          .from('catalog_rails')
          .select('id')
          .eq('slug', r.rail_slug)
          .single();

        let railId;
        if (railFetchError || !railRow) {
          // Auto-create rail if it doesn't exist
          const { data: newRail, error: railCreateError } = await supabase
            .from('catalog_rails')
            .insert({ slug: r.rail_slug, title: r.rail_title || r.rail_slug })
            .select('id')
            .single();
          if (railCreateError) throw railCreateError;
          railId = newRail.id;
        } else {
          railId = railRow.id;
        }

        // Assign video to rail
        const { error: assignError } = await supabase
          .from('catalog_rail_items')
          .upsert({
            rail_id: railId,
            video_id: videoRow.id,
            sort_order: r.sort_order || 0
          }, { onConflict: 'rail_id, video_id' });
        
        if (assignError) throw assignError;
      }
    }

    return res.status(200).json({ success: true, id: videoRow.id });
  } catch (err) {
    console.error('Sync Error:', err);
    return res.status(500).json({ error: err.message });
  }
}
