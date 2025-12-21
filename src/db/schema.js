const pool = require('./connection.js');

async function initializeDatabase() {
  const connection = await pool.getConnection();
  
  try {
    // swaps 테이블 생성
    await connection.query(`
      CREATE TABLE IF NOT EXISTS swaps (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        txHash VARCHAR(66) NOT NULL,
        logIndex INT UNSIGNED NOT NULL,
        blockNumber BIGINT UNSIGNED NOT NULL,
        timestamp INT UNSIGNED NOT NULL,
        pairAddress VARCHAR(42) NOT NULL,
        token0 VARCHAR(42) NOT NULL,
        token1 VARCHAR(42) NOT NULL,
        amount0In DECIMAL(65, 18) NOT NULL DEFAULT 0,
        amount1In DECIMAL(65, 18) NOT NULL DEFAULT 0,
        amount0Out DECIMAL(65, 18) NOT NULL DEFAULT 0,
        amount1Out DECIMAL(65, 18) NOT NULL DEFAULT 0,
        to_address VARCHAR(42) NOT NULL,
        price DECIMAL(65, 18) DEFAULT NULL,
        token0Price DECIMAL(65, 18) DEFAULT NULL,
        token1Price DECIMAL(65, 18) DEFAULT NULL,
        volume DECIMAL(65, 18) DEFAULT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_swap (txHash, logIndex),
        INDEX idx_pair (pairAddress),
        INDEX idx_block (blockNumber),
        INDEX idx_token0 (token0),
        INDEX idx_token1 (token1),
        INDEX idx_timestamp (timestamp)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // metadata 테이블 생성 (각 테이블별 마지막 처리 블록 추적)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS metadata (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        tableName VARCHAR(50) NOT NULL UNIQUE,
        lastProcessedBlock BIGINT UNSIGNED NOT NULL DEFAULT 0,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_table (tableName)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // pairs 테이블 생성 (페어 정보 추적)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS pairs (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        pairAddress VARCHAR(42) NOT NULL UNIQUE,
        token0 VARCHAR(42) NOT NULL,
        token1 VARCHAR(42) NOT NULL,
        createdBlock BIGINT UNSIGNED NOT NULL DEFAULT 0,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_token0 (token0),
        INDEX idx_token1 (token1)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('Database schema initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { initializeDatabase };

