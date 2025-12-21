const { ethers } = require('ethers');
const { PairContract } = require('../contracts/pair.js');
const { SwapRepository } = require('../db/repository.js');
const { calculatePrice, calculateVolume } = require('../utils/priceCalculator.js');
const { getTokenDecimals, formatTokenAmount } = require('../utils/tokenUtils.js');
const { calculateTokenPrices } = require('../utils/tokenPriceCalculator.js');

class EventCollector {
    constructor(provider, pairAddresses = [], allowedTokens = [], config = null) {
        this.provider = provider;
        this.pairAddresses = new Set(pairAddresses);
        this.pairContracts = new Map();
        this.allowedTokens = new Set(allowedTokens.map(t => t.toLowerCase()));
        this.config = config; // weth9, usdt0, stable 포함
    }

    /**
     * 페어가 허용된 토큰 중 하나와 매칭되는지 확인
     */
    isAllowedPair(token0, token1) {
        if (this.allowedTokens.size === 0) {
            return true; // 허용된 토큰이 없으면 모두 허용
        }

        const t0 = token0.toLowerCase();
        const t1 = token1.toLowerCase();

        // 둘 중 하나라도 허용된 토큰이면 true
        return this.allowedTokens.has(t0) || this.allowedTokens.has(t1);
    }

    addPair(pairAddress) {
        if (!this.pairAddresses.has(pairAddress)) {
            this.pairAddresses.add(pairAddress);
            this.pairContracts.set(pairAddress, new PairContract(pairAddress, this.provider));
        }
    }

    async initializePairInfo(pairAddress) {
        if (!this.pairContracts.has(pairAddress)) {
            this.addPair(pairAddress);
        }

        const pairContract = this.pairContracts.get(pairAddress);
        const [token0, token1] = await Promise.all([
            pairContract.getToken0(),
            pairContract.getToken1()
        ]);

        if (token0 && token1) {
            // 페어 정보를 DB에 저장
            const pool = require('../db/connection.js');
            const conn = await pool.getConnection();
            try {
                await conn.query(
                    `INSERT INTO pairs (pairAddress, token0, token1) 
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE token0 = VALUES(token0), token1 = VALUES(token1)`,
                    [pairAddress, token0, token1]
                );
            } finally {
                conn.release();
            }
        }

        return { token0, token1 };
    }

