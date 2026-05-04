import { supabase } from '../../src/lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { data: rails, error: railError } = await supabase
      .from('catalog_rails')
      .select(`
        *,
        catalog_rail_items(
          video_id,
          sort_order,
          catalog_videos(slug)
        )
      `)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (railError) {
      console.error('Rail Error:', railError);
      return res.status(500).json({ error: 'Failed to fetch rails' });
    }

    // Transform and sort items within each rail
    const transformedRails = rails.map(rail => {
      // Sort items by their own sort_order
      const sortedItems = rail.catalog_rail_items
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
        .map(item => item.catalog_videos.slug);

      return {
        title: rail.title,
        items: sortedItems
      };
    });

    return res.status(200).json(transformedRails);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
