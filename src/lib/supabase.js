import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase;
try {
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing");
  }
  supabase = createClient(supabaseUrl, supabaseKey);
} catch (e) {
  console.error("FAILED TO INITIALIZE SUPABASE CLIENT:", e.message);
  // Create a dummy client to avoid export errors, but it will fail on calls
  supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseKey || 'placeholder');
}

export { supabase };
