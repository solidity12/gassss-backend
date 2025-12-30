const { ethers } = require('ethers');
const dotenv = require('dotenv');
const { initializeDatabase } = require('./db/schema.js');
const { SwapRepository } = require('./db/repository.js');
const { EventCollector } = require('./services/eventCollector.js');
const { FactoryCollector } = require('./services/factoryCollector.js');
const { Queue } = require('./services/queue.js');
const { PairWorker } = require('./services/pairWorker.js');
const { loadConfig } = require('./config/config.js');
const path = require("path");

const env = process.env.NODE_ENV || "dev";

dotenv.config({
  path: env === "prod"
    ? path.resolve(process.cwd(), ".env.prod")
    : path.resolve(process.cwd(), ".env")
});

console.log("NODE_ENV =", env);

const RPC_URL = process.env.RPC_URL;
const BLOCK_RANGE = parseInt(process.env.BLOCK_RANGE || '10000');
const START_BLOCK = process.env.START_BLOCK ? parseInt(process.env.START_BLOCK) : null;
const NETWORK = process.env.NETWORK || 'testnet';
console.log("RPC_URL", RPC_URL)
console.log("BLOCK_RANGE", BLOCK_RANGE)
console.log("START_BLOCK", START_BLOCK)
console.log("NETWORK", NETWORK)

class DEXDataCollector {
  constructor() {
    this.provider = null;
    this.eventCollector = null;
    this.factoryCollector = null;
    this.queue = null;
    this.pairWorker = null;
    this.config = null;
    this.isRunning = false;
    this.currentBlock = null;
    this.latestProcessedBlock = null;
  }

  async initialize() {
    console.log('Initializing DEX Data Collector...');
    
    // 설정 로드
    this.config = loadConfig(NETWORK);
    console.log(`✓ Config loaded for ${NETWORK}`);
    console.log(`  Factory: ${this.config.factory}`);
    console.log(`  Allowed tokens: ${this.config.allowedTokens.join(', ')}`);
    
    // 데이터베이스 초기화
    await initializeDatabase();
    console.log('✓ Database initialized');

    // Provider 연결
    this.provider = new ethers.JsonRpcProvider(RPC_URL);
    console.log(`✓ Connected to RPC: ${RPC_URL}`);

    // 큐 초기화
    this.queue = new Queue();
    console.log('✓ Queue initialized');

    // EventCollector 초기화 (허용된 토큰 및 설정 전달)
    this.eventCollector = new EventCollector(
      this.provider,
      [],
      this.config.allowedTokens,
      {
        weth9: this.config.weth9,
        usdt0: this.config.usdt0,
        stable: this.config.stable,
        gassssView: this.config.gassssView
      }
    );
    console.log('✓ Event collector initialized');

    // PairWorker 초기화
    this.pairWorker = new PairWorker(
      this.provider,
      this.eventCollector,
      this.queue
    );
    console.log('✓ Pair worker initialized');

    // FactoryCollector 초기화 (큐 및 블록 범위 전달)
    this.factoryCollector = new FactoryCollector(
      this.provider,
      this.config.factory,
      this.config.allowedTokens,
      this.queue,
      BLOCK_RANGE
    );
    console.log('✓ Factory collector initialized');

    // Factory에서 PairCreated 이벤트 수집 및 시작 블록 결정
    await this.initializePairs();
  }

  async initializePairs() {
    console.log('\n=== Initializing Pairs from Factory ===');
    
    const factoryDeployBlock = this.config.factoryDeployBlock || 0;
    const currentBlock = await this.provider.getBlockNumber();
    
    // 마지막 처리된 블록 가져오기
    const lastProcessedBlock = await SwapRepository.getLastProcessedBlock('pairs');
    const fromBlock = lastProcessedBlock 
      ? lastProcessedBlock + 1  // 마지막 처리 블록 다음부터
      : Math.max(factoryDeployBlock, 0);  // 처음이면 배포 블록부터
    
    if (fromBlock <= currentBlock) {
      console.log(`Collecting PairCreated events from block ${fromBlock} to ${currentBlock}...`);
      
      // PairCreated 이벤트 수집 (새 페어는 자동으로 큐에 추가됨)
      await this.factoryCollector.collectPairCreatedEvents(fromBlock, currentBlock);
      
      // 처리된 블록 업데이트
      if (currentBlock > 0) {
        await SwapRepository.updateLastProcessedBlock('pairs', currentBlock);
      }
    } else {
      console.log(`No new blocks to process (last processed: ${lastProcessedBlock}, current: ${currentBlock})`);
    }
    
      // 시작 블록 결정
      if (START_BLOCK) {
        this.latestProcessedBlock = START_BLOCK - 1;
        console.log(`✓ Starting from configured block: ${START_BLOCK}`);
      } else {
        // DB에서 마지막 처리된 블록 가져오기
        const latestBlock = await SwapRepository.getLatestProcessedBlock();
        if (latestBlock) {
          this.latestProcessedBlock = latestBlock;
          console.log(`✓ Resuming from block: ${latestBlock + 1}`);
        } else {
          // Factory 배포 블록부터 시작
          this.latestProcessedBlock = Math.max(factoryDeployBlock - 1, 0);
          console.log(`✓ Starting from factory deploy block: ${factoryDeployBlock}`);
        }
      }
  }

