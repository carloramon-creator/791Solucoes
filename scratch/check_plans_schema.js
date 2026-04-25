
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const { resolve } = require('path');

dotenv.config({ path: resolve('/Users/ramon/Documents/791/.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function listTables() {
  const tables = ['plans', 'subscription_plans', 'system_plans', 'tenants', 'subscriptions'];
  for (const t of tables) {
    const { data, error, count } = await supabase.from(t).select('*', { count: 'exact', head: true });
    if (!error) {
      console.log(`Table exists: ${t} (Count: ${count})`);
      if (count > 0) {
        const { data: firstRow } = await supabase.from(t).select('*').limit(1);
        console.log(`Columns for ${t}:`, Object.keys(firstRow[0]));
      }
    }
  }
}
listTables();
