// supabase-config.js

// TODO: Replace with actual Supabase URL and ANON KEY for Pancoran Waterpark
var SUPABASE_URL = 'https://knnmejepqeltmxkdaohh.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtubm1lamVwcWVsdG14a2Rhb2hoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODE2MzMyNiwiZXhwIjoyMDkzNzM5MzI2fQ.2vJEBJDPXguz_WvzZXN04CF2jtqsbQOJkscR6NoG0nI';

var _supabaseClient;

// Check if Supabase JS SDK is loaded
if (window.supabase) {
    _supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    window.supabaseInstance = _supabaseClient; // Export for other scripts
} else {
    console.error('Supabase library not loaded. Make sure you are online or the library is cached.');
}