  async processHistoricalBlocks() {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    console.log('\n=== Processing Historical Blocks ===');

    try {
      const currentBlock = await this.provider.getBlockNumber();
      let fromBlock = this.latestProcessedBlock + 1;
      let toBlock = Math.min(fromBlock + BLOCK_RANGE - 1, currentBlock);

      while (fromBlock <= currentBlock) {
        console.log(`\nProcessing blocks ${fromBlock} to ${toBlock}...`);
        
        try {
          // Factory에서 새로운 페어 생성 확인 (주기적으로)
          if (fromBlock % (BLOCK_RANGE * 10) === 0 || fromBlock === this.latestProcessedBlock + 1) {
            await this.factoryCollector.collectPairCreatedEvents(fromBlock, toBlock);
          }
          
          const result = await this.eventCollector.collectEvents(fromBlock, toBlock);
          console.log(`Processed: ${result.swaps} swaps, ${result.syncs} syncs`);
          
          this.latestProcessedBlock = toBlock;
          
          // 다음 범위로 이동
          fromBlock = toBlock + 1;
          toBlock = Math.min(fromBlock + BLOCK_RANGE - 1, currentBlock);
          
          // 짧은 딜레이로 RPC 부하 방지
          await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
          console.error(`Error processing blocks ${fromBlock}-${toBlock}:`, error.message);
          
          // 에러 발생 시 블록 범위를 줄여서 재시도
          const smallerRange = Math.floor(BLOCK_RANGE / 2);
          if (smallerRange > 0) {
            toBlock = Math.min(fromBlock + smallerRange - 1, currentBlock);
            console.log(`Retrying with smaller range: ${fromBlock} to ${toBlock}`);
            await new Promise(resolve => setTimeout(resolve, 10000));
          } else {
            // 범위가 너무 작으면 다음 블록으로 이동
            fromBlock = toBlock + 1;
            toBlock = Math.min(fromBlock + BLOCK_RANGE - 1, currentBlock);
          }
        }
      }

      console.log('\n✓ Historical blocks processed');
      this.isRunning = false;
    } catch (error) {
      console.error('Error in processHistoricalBlocks:', error);
      this.isRunning = false;
      throw error;
    }
  }

  async startRealtimeMonitoring() {
    console.log('\n=== Starting Real-time Monitoring ===');
    
    // 최신 블록부터 실시간 모니터링 시작
    this.currentBlock = await this.provider.getBlockNumber();
    
    // Provider에 새 블록 리스너 등록
    this.provider.on('block', async (blockNumber) => {
      if (this.isRunning) {
        return;
      }

      try {
        this.isRunning = true;
        const fromBlock = this.latestProcessedBlock + 1;
        const toBlock = blockNumber;

        if (fromBlock <= toBlock) {
          console.log(`\nNew block detected: ${blockNumber}`);
          
          // 먼저 Factory에서 새로운 페어 생성 확인 (새 페어는 자동으로 큐에 추가됨)
          const newPairs = await this.factoryCollector.collectPairCreatedEvents(fromBlock, toBlock);
          if (newPairs.length > 0) {
            console.log(`Found ${newPairs.length} new pair(s) created - jobs queued`);
          }
          
          // 이벤트 수집
          console.log(`Processing blocks ${fromBlock} to ${toBlock}...`);
          const result = await this.eventCollector.collectEvents(fromBlock, toBlock);
          console.log(`Processed: ${result.swaps} swaps, ${result.syncs} syncs`);
          
          this.latestProcessedBlock = toBlock;
        }
      } catch (error) {
        console.error(`Error processing new block ${blockNumber}:`, error);
      } finally {
        this.isRunning = false;
      }
    });

    console.log('✓ Real-time monitoring started');
  }

  async start() {
    try {
      await this.initialize();
      
      // PairWorker 시작
      this.pairWorker.start();
      
      // 과거 블록 처리
      await this.processHistoricalBlocks();
      
      // 실시간 모니터링 시작
      await this.startRealtimeMonitoring();
      
      // 큐 상태 모니터링
      this.startQueueMonitoring();
      
      console.log('\n✓ DEX Data Collector is running...');
      console.log('Press Ctrl+C to stop\n');
    } catch (error) {
      console.error('Fatal error:', error);
      process.exit(1);
    }
  }

  startQueueMonitoring() {
    // 30초마다 큐 상태 출력
    setInterval(() => {
      const status = this.queue.getStatus();
      if (status.total > 0) {
        console.log(`[Queue Status] Queued: ${status.queued}, Processing: ${status.processing}, Total: ${status.total}`);
      }
    }, 30000);
  }

  async stop() {
    console.log('\nStopping DEX Data Collector...');
    this.isRunning = false;
    
    // PairWorker 중지
    if (this.pairWorker) {
      await this.pairWorker.stop();
    }
    
    if (this.provider) {
      this.provider.removeAllListeners();
    }
    
    console.log('✓ Stopped');
    process.exit(0);
  }
}

// 애플리케이션 시작
const collector = new DEXDataCollector();

// Graceful shutdown
process.on('SIGINT', async () => {
  await collector.stop();
});

process.on('SIGTERM', async () => {
  await collector.stop();
});

// 에러 핸들링
process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

// 애플리케이션 시작
collector.start().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});

