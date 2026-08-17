import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// Read Supabase credentials from environment variables to avoid committing secrets.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wcednzaxmxwfiijzmjmx.supabase.co';
const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || 'YOUR_SERVICE_ROLE_KEY';

if (!SERVICE_ROLE_KEY || SERVICE_ROLE_KEY === 'YOUR_SERVICE_ROLE_KEY') {
  console.error('Missing Supabase service role key. Set $SERVICE_ROLE_KEY (do not commit this key).');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function listAllFilesInBucket(bucketName, path = '') {
  const { data, error } = await supabase.storage.from(bucketName).list(path, {
    limit: 1000,
    offset: 0,
    sortBy: { column: 'name', order: 'asc' },
  });

  if (error) {
    throw error;
  }

  const items = data ?? [];
  const files = [];
  const folders = [];

  for (const item of items) {
    if (item.id && item.metadata) {
      files.push({
        ...item,
        bucket: bucketName,
        path: item.name,
        fullPath: path ? `${path}/${item.name}` : item.name,
      });
    } else if (item.name) {
      folders.push(item.name);
    }
  }

  for (const folder of folders) {
    const childPath = path ? `${path}/${folder}` : folder;
    const childFiles = await listAllFilesInBucket(bucketName, childPath);
    files.push(...childFiles);
  }

  return files;
}

async function exportAll() {
  console.log('Fetching storage buckets...');
  const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();

  if (bucketsError) {
    throw bucketsError;
  }

  const allRows = [];

  for (const bucket of buckets ?? []) {
    console.log(`Scanning bucket: ${bucket.name}`);
    const files = await listAllFilesInBucket(bucket.name);
    allRows.push(...files);
    console.log(`Found ${files.length} files in bucket ${bucket.name}`);
  }

  fs.writeFileSync('storage_objects.json', JSON.stringify(allRows, null, 2));
  console.log(`\nDone! Saved ${allRows.length} files to storage_objects.json`);
}

exportAll().catch((error) => {
  console.error('Storage export failed:', error);
  process.exit(1);
});