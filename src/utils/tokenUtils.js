const { ethers } = require('ethers');

// ERC20 표준 ABI (decimals만 필요)
const ERC20_ABI = [
  {
    constant: true,
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', type: 'uint8' }],
    type: 'function'
  }
];

// 토큰 decimals 캐시
const decimalsCache = new Map();

/**
 * 토큰의 decimals를 가져옵니다 (캐시 사용)
 */
async function getTokenDecimals(tokenAddress, provider) {
  const address = tokenAddress.toLowerCase();
  
  if (decimalsCache.has(address)) {
    return decimalsCache.get(address);
  }

  try {
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const decimals = await tokenContract.decimals();
    decimalsCache.set(address, decimals);
    return decimals;
  } catch (error) {
    // 기본값으로 18 사용 (대부분의 토큰이 18 decimals)
    console.warn(`Failed to get decimals for token ${tokenAddress}, using default 18:`, error.message);
    decimalsCache.set(address, 18);
    return 18;
  }
}

/**
 * Wei 값을 formatUnits로 변환합니다
 */
function formatTokenAmount(amount, decimals) {
  try {
    if (!amount || amount === 0n) {
      return '0';
    }
    return ethers.formatUnits(amount, decimals);
  } catch (error) {
    console.error('Error formatting token amount:', error);
    return '0';
  }
}

module.exports = { getTokenDecimals, formatTokenAmount };

