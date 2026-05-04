import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

/**
 * sync_mpd_mapping.js
 * 
 * Reads local mpd_mapping.json and pushes entries to the Vercel Sync API.
 */

const VERCEL_URL = process.env.VERCEL_URL || 'http://localhost:3000';
const ADMIN_TOKEN = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MAPPING_FILE = path.join(process.cwd(), 'keys', 'mpd_mapping.json');

async function sync() {
  if (!fs.existsSync(MAPPING_FILE)) {
    console.error(`Mapping file not found: ${MAPPING_FILE}`);
    return;
  }

  const mapping = JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf8'));
  console.log(`Syncing ${Object.keys(mapping).length} entries...`);

  for (const [slug, manifestUrl] of Object.entries(mapping)) {
    console.log(`Syncing ${slug}...`);
    
    // Construct payload
    // We assume video exists or will be created with default title
    const payload = {
      video: {
        slug: slug,
        title: slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      },
      streams: [
        {
          manifest_url: manifestUrl,
          is_primary: true
        }
      ],
      // Optional: default rail assignment if needed
      rails: [
        { rail_slug: 'all-videos', rail_title: 'All Videos', sort_order: 100 }
      ]
    };

    try {
      const res = await fetch(`${VERCEL_URL}/api/admin/sync-video`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ADMIN_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.json();
        console.error(`Failed to sync ${slug}:`, err.error);
      } else {
        console.log(`Successfully synced ${slug}`);
      }
    } catch (err) {
      console.error(`Network error for ${slug}:`, err.message);
    }
  }
}

sync();
