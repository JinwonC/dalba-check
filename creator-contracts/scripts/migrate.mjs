import fs from "node:fs";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const local = /localhost|127\.0\.0\.1/.test(url);
const client = new pg.Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false } });
await client.connect();
await client.query(fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
await client.end();
console.log("Schema applied.");
