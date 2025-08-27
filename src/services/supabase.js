// SupabaseSingleton.js
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
class SupabaseSingleton {
  constructor() {
    if (!SupabaseSingleton.instance) {
      const SUPABASE_URL = 'https://lozvfrbykmojrwyzxrdk.supabase.co';
      const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxvenZmcmJ5a21vanJ3eXp4cmRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0NTk5MjgsImV4cCI6MjA3MTAzNTkyOH0.-_Mh5w372xszdREE5Buo0ovfPvTzHR5_sBueT0wxsy0';
      this.client = createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false }
      });
      SupabaseSingleton.instance = this;
    }
    return SupabaseSingleton.instance;
  }

  getClient() {
    return this.client;
  }
}

module.exports = new SupabaseSingleton();

