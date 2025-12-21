const { ethers } = require('ethers');
const { SwapRepository } = require('../db/repository.js');
const { PairContract } = require('../contracts/pair.js');

class FactoryCollector {
  constructor(provider, factoryAddress, allowedTokens, queue = null, blockRange = 10000) {
    this.provider = provider;
    this.factoryAddress = factoryAddress.toLowerCase();
    this.allowedTokens = allowedTokens.map(t => t.toLowerCase());
    this.queue = queue;
    this.blockRange = blockRange;
    this.factoryABI = [
      "event PairCreated(address indexed token0, address indexed token1, address pair, uint)"
    ];
  }

  /**
   * 토큰이 허용된 토큰 목록에 포함되는지 확인
   */
  isAllowedToken(tokenAddress) {
    return this.allowedTokens.includes(tokenAddress.toLowerCase());
  }

  /**
   * 페어가 허용된 토큰 중 하나와 매칭되는지 확인
   */
  isAllowedPair(token0, token1) {
    const t0 = token0.toLowerCase();
    const t1 = token1.toLowerCase();
    
    // 둘 중 하나라도 허용된 토큰이면 true
    return this.isAllowedToken(t0) || this.isAllowedToken(t1);
  }

  /**
   * PairCreated 이벤트 수집 및 처리 (블록 범위를 나눠서 처리)
   */
  async collectPairCreatedEvents(fromBlock, toBlock) {
    const allCreatedPairs = [];
    let currentFrom = fromBlock;
    const totalBlocks = toBlock - fromBlock + 1;
    
    console.log(`[FactoryCollector] Collecting PairCreated events from block ${fromBlock} to ${toBlock} (${totalBlocks} blocks, ${Math.ceil(totalBlocks / this.blockRange)} batches)`);

    while (currentFrom <= toBlock) {
      const currentTo = Math.min(currentFrom + this.blockRange - 1, toBlock);
      
      try {
        const pairs = await this.collectPairCreatedEventsBatch(currentFrom, currentTo);
        allCreatedPairs.push(...pairs);
        
        console.log(`[FactoryCollector] Processed blocks ${currentFrom}-${currentTo}: found ${pairs.length} pairs`);
        
        // 다음 범위로 이동
        currentFrom = currentTo + 1;
        
        // RPC 부하 방지
        if (currentFrom <= toBlock) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error) {
        console.error(`[FactoryCollector] Error processing blocks ${currentFrom}-${currentTo}:`, error.message);
        
        // 에러 발생 시 블록 범위를 줄여서 재시도
        const smallerRange = Math.floor(this.blockRange / 2);
        if (smallerRange > 0) {
          const retryTo = Math.min(currentFrom + smallerRange - 1, toBlock);
          console.log(`[FactoryCollector] Retrying with smaller range: ${currentFrom} to ${retryTo}`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          try {
            const pairs = await this.collectPairCreatedEventsBatch(currentFrom, retryTo);
            allCreatedPairs.push(...pairs);
            currentFrom = retryTo + 1;
          } catch (retryError) {
            console.error(`[FactoryCollector] Retry failed, skipping blocks ${currentFrom}-${retryTo}`);
            currentFrom = retryTo + 1;
          }
        } else {
          // 범위가 너무 작으면 다음 블록으로 이동
          currentFrom = currentTo + 1;
        }
      }
    }

    console.log(`[FactoryCollector] Total collected: ${allCreatedPairs.length} pairs from blocks ${fromBlock}-${toBlock}`);
    return allCreatedPairs;
  }

  /**
   * 특정 블록 범위의 PairCreated 이벤트 수집 및 처리
   */
  async collectPairCreatedEventsBatch(fromBlock, toBlock) {
    try {
      const iface = new ethers.Interface(this.factoryABI);
      const filter = {
        address: this.factoryAddress,
        topics: [ethers.id("PairCreated(address,address,address,uint256)")],
        fromBlock,
        toBlock
      };

      const logs = await this.provider.getLogs(filter);

      const createdPairs = [];

      for (const log of logs) {
        try {
          const parsedLog = iface.parseLog({
            topics: log.topics,
            data: log.data
          });

          if (!parsedLog) {
            continue;
          }

          const { token0, token1, pair } = parsedLog.args;
          const token0Addr = token0.toLowerCase();
          const token1Addr = token1.toLowerCase();
          const pairAddr = pair.toLowerCase();

          // 허용된 토큰과의 페어인지 확인
          if (!this.isAllowedPair(token0, token1)) {
            console.log(`Skipping pair ${pairAddr}: not matched with allowed tokens`);
            continue;
          }

          // 블록 정보 가져오기
          const block = await this.provider.getBlock(log.blockNumber);

          // 페어 정보를 DB에 저장 (upsert)
          const pool = require('../db/connection.js');
          const conn = await pool.getConnection();
          let isNewPair = false;
          try {
            // 먼저 존재 여부 확인
            const [existing] = await conn.query(
              'SELECT pairAddress FROM pairs WHERE pairAddress = ?',
              [pairAddr]
            );
            
            isNewPair = existing.length === 0;
            
            // Upsert
            await conn.query(
              `INSERT INTO pairs (pairAddress, token0, token1, createdBlock, createdAt) 
               VALUES (?, ?, ?, ?, FROM_UNIXTIME(?))
               ON DUPLICATE KEY UPDATE 
                 token0 = VALUES(token0), 
                 token1 = VALUES(token1),
                 createdBlock = IF(createdBlock = 0, VALUES(createdBlock), createdBlock)`,
              [pairAddr, token0Addr, token1Addr, log.blockNumber, block.timestamp]
            );
          } finally {
            conn.release();
          }

          createdPairs.push({
            pairAddress: pairAddr,
            token0: token0Addr,
            token1: token1Addr,
            blockNumber: log.blockNumber,
            timestamp: block.timestamp
          });

          console.log(`✓ Pair created: ${pairAddr} (${token0Addr}/${token1Addr}) at block ${log.blockNumber}`);

          // 새 페어인 경우 큐에 Subscribe/Backfill 작업 추가
          if (isNewPair && this.queue) {
            const currentBlock = await this.provider.getBlockNumber();
            
            // Backfill 작업: 생성 블록부터 현재 블록까지
            this.queue.enqueue({
              id: `backfill-${pairAddr}-${Date.now()}`,
              type: 'backfill',
              pairAddress: pairAddr,
              fromBlock: log.blockNumber,
              toBlock: currentBlock
            });

            // Subscribe 작업: 실시간 모니터링
            this.queue.enqueue({
              id: `subscribe-${pairAddr}-${Date.now()}`,
              type: 'subscribe',
              pairAddress: pairAddr,
              fromBlock: currentBlock + 1
            });

            console.log(`[FactoryCollector] Queued subscribe/backfill jobs for pair ${pairAddr}`);
          }
        } catch (error) {
          console.error(`Error processing PairCreated event:`, error);
        }
      }

      // 배치 처리 완료 후 마지막 블록 업데이트
      if (createdPairs.length > 0) {
        const maxBlock = Math.max(...createdPairs.map(p => p.blockNumber));
        await SwapRepository.updateLastProcessedBlock('pairs', maxBlock);
      } else if (toBlock >= fromBlock) {
        // 페어가 없어도 처리된 블록은 업데이트
        await SwapRepository.updateLastProcessedBlock('pairs', toBlock);
      }

      return createdPairs;
    } catch (error) {
      console.error(`Error collecting PairCreated events:`, error);
      throw error;
    }
  }

  /**
   * 최초 페어 생성 블록 찾기 (과거부터 스캔)
   */
  async findFirstPairCreatedBlock() {
    try {
      const currentBlock = await this.provider.getBlockNumber();
      let fromBlock = 0;
      let found = false;
      let firstBlock = null;

      while (fromBlock <= currentBlock && !found) {
        const toBlock = Math.min(fromBlock + this.blockRange - 1, currentBlock);
        
        try {
          const pairs = await this.collectPairCreatedEventsBatch(fromBlock, toBlock);
          if (pairs.length > 0) {
            // 첫 번째 페어가 생성된 블록 찾기
            const sortedPairs = pairs.sort((a, b) => a.blockNumber - b.blockNumber);
            firstBlock = sortedPairs[0].blockNumber;
            found = true;
            console.log(`First allowed pair created at block ${firstBlock}`);
          }
        } catch (error) {
          console.error(`Error scanning blocks ${fromBlock}-${toBlock}:`, error.message);
        }

        fromBlock = toBlock + 1;
      }

      return firstBlock;
    } catch (error) {
      console.error('Error finding first PairCreated block:', error);
      return null;
    }
  }
}

module.exports = { FactoryCollector };

