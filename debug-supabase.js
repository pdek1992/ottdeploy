import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://djfoottzevyyunutgwnl.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqZm9vdHR6ZXZ5eXVudXRnd25sIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzYzMjYxNiwiZXhwIjoyMDkzMjA4NjE2fQ.yAVmD1AFpA71qZtm4vRZMUBK87jrMb7f8v2ocH0PF5k';

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  console.log('Testing Supabase connection...');
  const { data, error } = await supabase.from('access_users').select('id').limit(1);
  if (error) {
    console.error('Connection Error:', error.message);
  } else {
    console.log('Connection Successful! Found:', data.length, 'users.');
  }
}

test();
