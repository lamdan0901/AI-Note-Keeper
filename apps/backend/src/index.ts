import { config } from './config.js';
import express from 'express';
import cors from 'cors';
import { createHealthStatus } from './health.js';
import { errorMiddleware, notFoundMiddleware } from './middleware/error-middleware.js';
// Pre-initialize pool
import './db/pool.js';

const port = config.PORT;
const app = express();

app.use(cors());
app.use(express.json());

app.get('/health/live', (req, res) => {
  res.json(createHealthStatus());
});

app.get('/health/ready', (req, res) => {
  res.json(createHealthStatus());
});

app.get('/api/sample', (req, res) => {
  res.json({ message: 'Hello from the backend API!' });
});

app.use(notFoundMiddleware);
app.use(errorMiddleware);

app.listen(port, () => {
  console.log(`[backend] listening on http://localhost:${port}`);
});