    async processSwapEvent(log, block) {
        try {
            const pairAddress = log.address.toLowerCase();

            // 페어 정보 초기화 (DB에 없으면 생성)
            let pairInfo = await SwapRepository.getPairInfo(pairAddress);

            if (!pairInfo) {
                // 페어 정보가 DB에 없으면 초기화
                if (!this.pairContracts.has(pairAddress)) {
                    await this.initializePairInfo(pairAddress);
                }
                pairInfo = await SwapRepository.getPairInfo(pairAddress);
            }

            if (!pairInfo || !pairInfo.token0 || !pairInfo.token1) {
                console.warn(`Pair info not found for ${pairAddress}, skipping swap`);
                return;
            }

            const { token0, token1 } = pairInfo;

            // 허용된 토큰과의 페어인지 확인
            if (!this.isAllowedPair(token0, token1)) {
                return; // 허용되지 않은 페어는 무시
            }

            // Swap 이벤트 파싱
            const iface = new ethers.Interface([
                "event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)"
            ]);

            const parsedLog = iface.parseLog({
                topics: log.topics,
                data: log.data
            });

            if (!parsedLog) {
                return;
            }

            const {
                args: { sender, amount0In, amount1In, amount0Out, amount1Out, to }
            } = parsedLog;

            // 토큰 가격 계산 (GASSSSView 사용)
            let token0Price = null;
            let token1Price = null;
            
            if (this.config) {
                const prices = await calculateTokenPrices(
                    this.provider,
                    token0,
                    token1,
                    this.config,
                    block.number
                );
                token0Price = prices.token0Price;
                token1Price = prices.token1Price;
            }

            // Swap 이벤트에서 직접 가격 계산 (기존 로직)
            const price = await calculatePrice(
                this.provider,
                token0,
                token1,
                amount0In,
                amount1In,
                amount0Out,
                amount1Out
            );

            // 토큰 decimals 가져오기
            const [decimals0, decimals1] = await Promise.all([
                getTokenDecimals(token0, this.provider),
                getTokenDecimals(token1, this.provider)
            ]);

            // 볼륨 계산: (amount0In + amount0Out) * token0Price
            let volume = null;
            if (token0Price && token0Price > 0n) {
                const totalAmount0 = amount0In + amount0Out;
                if (totalAmount0 > 0n) {
                    // 볼륨 = (amount0In + amount0Out) * token0Price
                    // totalAmount0는 token0의 decimals를 가지고 있음
                    // token0Price는 18 decimals
                    // 결과는 18 decimals로 반환
                    volume = (totalAmount0 * token0Price) / ethers.parseUnits('1', decimals0);
                }
            }

            // formatUnits로 변환
            const swapData = {
                txHash: log.transactionHash,
                logIndex: log.index,
                blockNumber: block.number,
                timestamp: block.timestamp,
                pairAddress: pairAddress,
                token0: token0,
                token1: token1,
                amount0In: formatTokenAmount(amount0In, decimals0),
                amount1In: formatTokenAmount(amount1In, decimals1),
                amount0Out: formatTokenAmount(amount0Out, decimals0),
                amount1Out: formatTokenAmount(amount1Out, decimals1),
                to: to.toLowerCase(),
                price: price ? ethers.formatUnits(price, 18) : null,
                token0Price: token0Price ? ethers.formatUnits(token0Price, 18) : null,
                token1Price: token1Price ? ethers.formatUnits(token1Price, 18) : null,
                volume: volume ? ethers.formatUnits(volume, 18) : null
            };

            const inserted = await SwapRepository.insertSwap(swapData);
            if (inserted) {
                console.log(`✓ Swap saved: ${log.transactionHash} (block ${block.number})`);
            }
        } catch (error) {
            console.error(`Error processing swap event:`, error);
        }
    }


    async collectEvents(fromBlock, toBlock) {
        const swapFilter = {
            topics: [
                ethers.id("Swap(address,uint256,uint256,uint256,uint256,address)")
            ]
        };

        try {
            // 허용된 페어 주소 목록 가져오기
            const allowedPairAddresses = await this.getAllowedPairAddresses();

            // Swap 이벤트 수집 (허용된 페어만)
            const allSwapLogs = await this.provider.getLogs({
                ...swapFilter,
                fromBlock,
                toBlock
            });

            // 허용된 페어만 필터링
            const swapLogs = allSwapLogs.filter(log =>
                allowedPairAddresses.has(log.address.toLowerCase())
            );

            console.log(`Found ${swapLogs.length} swap events in blocks ${fromBlock}-${toBlock}`);

            // 블록 정보 캐시
            const blockCache = new Map();

            // Swap 이벤트 처리
            for (const log of swapLogs) {
                if (!blockCache.has(log.blockNumber)) {
                    const block = await this.provider.getBlock(log.blockNumber);
                    blockCache.set(log.blockNumber, block);
                }
                await this.processSwapEvent(log, blockCache.get(log.blockNumber));
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
        } catch (error) {
            console.error(`Error collecting events from blocks ${fromBlock}-${toBlock}:`, error);
            throw error;
        }
    }

    /**
     * 허용된 페어 주소 목록 가져오기
     */
    async getAllowedPairAddresses() {
        if (this.allowedTokens.size === 0) {
            return new Set(); // 모든 페어 허용
        }

        const pool = require('../db/connection.js');
        const conn = await pool.getConnection();
        try {
            const allowedTokensArray = Array.from(this.allowedTokens);
            const placeholders = allowedTokensArray.map(() => '?').join(',');

            const [rows] = await conn.query(
                `SELECT DISTINCT pairAddress FROM pairs 
         WHERE token0 IN (${placeholders}) OR token1 IN (${placeholders})`,
                [...allowedTokensArray, ...allowedTokensArray]
            );

            return new Set(rows.map(row => row.pairAddress.toLowerCase()));
        } finally {
            conn.release();
        }
    }
}

module.exports = { EventCollector };

