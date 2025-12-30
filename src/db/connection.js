const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const path = require("path");

const env = process.env.NODE_ENV || "dev";

dotenv.config({
  path: env === "prod"
    ? path.resolve(process.cwd(), ".env.prod")
    : path.resolve(process.cwd(), ".env")
});

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'dex_data',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

module.exports = pool;

