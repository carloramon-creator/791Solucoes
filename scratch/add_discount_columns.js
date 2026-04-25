
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const { resolve } = require('path');

dotenv.config({ path: resolve('/Users/ramon/Documents/791/.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function addDiscountColumns() {
  console.log('Adding discount columns to system_plans...');
  
  // Como não temos acesso direto ao SQL via RPC exec_sql na maioria das configs padrão,
  // vou tentar atualizar um registro existente para ver se as colunas já existem.
  // Se falhar, informarei que precisam ser criadas via dashboard do Supabase.
  
  const { data: plans, error: fetchError } = await supabase.from('system_plans').select('*').limit(1);
  
  if (fetchError) {
    console.error('Error fetching plans:', fetchError.message);
    return;
  }

  const columns = Object.keys(plans[0] || {});
  if (columns.includes('discount_semestral') && columns.includes('discount_anual')) {
    console.log('Columns already exist.');
  } else {
    console.log('Columns do not exist. Please run this SQL in your Supabase SQL Editor:');
    console.log(`
      ALTER TABLE system_plans 
      ADD COLUMN IF NOT EXISTS discount_semestral numeric DEFAULT 5,
      ADD COLUMN IF NOT EXISTS discount_anual numeric DEFAULT 15;
    `);
    
    // Tentativa de update para forçar erro e confirmar ausência (opcional)
  }
}

addDiscountColumns();
