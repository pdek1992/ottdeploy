const fs = require('fs');
const path = require('path');

const configPath = 'd:/Desktop Folders/Android app/OTT/versel/source_snapshot/public_app/config.js';
const mpdPath = 'd:/Desktop Folders/Android app/OTT/versel/source_snapshot/public_app/keys/mpd_mapping.json';
const keysPath = 'd:/Desktop Folders/Android app/OTT/versel/source_snapshot/public_app/keys/keys.json';
const descPath = 'd:/Desktop Folders/Android app/OTT/versel/source_snapshot/public_app/keys/description.json';

// Extract config
let OTT_CONFIG = {};
const configContent = fs.readFileSync(configPath, 'utf8');
const evalString = configContent.replace('window.OTT_CONFIG = ', 'OTT_CONFIG = ') + '; return OTT_CONFIG;';
const config = new Function('OTT_CONFIG', evalString)(OTT_CONFIG);

const mpdMapping = JSON.parse(fs.readFileSync(mpdPath, 'utf8'));
const keys = JSON.parse(fs.readFileSync(keysPath, 'utf8'));
const descriptions = JSON.parse(fs.readFileSync(descPath, 'utf8'));

// Build a master list of videos from both config and descriptions
const allVideos = {};

// Start with staticVideos from config
config.staticVideos.forEach(v => {
    allVideos[v.id] = {
        slug: v.id,
        title: v.title,
        description: v.description,
        category: v.category,
        year: v.year,
        duration: v.duration,
        thumbnail: v.thumbnail
    };
});

// Layer descriptions on top (contains missing videos)
Object.entries(descriptions).forEach(([slug, d]) => {
    if (!allVideos[slug]) {
        allVideos[slug] = {
            slug: slug,
            title: d.title,
            description: d.description,
            category: d.category || 'Nature',
            year: d.year || '2026',
            duration: d.duration || 'Preview',
            thumbnail: d.thumbnail || `./assets/thumbnails/${slug}.jpg`
        };
    }
});

let sql = '';

// 3. Catalog Videos
sql += '-- 3. Insert Catalog Videos\n';
sql += 'INSERT INTO public.catalog_videos (id, slug, title, description, category, year_label, duration_label, thumbnail_url, playable) VALUES\n';
const videoValues = Object.values(allVideos).map(v => {
    return `(gen_random_uuid(), '${v.slug}', '${v.title.replace(/'/g, "''")}', '${v.description.replace(/'/g, "''")}', '${v.category}', '${v.year}', '${v.duration}', '${v.thumbnail}', true)`;
});
sql += videoValues.join(',\n') + '\non conflict (slug) do nothing;\n\n';

// 4. Video Streams
sql += '-- 4. Insert Video Streams (Mapping MPD)\n';
sql += 'INSERT INTO public.video_streams (video_id, origin_type, manifest_url) VALUES\n';
const streamValues = [];
Object.entries(mpdMapping).forEach(([slug, url]) => {
    if (allVideos[slug]) {
        streamValues.push(`((SELECT id FROM public.catalog_videos WHERE slug = '${slug}'), 'cdn', '${url}')`);
    }
});
sql += streamValues.join(',\n') + '\non conflict do nothing;\n\n';

// 5. Rails
sql += '-- 5. Insert Rails\n';
sql += 'INSERT INTO public.catalog_rails (slug, title, sort_order, is_active) VALUES\n';
const railValues = config.rails.map((r, i) => {
    const slug = r.title.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/^-+|-+$/g, '');
    return `('${slug}', '${r.title}', ${i + 1}, true)`;
});
sql += railValues.join(',\n') + '\non conflict (slug) do nothing;\n\n';

// 6. Rail Items
sql += '-- 6. Insert Rail Items\n';
sql += 'INSERT INTO public.catalog_rail_items (rail_id, video_id, sort_order) VALUES\n';
const railItems = [];
config.rails.forEach(r => {
    const railSlug = r.title.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/^-+|-+$/g, '');
    r.items.forEach((videoSlug, index) => {
        if (allVideos[videoSlug]) {
            railItems.push(`((SELECT id FROM public.catalog_rails WHERE slug = '${railSlug}'), (SELECT id FROM public.catalog_videos WHERE slug = '${videoSlug}'), ${index + 1})`);
        }
    });
});
sql += railItems.join(',\n') + '\non conflict do nothing;\n\n';

// 7. Video Keys
sql += '-- 7. Insert Video Keys (Private)\n';
sql += 'INSERT INTO private.video_keys (video_id, key_id_hex, key_hex) VALUES\n';
const keyValues = [];
Object.entries(keys).forEach(([slug, k]) => {
    if (allVideos[slug]) {
        keyValues.push(`((SELECT id FROM public.catalog_videos WHERE slug = '${slug}'), '${k.key_id}', '${k.key}')`);
    }
});
sql += keyValues.join(',\n') + '\non conflict do nothing;\n\n';

fs.writeFileSync('generated_sql.txt', sql);
console.log('SQL generated in generated_sql.txt');
