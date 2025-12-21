const pool = require('./connection.js');

class SwapRepository {
  static async insertSwap(swapData) {
    const connection = await pool.getConnection();
    try {
      const [result] = await connection.query(
        `INSERT IGNORE INTO swaps 
        (txHash, logIndex, blockNumber, timestamp, pairAddress, token0, token1, 
         amount0In, amount1In, amount0Out, amount1Out, to_address, price, token0Price, token1Price, volume)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          swapData.txHash,
          swapData.logIndex,
          swapData.blockNumber,
          swapData.timestamp,
          swapData.pairAddress,
          swapData.token0,
          swapData.token1,
          swapData.amount0In,
          swapData.amount1In,
          swapData.amount0Out,
          swapData.amount1Out,
          swapData.to,
          swapData.price,
          swapData.token0Price || null,
          swapData.token1Price || null,
          swapData.volume
        ]
      );
      return result.affectedRows > 0;
    } catch (error) {
      // 중복 키 에러는 무시
      if (error.code === 'ER_DUP_ENTRY') {
        return false;
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * 특정 테이블의 마지막 처리된 블록 업데이트
   */
  static async updateLastProcessedBlock(tableName, blockNumber) {
    const connection = await pool.getConnection();
    try {
      await connection.query(
        `INSERT INTO metadata (tableName, lastProcessedBlock) 
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE 
         lastProcessedBlock = GREATEST(lastProcessedBlock, VALUES(lastProcessedBlock))`,
        [tableName, blockNumber]
      );
    } catch (error) {
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * 특정 테이블의 마지막 처리된 블록 가져오기
   */
  static async getLastProcessedBlock(tableName) {
    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.query(
        'SELECT lastProcessedBlock FROM metadata WHERE tableName = ?',
        [tableName]
      );
      return rows[0]?.lastProcessedBlock || null;
    } finally {
      connection.release();
    }
  }


  static async getPairInfo(pairAddress) {
    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.query(
        'SELECT * FROM pairs WHERE pairAddress = ?',
        [pairAddress]
      );
      return rows[0] || null;
    } finally {
      connection.release();
    }
  }

  /**
   * 전체 테이블 중 가장 최근 처리된 블록 가져오기
   */
  static async getLatestProcessedBlock() {
    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.query(
        'SELECT MAX(lastProcessedBlock) as maxBlock FROM metadata'
      );
      return rows[0]?.maxBlock || null;
    } finally {
      connection.release();
    }
  }
}

module.exports = { SwapRepository };

