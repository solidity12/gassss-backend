const { EventCollector } = require('./eventCollector.js');
const { SwapRepository } = require('../db/repository.js');

/**
 * 페어별 Subscribe/Backfill 작업을 처리하는 워커
 */
class PairWorker {
  constructor(provider, eventCollector, queue) {
    this.provider = provider;
    this.eventCollector = eventCollector;
    this.queue = queue;
    this.isRunning = false;
    this.workers = [];
    this.workerCount = 2; // 동시에 처리할 워커 수
  }

  /**
   * 워커 시작
   */
  start() {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    console.log(`[PairWorker] Starting ${this.workerCount} workers...`);

    for (let i = 0; i < this.workerCount; i++) {
      this.workers.push(this.work(i));
    }
  }

  /**
   * 워커 중지
   */
  async stop() {
    this.isRunning = false;
    console.log('[PairWorker] Stopping workers...');
    await Promise.all(this.workers);
    console.log('[PairWorker] All workers stopped');
  }

  /**
   * 워커 메인 루프
   */
  async work(workerId) {
    console.log(`[PairWorker-${workerId}] Worker started`);

    while (this.isRunning) {
      try {
        const job = this.queue.dequeue();

        if (!job) {
          // 큐가 비어있으면 잠시 대기
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }

        console.log(`[PairWorker-${workerId}] Processing job: ${job.type} - ${job.pairAddress}`);

        try {
          await this.processJob(job, workerId);
          this.queue.complete(job.id || job.pairAddress);
          console.log(`[PairWorker-${workerId}] Job completed: ${job.type} - ${job.pairAddress}`);
        } catch (error) {
          console.error(`[PairWorker-${workerId}] Job failed: ${job.type} - ${job.pairAddress}`, error);
          this.queue.fail(job);
        }
      } catch (error) {
        console.error(`[PairWorker-${workerId}] Worker error:`, error);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    console.log(`[PairWorker-${workerId}] Worker stopped`);
  }

  /**
   * 작업 처리
   */
  async processJob(job, workerId) {
    switch (job.type) {
      case 'subscribe':
        await this.subscribePair(job.pairAddress, job.fromBlock, workerId);
        break;
      case 'backfill':
        await this.backfillPair(job.pairAddress, job.fromBlock, job.toBlock, workerId);
        break;
      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }
  }

  /**
   * 페어 구독 (실시간 모니터링)
   */
  async subscribePair(pairAddress, fromBlock, workerId) {
    console.log(`[PairWorker-${workerId}] Subscribing to pair: ${pairAddress} from block ${fromBlock}`);
    
    // 페어를 EventCollector에 추가
    this.eventCollector.addPair(pairAddress);
    
    // 페어 정보 초기화
    await this.eventCollector.initializePairInfo(pairAddress);
    
    console.log(`[PairWorker-${workerId}] Subscribed to pair: ${pairAddress}`);
  }

  /**
   * 페어 백필 (과거 이벤트 수집)
   */
  async backfillPair(pairAddress, fromBlock, toBlock, workerId) {
    console.log(`[PairWorker-${workerId}] Backfilling pair: ${pairAddress} from block ${fromBlock} to ${toBlock}`);
    
    const BLOCK_RANGE = 1000;
    let currentFrom = fromBlock;
    let currentTo = Math.min(currentFrom + BLOCK_RANGE - 1, toBlock);

    while (currentFrom <= toBlock) {
      try {
        console.log(`[PairWorker-${workerId}] Backfilling blocks ${currentFrom}-${currentTo} for pair ${pairAddress}`);
        
        // 특정 페어의 이벤트만 수집
        const result = await this.collectPairEvents(pairAddress, currentFrom, currentTo);
        
        console.log(`[PairWorker-${workerId}] Backfilled: ${result.swaps} swaps, ${result.syncs} syncs for pair ${pairAddress}`);
        
        currentFrom = currentTo + 1;
        currentTo = Math.min(currentFrom + BLOCK_RANGE - 1, toBlock);
        
        // RPC 부하 방지
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`[PairWorker-${workerId}] Error backfilling blocks ${currentFrom}-${currentTo}:`, error);
        
        // 에러 발생 시 블록 범위를 줄여서 재시도
        const smallerRange = Math.floor(BLOCK_RANGE / 2);
        if (smallerRange > 0) {
          currentTo = Math.min(currentFrom + smallerRange - 1, toBlock);
          await new Promise(resolve => setTimeout(resolve, 2000));
        } else {
          currentFrom = currentTo + 1;
          currentTo = Math.min(currentFrom + BLOCK_RANGE - 1, toBlock);
        }
      }
    }

    console.log(`[PairWorker-${workerId}] Backfill completed for pair: ${pairAddress}`);
  }

  /**
   * 특정 페어의 이벤트 수집
   */
  async collectPairEvents(pairAddress, fromBlock, toBlock) {
    const swapFilter = {
      address: pairAddress.toLowerCase(),
      topics: [
        require('ethers').id("Swap(address,uint256,uint256,uint256,uint256,address)")
      ],
      fromBlock,
      toBlock
    };

    const swapLogs = await this.provider.getLogs(swapFilter);

    // 블록 정보 캐시
    const blockCache = new Map();

    // Swap 이벤트 처리
    for (const log of swapLogs) {
      if (!blockCache.has(log.blockNumber)) {
        const block = await this.provider.getBlock(log.blockNumber);
        blockCache.set(log.blockNumber, block);
      }
      await this.eventCollector.processSwapEvent(log, blockCache.get(log.blockNumber));
    }

    // 처리된 블록 중 가장 큰 블록 번호로 업데이트
    const processedBlocks = Array.from(blockCache.keys());
    if (processedBlocks.length > 0) {
      const maxBlock = Math.max(...processedBlocks);
      await SwapRepository.updateLastProcessedBlock('swaps', maxBlock);
    }

    return {
      swaps: swapLogs.length,
      syncs: 0
    };
  }
}

module.exports = { PairWorker };

