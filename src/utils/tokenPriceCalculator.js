const { ethers } = require('ethers');

/**
 * GASSSSView 컨트랙트를 통해 토큰 가격 가져오기
 * @param {*} provider 
 * @param {string} tokenAddress - 토큰 주소
 * @param {string} gassssViewAddress - GASSSSView 컨트랙트 주소
 * @param {number} blockTag - 블록 번호 (blockTag)
 * @returns {Promise<bigint>} - 가격 (18 decimals), 에러 시 0 반환
 */
async function getTokenPrice(provider, tokenAddress, gassssViewAddress, blockTag) {
  try {
    // USDT나 WETH 토큰이면 가격 1로 가정
    // (config에서 확인해야 하지만 여기서는 일단 체크하지 않음)
    
    const GASSSSViewABI = [
      "function getTokenPrice(address token) external view returns (uint256 price)"
    ];

    const contract = new ethers.Contract(gassssViewAddress, GASSSSViewABI, provider);
    
    // blockTag를 사용하여 특정 블록의 상태로 조회
    const price = await contract.getTokenPrice(tokenAddress, { blockTag });
    
    return price;
  } catch (error) {
    // 배포 안되어 있거나 에러 발생 시 0 반환
    console.warn(`Error getting token price for ${tokenAddress} at block ${blockTag}:`, error.message);
    return 0n;
  }
}

/**
 * Swap 이벤트에서 토큰 가격 계산
 * @param {*} provider 
 * @param {string} token0 
 * @param {string} token1 
 * @param {object} config - 설정 (weth9, usdt0, gassssView)
 * @param {number} blockTag - 블록 번호
 * @returns {Promise<{token0Price: bigint, token1Price: bigint}>}
 */
async function calculateTokenPrices(provider, token0, token1, config, blockTag) {
  try {
    const weth = config.weth9?.toLowerCase();
    const usdt0 = config.usdt0?.toLowerCase();
    const gassssView = config.gassssView;
    
    const token0Lower = token0.toLowerCase();
    const token1Lower = token1.toLowerCase();

    // USDT나 WETH 토큰이면 가격 1로 가정
    let price0, price1;

    if (token0Lower === weth || token0Lower === usdt0) {
      price0 = ethers.parseUnits('1', 18);
    } else {
      price0 = await getTokenPrice(provider, token0, gassssView, blockTag);
    }

    if (token1Lower === weth || token1Lower === usdt0) {
      price1 = ethers.parseUnits('1', 18);
    } else {
      price1 = await getTokenPrice(provider, token1, gassssView, blockTag);
    }

    return {
      token0Price: price0,
      token1Price: price1
    };
  } catch (error) {
    console.error('Error calculating token prices:', error);
    return {
      token0Price: 0n,
      token1Price: 0n
    };
  }
}

module.exports = { getTokenPrice, calculateTokenPrices };

