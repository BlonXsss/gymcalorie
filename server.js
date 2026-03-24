import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const STATE_KEY = process.env.STATE_KEY || "default";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));

let pool = null;
let dbReady = false;
let dbStatusMessage = "DATABASE_URL not set; running local-only mode.";

if (DATABASE_URL) {
  pool = new pg.Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000
  });
  dbStatusMessage = "Database configured, pending connectivity check.";
}

async function ensureTable() {
  if (!pool) {
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id TEXT PRIMARY KEY,
      state JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  dbReady = true;
  dbStatusMessage = "Database connected.";
}

app.get("/api/health", async (_req, res) => {
  if (!pool || !dbReady) {
    res.status(200).json({ ok: true, db: false, message: dbStatusMessage });
    return;
  }
  try {
    await pool.query("SELECT 1");
    res.status(200).json({ ok: true, db: true });
  } catch (error) {
    res.status(500).json({ ok: false, db: false, error: "Database connection failed." });
  }
});

app.get("/api/state", async (_req, res) => {
  if (!pool || !dbReady) {
    res.status(503).json({ error: dbStatusMessage });
    return;
  }
  try {
    const result = await pool.query("SELECT state, updated_at FROM app_state WHERE id = $1", [STATE_KEY]);
    if (!result.rows.length) {
      res.status(200).json({ state: null });
      return;
    }
    res.status(200).json({ state: result.rows[0].state, updatedAt: result.rows[0].updated_at });
  } catch (error) {
    res.status(500).json({ error: "Unable to load state." });
  }
});

app.put("/api/state", async (req, res) => {
  if (!pool || !dbReady) {
    res.status(503).json({ error: dbStatusMessage });
    return;
  }
  const incomingState = req.body?.state;
  if (!incomingState || typeof incomingState !== "object") {
    res.status(400).json({ error: "Missing valid state payload." });
    return;
  }
  try {
    await pool.query(
      `INSERT INTO app_state (id, state, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (id)
       DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()`,
      [STATE_KEY, JSON.stringify(incomingState)]
    );
    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Unable to save state." });
  }
});

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.sendFile(path.join(__dirname, "index.html"));
});

ensureTable()
  .then(() => {
    // no-op
  })
  .catch((error) => {
    dbReady = false;
    dbStatusMessage = `Database connection failed: ${error.message}`;
    console.warn("Database offline. Running local-only mode.");
  });

app.listen(PORT, () => {
  console.log(`Gym tracker running on http://localhost:${PORT}`);
});
