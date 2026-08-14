import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// Read supabase url and key from src/db.js
const code = fs.readFileSync('src/db.js', 'utf8');
const urlMatch = code.match(/createClient\(['"]([^'"]+)['"]/);
const keyMatch = code.match(/createClient\(['"][^'"]+['"],\s*['"]([^'"]+)['"]/);

if (!urlMatch || !keyMatch) {
  console.log('Could not find supabase credentials in db.js');
  process.exit(1);
}

const supabase = createClient(urlMatch[1], keyMatch[1]);

async function run() {
  const { data, error } = await supabase.from('pdf_notes').upsert({ pdf_id: 'test-id', content: 'hello world' }, { onConflict: 'pdf_id' });
  console.log('Result:', { data, error });
}
run();
