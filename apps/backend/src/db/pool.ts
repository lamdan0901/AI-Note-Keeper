import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

// Connection Pooling (Performance)
// Opening and closing a full TCP connection to PostgreSQL for every single HTTP request is extremely "expensive" in terms of latency and server resources.
// A Pool keeps a set of already-open connections ready to be reused.
// When a request comes in, it "borrows" a connection and "returns" it when done, making your API significantly faster.
export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Fail-Fast Validation & Error Handling
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});
// This ensures that if a background connection dies (due to network blips or DB restarts),
// the app logs it immediately rather than silently failing or hanging.
