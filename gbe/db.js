"use strict";

const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const { SCHEMA_SQL } = require("./schema");

const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString,
  // onpod managed Postgres keeps TLS on but the CA chain isn't bundled in the
  // slim image, so trust the managed cert (attach-db-ssl no-verify equivalent).
  ssl: connectionString && /sslmode=require/.test(connectionString)
    ? { rejectUnauthorized: false }
    : false,
  max: 8,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

const SUPER_ADMIN = { username: "gbe_adm", password: "GbeAdm12!#", name: "총괄 관리자" };

async function seed() {
  const existing = await pool.query("SELECT 1 FROM users WHERE username = $1", [SUPER_ADMIN.username]);
  if (existing.rowCount === 0) {
    const hash = await bcrypt.hash(SUPER_ADMIN.password, 10);
    await pool.query(
      "INSERT INTO users (username, password, role, name) VALUES ($1,$2,'super_admin',$3)",
      [SUPER_ADMIN.username, hash, SUPER_ADMIN.name]
    );
    console.log("[seed] super admin created");
  }

  const schoolCount = await pool.query("SELECT COUNT(*)::int AS c FROM schools");
  if (schoolCount.rows[0].c === 0) {
    const demoSchools = [
      ["E001", "경북초등학교", "general", "public", "elementary"],
      ["M001", "경북중학교", "general", "public", "middle"],
      ["H001", "경북고등학교", "general", "private", "high"],
      ["S001", "경북특수학교", "special", "public", "special"],
    ];
    for (const [code, name, category, foundation, level] of demoSchools) {
      await pool.query(
        "INSERT INTO schools (code, name, category, foundation, level) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (code) DO NOTHING",
        [code, name, category, foundation, level]
      );
    }
    console.log("[seed] demo schools created");
  }
}

async function initDb(retries = 12) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await pool.query(SCHEMA_SQL);
      await seed();
      console.log("[db] schema ready");
      return;
    } catch (err) {
      console.error(`[db] init attempt ${attempt}/${retries}: ${err.message}`);
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

module.exports = { pool, initDb };
