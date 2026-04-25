import { supabaseGlass } from './src/lib/supabase-glass';

async function checkCycleColumn() {
  const { data, error } = await supabaseGlass
    .from('vidracarias')
    .select('*')
    .limit(1);
  
  if (data && data[0]) {
    console.log('Colunas da Vidracaria:', Object.keys(data[0]));
  } else {
    console.log('Erro ao ler tabela:', error);
  }
}

checkCycleColumn();
