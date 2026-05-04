# Deployment Guide: Vercel + Supabase Migration

## 1. Prerequisites
- [Vercel](https://vercel.com/) account
- [Supabase](https://supabase.com/) account
- Cloudflare account (for CDN)
- GitHub repository with this codebase

## 2. Supabase Setup
1. Create a new project in Supabase.
2. Go to **SQL Editor** and run the schema from `supabase/migrations/001_initial_schema.sql`.
3. Run the **Data Import SQL** (provided below) to populate your catalog and users.

### Data Import SQL
Copy and paste this into the Supabase SQL Editor:

```sql
-- 0. Ensure Schemas and Tables Exist
create schema if not exists private;

create table if not exists private.video_keys (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.catalog_videos(id) on delete cascade,
  key_id_hex text not null,
  key_hex text not null,
  key_version integer not null default 1,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  unique (video_id, key_version)
);

-- 1. Insert Initial Users
insert into public.access_users (email, display_name, role, subscription_tier)
values 
  ('pdek1991@gmail.com', 'PDEK 1991', 'viewer', 'premium'),
  ('pdek1992@gmail.com', 'PDEK 1992', 'viewer', 'premium')
on conflict (email) do nothing;

insert into public.access_users 
(legacy_user_id, display_name, role, subscription_tier, can_view_dashboard)
values 
  ('pdek1991', 'pdek1991', 'admin', 'premium', true),
  ('admin', 'admin', 'admin', 'premium', true),
  ('adminuser', 'adminuser', 'admin', 'premium', true),
  ('pdek1992', 'pdek1992', 'viewer', 'standard', false),
  ('jerry', 'jerry', 'viewer', 'standard', false),
  ('shankar', 'shankar', 'viewer', 'standard', false),
  ('sangram', 'sangram', 'viewer', 'standard', false),
  ('abhijeet', 'abhijeet', 'viewer', 'standard', false),
  ('avanish', 'avanish', 'viewer', 'standard', false),
  ('prakash', 'prakash', 'viewer', 'standard', false),
  ('prince', 'prince', 'viewer', 'standard', false),
  ('paresh', 'paresh', 'viewer', 'standard', false),
  ('akshay', 'akshay', 'viewer', 'standard', false),
  ('ameet', 'ameet', 'viewer', 'standard', false)
on conflict (legacy_user_id) do nothing;

-- 2. Insert App Settings
INSERT INTO public.app_settings (key, value, is_public) VALUES 
('featuredVideoId', '"angel_one"'::jsonb, true),
('adCuePoints', '[30, 90]'::jsonb, true)
on conflict (key) do nothing;

-- 3. Insert Catalog Videos
INSERT INTO public.catalog_videos (id, slug, title, description, category, year_label, duration_label, thumbnail_url, playable) VALUES
(gen_random_uuid(), 'free', 'Free Preview', 'Start watching instantly with a smooth premium playback experience.', 'Featured', '2026', '2m', './assets/thumbnails/free.jpg', true),
(gen_random_uuid(), 'output_2min', 'Quick Preview', 'A short title for a fast watch.', 'Featured', '2026', '2m', './assets/thumbnails/output_2min.jpg', true),
(gen_random_uuid(), 'output_02_04', 'Weekend Special', 'A featured pick ready for streaming.', 'Featured', '2026', 'Preview', './assets/thumbnails/output_02_04.jpg', true),
(gen_random_uuid(), 'withlogo', 'Studio Preview', 'A polished sample from the VigilSiddhi OTT collection.', 'Featured', '2026', 'Preview', './assets/thumbnails/withlogo.jpg', true),
(gen_random_uuid(), 'angel_one', 'Angel One', 'A celestial sci-fi adventure with stunning ABR-adaptive streaming. Shaka Player official demo asset.', 'Sci-Fi', '2016', '4m', './assets/thumbnails/angel_one.png', true),
(gen_random_uuid(), 'tears_of_steel', 'Tears of Steel', 'Robots invade Amsterdam in this stunning sci-fi short from the Blender Foundation.', 'Sci-Fi', '2012', '12m', './assets/thumbnails/tears_of_steel.jpg', true),
(gen_random_uuid(), 'heliocentrism', 'Heliocentrism', 'An immersive space documentary journey through our solar system. Multi-bitrate adaptive streaming.', 'Documentary', '2017', '3m', './assets/thumbnails/heliocentrism.jpg', true),
(gen_random_uuid(), 'big_buck_bunny', 'Big Buck Bunny', 'A giant rabbit vs. three mischievous rodents. A timeless Blender Foundation classic.', 'Animation', '2008', '9m 56s', './assets/thumbnails/big_buck_bunny.jpg', true),
(gen_random_uuid(), 'bbb_dark_truths', 'Big Buck Bunny — Dark Truths', 'A darker, cinematic reimagining of the animated classic. Shaka demo with full ABR.', 'Animation', '2012', '10m', './assets/thumbnails/bbb_dark_truths.jpg', true),
(gen_random_uuid(), 'sintel', 'Sintel', 'Fantasy epic — a lone heroine searches for her lost dragon across dangerous lands.', 'Animation', '2010', '14m 48s', './assets/thumbnails/sintel.png', true),
(gen_random_uuid(), 'elephant_dream', 'Elephant''s Dream', 'The world''s first open movie — a surrealist journey through impossible mechanical worlds.', 'Animation', '2006', '10m 54s', './assets/thumbnails/elephant_dream.png', true),
(gen_random_uuid(), 'cosmos_laundromat', 'Cosmos Laundromat', 'A sheep meets a mysterious stranger who grants infinite lives. Award-winning Blender open short.', 'Animation', '2015', '12m 10s', './assets/thumbnails/cosmos_laundromat.jpg', true),
(gen_random_uuid(), 'tmkoc', 'Taarak Mehta Ka Ooltah Chashmah', 'A light-hearted sitcom set in the Gokuldham Society. Humor and wit in every episode.', 'Comedy', '2008', '22m', './assets/thumbnails/tmkoc.jpg', true),
(gen_random_uuid(), 'blackmail', 'Blackmail', 'Starring Irrfan Khan, Kirti Kulhari, Divya Dutta. A dark comedy thriller.', 'Comedy', '2018', '1h 54m', './assets/thumbnails/blackmail.jpg', true),
(gen_random_uuid(), 'asiacup', 'Asia Cup Finals', 'India vs Pakistan — edge-of-your-seat cricket action from a packed stadium.', 'Sports', '2026', '2h 15m', './assets/thumbnails/asiacup.jpg', true),
(gen_random_uuid(), 'dash_if_livesim', 'DASH-IF LiveSim', 'Industry-standard reference live stream with high-frequency chunking. Perfect for low-latency player verification.', 'Reference Streams', '2024', 'LIVE', './assets/thumbnails/dash_if_livesim.jpg', true),
(gen_random_uuid(), 'multirate_dash', 'Qualcomm MultiRate', 'Official Qualcomm multi-rate patched reference stream for verifying ABR logic and seamless bitrate transitions.', 'Reference Streams', '2023', 'ABR', './assets/thumbnails/multirate_dash.jpg', true),
(gen_random_uuid(), 'hd_multireso', 'Qualcomm HD Reference', 'High-definition multi-resolution reference content for testing multi-view and high-resolution player stability.', 'Reference Streams', '2023', 'HD', './assets/thumbnails/hd_multireso.png', true),
(gen_random_uuid(), 'bitmovin_demo', 'Bitmovin Gold Standard', 'The global benchmark for premium adaptive video delivery — ensuring high-fidelity playback across all network conditions.', 'Reference Streams', '2023', 'Feature', './assets/thumbnails/bitmovin_demo.jpg', true),
(gen_random_uuid(), 'bbb_itec', 'Big Buck Bunny (ITEC)', 'Academic standard ITEC dataset for advanced adaptive bitrate streaming experiments and data-layer analysis.', 'Animation', '2014', '10m', './assets/thumbnails/bbb_itec.jpg', true),
(gen_random_uuid(), 'qualcomm_multirate', 'Qualcomm MultiRate', 'Multi-rate patched reference DASH stream for ABR verification.', 'Reference', '2023', 'Feature', 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=640&q=80', true),
(gen_random_uuid(), 'qualcomm_hd', 'Qualcomm HD', 'High-definition multi-resolution reference content.', 'Reference', '2023', 'HD', 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=640&q=80', true),
(gen_random_uuid(), 'bitmovin_sample', 'Bitmovin Gold', 'The industry benchmark for premium ABR streaming performance.', 'Reference', '2023', 'Reference', 'https://images.unsplash.com/photo-1607799279861-4dd421887fb3?w=640&q=80', true),
(gen_random_uuid(), 'countryside_meadow', 'Countryside Meadow', 'Breathtaking aerial view of a lush green meadow bathed in sunlight.', 'Nature', '2026', 'Preview', 'https://ott.prashantkadam.in/countryside_meadow/thumbnail.png', true),
(gen_random_uuid(), 'forest_waterfall', 'Forest Waterfall', 'A hidden waterfall cascading through a dense green forest.', 'Nature', '2026', 'Preview', 'https://ott.prashantkadam.in/forest_waterfall/thumbnail.png', true),
(gen_random_uuid(), 'mountain_highway', 'Mountain Highway', 'Cruise down a winding mountain highway through dramatic peaks.', 'Travel', '2026', 'Preview', 'https://ott.prashantkadam.in/mountain_highway/thumbnail.png', true),
(gen_random_uuid(), 'pexels_cityscape', 'Cityscape Aerial', 'Sweeping aerial footage over a modern cityscape at golden hour.', 'Cinematic', '2026', 'Preview', 'https://ott.prashantkadam.in/pexels_cityscape/thumbnail.png', true),
(gen_random_uuid(), 'pink_flowers', 'Pink Flowers', 'Delicate pink blossoms captured in stunning close-up detail.', 'Nature', '2026', 'Preview', 'https://ott.prashantkadam.in/pink_flowers/thumbnail.png', true),
(gen_random_uuid(), 'relaxing_creek', 'Relaxing Creek', 'Fly over a serene rocky creek winding through untouched nature.', 'Nature', '2026', 'Preview', 'https://ott.prashantkadam.in/relaxing_creek/thumbnail.png', true),
(gen_random_uuid(), 'river_raft', 'River Raft Journey', 'A peaceful raft drifting gently down a calm sunlit river.', 'Adventure', '2026', 'Preview', 'https://ott.prashantkadam.in/river_raft/thumbnail.png', true),
(gen_random_uuid(), 'sea_sunset', 'Sea Sunset', 'A breathtaking sunset painting the ocean in golden hues.', 'Nature', '2026', 'Preview', 'https://ott.prashantkadam.in/sea_sunset/thumbnail.png', true),
(gen_random_uuid(), 'stars_in_space', 'Stars in Space', 'A mesmerizing journey drifting through the stars and cosmos.', 'Sci-Fi', '2026', 'Preview', 'https://ott.prashantkadam.in/stars_in_space/thumbnail.png', true),
(gen_random_uuid(), 'sunflower_field', 'Sunflower Field', 'A vast golden field of sunflowers swaying in the warm breeze.', 'Nature', '2026', 'Preview', 'https://ott.prashantkadam.in/sunflower_field/thumbnail.png', true),
(gen_random_uuid(), 'white_sand_beach', 'White Sand Beach', 'Pristine white sand beach lapped by crystal-clear turquoise waves.', 'Travel', '2026', 'Preview', 'https://ott.prashantkadam.in/white_sand_beach/thumbnail.png', true)
on conflict (slug) do nothing;

-- 4. Insert Video Streams (Mapping MPD)
INSERT INTO public.video_streams (video_id, origin_type, manifest_url) VALUES
((SELECT id FROM public.catalog_videos WHERE slug = 'free'), 'cdn', 'https://ott.prashantkadam.in/free/manifest.mpd'),
((SELECT id FROM public.catalog_videos WHERE slug = 'asiacup'), 'cdn', 'https://ott.prashantkadam.in/asiacup/manifest.mpd'),
((SELECT id FROM public.catalog_videos WHERE slug = 'output_02_04'), 'cdn', 'https://ott.prashantkadam.in/output_02_04/manifest.mpd'),
((SELECT id FROM public.catalog_videos WHERE slug = 'output_2min'), 'cdn', 'https://ott.prashantkadam.in/output_2min/manifest.mpd'),
((SELECT id FROM public.catalog_videos WHERE slug = 'tmkoc'), 'cdn', 'https://ott.prashantkadam.in/tmkoc/manifest.mpd'),
((SELECT id FROM public.catalog_videos WHERE slug = 'withlogo'), 'cdn', 'https://ott.prashantkadam.in/withlogo/manifest.mpd'),
((SELECT id FROM public.catalog_videos WHERE slug = 'dash_if_livesim'), 'cdn', 'https://livesim.dashif.org/livesim/chunkdur_1/ato_7/testpic4_8s/Manifest.mpd'),
((SELECT id FROM public.catalog_videos WHERE slug = 'multirate_dash'), 'cdn', 'https://dash.akamaized.net/dash264/TestCases/1b/qualcomm/1/MultiRatePatched.mpd'),
((SELECT id FROM public.catalog_videos WHERE slug = 'qualcomm_hd'), 'cdn', 'https://dash.akamaized.net/dash264/TestCasesHD/2b/qualcomm/1/MultiResMPEG2.mpd'),
((SELECT id FROM public.catalog_videos WHERE slug = 'hd_multireso'), 'cdn', 'https://dash.akamaized.net/dash264/TestCasesHD/2b/qualcomm/1/MultiResMPEG2.mpd'),
((SELECT id FROM public.catalog_videos WHERE slug = 'bitmovin_demo'), 'cdn', 'https://bitmovin-a.akamaihd.net/content/MI201109210084_1/mpds/f08e80da-bf1d-4e3d-8899-f0f6155f6efa.mpd'),
((SELECT id FROM public.catalog_videos WHERE slug = 'big_buck_bunny'), 'cdn', 'https://dash.akamaized.net/dash264/TestCases/1b/qualcomm/1/MultiRatePatched.mpd'),
((SELECT id FROM public.catalog_videos WHERE slug = 'bbb_itec'), 'cdn', 'https://dash.akamaized.net/dash264/TestCases/1b/qualcomm/1/MultiRatePatched.mpd'),
((SELECT id FROM public.catalog_videos WHERE slug = 'bbb_dark_truths'), 'cdn', 'https://dash.akamaized.net/dash264/TestCases/1b/qualcomm/1/MultiRatePatched.mpd'),
((SELECT id FROM public.catalog_videos WHERE slug = 'tears_of_steel'), 'cdn', 'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.mpd'),
((SELECT id FROM public.catalog_videos WHERE slug = 'sintel'), 'cdn', 'https://demo.unified-streaming.com/k8s/features/stable/video/sintel/sintel.ism/.mpd'),
((SELECT id FROM public.catalog_videos WHERE slug = 'elephant_dream'), 'cdn', 'https://demo.unified-streaming.com/k8s/features/stable/video/elephant-dream/elephant-dream.ism/.mpd'),
((SELECT id FROM public.catalog_videos WHERE slug = 'cosmos_laundromat'), 'cdn', 'https://dash.akamaized.net/dash264/TestCases/1b/qualcomm/1/MultiRatePatched.mpd'),
((SELECT id FROM public.catalog_videos WHERE slug = 'angel_one'), 'cdn', 'https://dash.akamaized.net/dash264/TestCases/1b/qualcomm/1/MultiRatePatched.mpd'),
((SELECT id FROM public.catalog_videos WHERE slug = 'heliocentrism'), 'cdn', 'https://bitmovin-a.akamaihd.net/content/MI201109210084_1/mpds/f08e80da-bf1d-4e3d-8899-f0f6155f6efa.mpd'),
((SELECT id FROM public.catalog_videos WHERE slug = 'countryside_meadow'), 'cdn', 'https://ott.prashantkadam.in/countryside_meadow/manifest.mpd'),
((SELECT id FROM public.catalog_videos WHERE slug = 'forest_waterfall'), 'cdn', 'https://ott.prashantkadam.in/forest_waterfall/manifest.mpd'),
((SELECT id FROM public.catalog_videos WHERE slug = 'mountain_highway'), 'cdn', 'https://ott.prashantkadam.in/mountain_highway/manifest.mpd'),
((SELECT id FROM public.catalog_videos WHERE slug = 'pexels_cityscape'), 'cdn', 'https://ott.prashantkadam.in/pexels_cityscape/manifest.mpd'),
((SELECT id FROM public.catalog_videos WHERE slug = 'pink_flowers'), 'cdn', 'https://ott.prashantkadam.in/pink_flowers/manifest.mpd'),
((SELECT id FROM public.catalog_videos WHERE slug = 'relaxing_creek'), 'cdn', 'https://ott.prashantkadam.in/relaxing_creek/manifest.mpd'),
((SELECT id FROM public.catalog_videos WHERE slug = 'river_raft'), 'cdn', 'https://ott.prashantkadam.in/river_raft/manifest.mpd'),
((SELECT id FROM public.catalog_videos WHERE slug = 'sea_sunset'), 'cdn', 'https://ott.prashantkadam.in/sea_sunset/manifest.mpd'),
((SELECT id FROM public.catalog_videos WHERE slug = 'stars_in_space'), 'cdn', 'https://ott.prashantkadam.in/stars_in_space/manifest.mpd'),
((SELECT id FROM public.catalog_videos WHERE slug = 'sunflower_field'), 'cdn', 'https://ott.prashantkadam.in/sunflower_field/manifest.mpd'),
((SELECT id FROM public.catalog_videos WHERE slug = 'white_sand_beach'), 'cdn', 'https://ott.prashantkadam.in/white_sand_beach/manifest.mpd')
on conflict do nothing;

-- 5. Insert Rails
INSERT INTO public.catalog_rails (slug, title, sort_order, is_active) VALUES
('trending-now', '🔥 Trending Now', 1, true),
('animation', '🎬 Animation', 2, true),
('sci-fi', '🚀 Sci-Fi', 3, true),
('documentary', '🌌 Documentary', 4, true),
('comedy', '😂 Comedy', 5, true),
('sports', '🏏 Sports', 6, true),
('reference-streams', '📡 Reference Streams', 7, true),
('your-content', '▶️ Your Content', 8, true),
('continue-watching', '⬇️ Continue Watching', 9, true)
on conflict (slug) do nothing;

-- 6. Insert Rail Items
INSERT INTO public.catalog_rail_items (rail_id, video_id, sort_order) VALUES
((SELECT id FROM public.catalog_rails WHERE slug = 'trending-now'), (SELECT id FROM public.catalog_videos WHERE slug = 'angel_one'), 1),
((SELECT id FROM public.catalog_rails WHERE slug = 'trending-now'), (SELECT id FROM public.catalog_videos WHERE slug = 'tears_of_steel'), 2),
((SELECT id FROM public.catalog_rails WHERE slug = 'trending-now'), (SELECT id FROM public.catalog_videos WHERE slug = 'sintel'), 3),
((SELECT id FROM public.catalog_rails WHERE slug = 'trending-now'), (SELECT id FROM public.catalog_videos WHERE slug = 'big_buck_bunny'), 4),
((SELECT id FROM public.catalog_rails WHERE slug = 'trending-now'), (SELECT id FROM public.catalog_videos WHERE slug = 'heliocentrism'), 5),
((SELECT id FROM public.catalog_rails WHERE slug = 'trending-now'), (SELECT id FROM public.catalog_videos WHERE slug = 'bbb_dark_truths'), 6),
((SELECT id FROM public.catalog_rails WHERE slug = 'animation'), (SELECT id FROM public.catalog_videos WHERE slug = 'big_buck_bunny'), 1),
((SELECT id FROM public.catalog_rails WHERE slug = 'animation'), (SELECT id FROM public.catalog_videos WHERE slug = 'bbb_dark_truths'), 2),
((SELECT id FROM public.catalog_rails WHERE slug = 'animation'), (SELECT id FROM public.catalog_videos WHERE slug = 'sintel'), 3),
((SELECT id FROM public.catalog_rails WHERE slug = 'animation'), (SELECT id FROM public.catalog_videos WHERE slug = 'elephant_dream'), 4),
((SELECT id FROM public.catalog_rails WHERE slug = 'animation'), (SELECT id FROM public.catalog_videos WHERE slug = 'cosmos_laundromat'), 5),
((SELECT id FROM public.catalog_rails WHERE slug = 'sci-fi'), (SELECT id FROM public.catalog_videos WHERE slug = 'angel_one'), 1),
((SELECT id FROM public.catalog_rails WHERE slug = 'sci-fi'), (SELECT id FROM public.catalog_videos WHERE slug = 'tears_of_steel'), 2),
((SELECT id FROM public.catalog_rails WHERE slug = 'documentary'), (SELECT id FROM public.catalog_videos WHERE slug = 'heliocentrism'), 1),
((SELECT id FROM public.catalog_rails WHERE slug = 'comedy'), (SELECT id FROM public.catalog_videos WHERE slug = 'tmkoc'), 1),
((SELECT id FROM public.catalog_rails WHERE slug = 'comedy'), (SELECT id FROM public.catalog_videos WHERE slug = 'blackmail'), 2),
((SELECT id FROM public.catalog_rails WHERE slug = 'sports'), (SELECT id FROM public.catalog_videos WHERE slug = 'asiacup'), 1),
((SELECT id FROM public.catalog_rails WHERE slug = 'reference-streams'), (SELECT id FROM public.catalog_videos WHERE slug = 'dash_if_livesim'), 1),
((SELECT id FROM public.catalog_rails WHERE slug = 'reference-streams'), (SELECT id FROM public.catalog_videos WHERE slug = 'multirate_dash'), 2),
((SELECT id FROM public.catalog_rails WHERE slug = 'reference-streams'), (SELECT id FROM public.catalog_videos WHERE slug = 'hd_multireso'), 3),
((SELECT id FROM public.catalog_rails WHERE slug = 'reference-streams'), (SELECT id FROM public.catalog_videos WHERE slug = 'bitmovin_demo'), 4),
((SELECT id FROM public.catalog_rails WHERE slug = 'reference-streams'), (SELECT id FROM public.catalog_videos WHERE slug = 'bbb_itec'), 5),
((SELECT id FROM public.catalog_rails WHERE slug = 'your-content'), (SELECT id FROM public.catalog_videos WHERE slug = 'free'), 1),
((SELECT id FROM public.catalog_rails WHERE slug = 'your-content'), (SELECT id FROM public.catalog_videos WHERE slug = 'output_2min'), 2),
((SELECT id FROM public.catalog_rails WHERE slug = 'your-content'), (SELECT id FROM public.catalog_videos WHERE slug = 'output_02_04'), 3),
((SELECT id FROM public.catalog_rails WHERE slug = 'your-content'), (SELECT id FROM public.catalog_videos WHERE slug = 'withlogo'), 4),
((SELECT id FROM public.catalog_rails WHERE slug = 'continue-watching'), (SELECT id FROM public.catalog_videos WHERE slug = 'angel_one'), 1),
((SELECT id FROM public.catalog_rails WHERE slug = 'continue-watching'), (SELECT id FROM public.catalog_videos WHERE slug = 'sintel'), 2),
((SELECT id FROM public.catalog_rails WHERE slug = 'continue-watching'), (SELECT id FROM public.catalog_videos WHERE slug = 'big_buck_bunny'), 3),
((SELECT id FROM public.catalog_rails WHERE slug = 'continue-watching'), (SELECT id FROM public.catalog_videos WHERE slug = 'tears_of_steel'), 4),
((SELECT id FROM public.catalog_rails WHERE slug = 'continue-watching'), (SELECT id FROM public.catalog_videos WHERE slug = 'heliocentrism'), 5)
on conflict do nothing;

-- 7. Insert Video Keys (Private)
INSERT INTO private.video_keys (video_id, key_id_hex, key_hex) VALUES
((SELECT id FROM public.catalog_videos WHERE slug = 'free'), 'ed0102030405060708090a0b0c0d0e0f', 'f0e0d0c0b0a090807060504030201000'),
((SELECT id FROM public.catalog_videos WHERE slug = 'asiacup'), 'ed0102030405060708090a0b0c0d0e0f', 'f0e0d0c0b0a090807060504030201000'),
((SELECT id FROM public.catalog_videos WHERE slug = 'output_02_04'), 'ed0102030405060708090a0b0c0d0e0f', 'f0e0d0c0b0a090807060504030201000'),
((SELECT id FROM public.catalog_videos WHERE slug = 'output_2min'), 'ed0102030405060708090a0b0c0d0e0f', 'f0e0d0c0b0a090807060504030201000'),
((SELECT id FROM public.catalog_videos WHERE slug = 'tmkoc'), 'ed0102030405060708090a0b0c0d0e0f', 'f0e0d0c0b0a090807060504030201000'),
((SELECT id FROM public.catalog_videos WHERE slug = 'withlogo'), 'ed0102030405060708090a0b0c0d0e0f', 'f0e0d0c0b0a090807060504030201000'),
((SELECT id FROM public.catalog_videos WHERE slug = 'countryside_meadow'), 'ed0102030405060708090a0b0c0d0e0f', 'f0e0d0c0b0a090807060504030201000'),
((SELECT id FROM public.catalog_videos WHERE slug = 'forest_waterfall'), 'ed0102030405060708090a0b0c0d0e0f', 'f0e0d0c0b0a090807060504030201000'),
((SELECT id FROM public.catalog_videos WHERE slug = 'mountain_highway'), 'ed0102030405060708090a0b0c0d0e0f', 'f0e0d0c0b0a090807060504030201000'),
((SELECT id FROM public.catalog_videos WHERE slug = 'pexels_cityscape'), 'ed0102030405060708090a0b0c0d0e0f', 'f0e0d0c0b0a090807060504030201000'),
((SELECT id FROM public.catalog_videos WHERE slug = 'pink_flowers'), 'ed0102030405060708090a0b0c0d0e0f', 'f0e0d0c0b0a090807060504030201000'),
((SELECT id FROM public.catalog_videos WHERE slug = 'relaxing_creek'), 'ed0102030405060708090a0b0c0d0e0f', 'f0e0d0c0b0a090807060504030201000'),
((SELECT id FROM public.catalog_videos WHERE slug = 'river_raft'), 'ed0102030405060708090a0b0c0d0e0f', 'f0e0d0c0b0a090807060504030201000'),
((SELECT id FROM public.catalog_videos WHERE slug = 'sea_sunset'), 'ed0102030405060708090a0b0c0d0e0f', 'f0e0d0c0b0a090807060504030201000'),
((SELECT id FROM public.catalog_videos WHERE slug = 'stars_in_space'), 'ed0102030405060708090a0b0c0d0e0f', 'f0e0d0c0b0a090807060504030201000'),
((SELECT id FROM public.catalog_videos WHERE slug = 'sunflower_field'), 'ed0102030405060708090a0b0c0d0e0f', 'f0e0d0c0b0a090807060504030201000'),
((SELECT id FROM public.catalog_videos WHERE slug = 'white_sand_beach'), 'ed0102030405060708090a0b0c0d0e0f', 'f0e0d0c0b0a090807060504030201000')
on conflict do nothing;
```

## 3. Vercel Setup
1. **Push to GitHub**: Ensure the latest code is on the `vercel` branch.
2. **Import to Vercel**:
   - Go to [vercel.com](https://vercel.com).
   - Click "Add New" -> "Project".
   - Import your `ott` repository.
3. **Configure Project**:
   - **Framework Preset**: Select `Other`.
   - **Build and Output Settings**:
     - **Output Directory**: Enter `public` (this ensures `public/index.html` is served at the root `/`).
     - **Build Command**: Leave empty (or `npm run build`).
     - **Install Command**: `npm install`.
4. **Environment Variables**: Add all variables listed below (refer to Supabase API settings and Cloudflare dashboard):
   - `SUPABASE_URL`: Your Supabase Project URL.
   - `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase `service_role` key (required for private schema access).
   - `SESSION_SECRET`: A random 32-char hex string.
   - `CRON_SECRET`: A secret for your cron jobs (matching the one in Vercel settings).
   - `APP_BASE_URL`: `https://webott.prashantkadam.in`
   - `CDN_BASE_URL`: `https://ott.prashantkadam.in`
   - `GRAFANA_PROM_URL`: From Grafana Cloud "Prometheus" -> "Remote Write Endpoint".
   - `GRAFANA_PROM_USER`: From Grafana Cloud "Prometheus" -> "User ID".
   - `GRAFANA_PROM_API_KEY`: A Grafana Cloud API Token with "MetricsPush" permissions.
   - `CF_ACCOUNT_ID`: Your Cloudflare Account ID.
   - `CF_ZONE_ID`: Your Cloudflare Zone ID for `prashantkadam.in`.
   - `CF_API_TOKEN`: A Cloudflare API Token with "Analytics Read" permissions.
5. **Deploy**: Click "Deploy".
6. **Custom Domain**: 
   - Once deployed, go to **Settings** -> **Domains**.
   - Add `webott.prashantkadam.in`.
   - Configure your DNS provider (Cloudflare) with the CNAME record provided by Vercel.

## 4. Supabase Auth Note
The login API uses `public.access_users` and `private.user_credentials`. To create a user with a password, you should use the `POST /api/admin/sync-user` (or similar utility) to hash the password properly before inserting it into the `private.user_credentials` table. 

## 5. Folder Structure Details
- `/public`: Contains static assets (`index.html`, `dashboard.html`, CSS, browser JS, images).
- `/api`: Contains Vercel serverless functions (Auth, Catalog, Playback License, Metrics, Cron).
- `/supabase/migrations`: Contains the SQL schema file.
- `vercel.json`: Configuration for routing and cron jobs.

---

### 📊 Observability & Metrics

The platform uses a hybrid observability stack to maximize visibility on Vercel Hobby plans:

1.  **Vercel Analytics & Speed Insights**: Integrated via standard Vercel script tags in `index.html`. View these in the Vercel Dashboard.
2.  **Vercel Edge Metrics**: Captured via `middleware.js`. Every request reports its region (`x-vercel-id`), cache status (`x-vercel-cache`), and country to Prometheus.
3.  **Web Vitals (Prometheus)**: Custom tracking in `observability.js` reports RUM performance (LCP, FID, CLS, TTFB) directly to your Grafana/Prometheus instance.
4.  **CDN Health (Cloudflare)**: The `api/cron/cdn-metrics` task pulls aggregated data centers, status codes, and device metrics from Cloudflare.

**Prometheus Measurements:**
- `vercel_edge_metrics`: Request-level data from the edge.
- `web_vitals`: UX performance scores (LCP, FID, CLS, TTFB, FCP).
- `client_metrics`: Playback QoE (buffering, bitrate).
- `cdn_summary`: Cloudflare aggregated performance.

