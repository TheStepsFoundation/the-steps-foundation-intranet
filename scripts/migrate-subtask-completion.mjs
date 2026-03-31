#!/usr/bin/env node
// Migration: Add completed_at and actual_hours columns to subtasks table

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://rvspshqltnyormiqaidx.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ2c3BzaHFsdG55b3JtaXFhaWR4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzY5Njc4MywiZXhwIjoyMDg5MjcyNzgzfQ.CCllDmodX0ciMsl0DerLeUTJlEcgfkh7MiXPgQplF_Q'

const supabase = createClient(supabaseUrl, supabaseKey)

async function migrate() {
  console.log('Running migration: Add completed_at and actual_hours to subtasks...')
  
  // Check current schema by fetching a subtask
  const { data: sample, error: sampleErr } = await supabase
    .from('subtasks')
    .select('*')
    .limit(1)
  
  if (sampleErr) {
    console.error('Error checking schema:', sampleErr)
    return
  }
  
  console.log('Current subtask columns:', sample?.[0] ? Object.keys(sample[0]) : 'no data')
  
  // We can't run ALTER TABLE via supabase-js client
  // Need to use the SQL editor in Supabase dashboard
  console.log('\n⚠️  Please run this SQL in Supabase Dashboard SQL Editor:')
  console.log('─'.repeat(60))
  console.log(`
ALTER TABLE subtasks 
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS actual_hours DECIMAL(4,2);

-- Update index for queries by completion date
CREATE INDEX IF NOT EXISTS idx_subtasks_completed_at ON subtasks(completed_at);
`)
  console.log('─'.repeat(60))
}

migrate()
