const { ethers } = require('ethers');

/**
 * Swap 이벤트에서 가격 계산
 * 가격은 token1/token0 비율로 계산됩니다
 */
async function calculatePrice(
  provider,
  token0,
  token1,
  amount0In,
  amount1In,
  amount0Out,
  amount1Out
) {
  try {
    // 실제 거래된 토큰 양 계산
    // Swap에서 amount0In > 0이면 token0를 넣고 token1을 받음
    // amount1In > 0이면 token1을 넣고 token0를 받음
    let amount0, amount1;
    
    if (amount0In > 0n && amount1Out > 0n) {
      // token0를 넣고 token1을 받음
      amount0 = amount0In;
      amount1 = amount1Out;
    } else if (amount1In > 0n && amount0Out > 0n) {
      // token1을 넣고 token0를 받음
      amount0 = amount0Out;
      amount1 = amount1In;
    } else {
      // 양방향 거래인 경우 (복잡한 라우팅)
      amount0 = amount0In > 0n ? amount0In : amount0Out;
      amount1 = amount1In > 0n ? amount1In : amount1Out;
    }

    // 가격 계산: token1/token0 (token0 1개당 token1 가격)
    // amount0가 0이면 가격을 계산할 수 없음
    if (amount0 === 0n) {
      return null;
    }

    // 가격 = amount1 / amount0
    // 18자리 소수점 정밀도로 계산
    const price = (BigInt(amount1) * BigInt(10 ** 18)) / BigInt(amount0);
    
    return price;
  } catch (error) {
    console.error('Error calculating price:', error);
    return null;
  }
}

/**
 * 볼륨 계산: (amount0In + amount0Out) * price
 */
function calculateVolume(amount0In, amount0Out, price) {
  try {
    // amount0In + amount0Out 계산
    const totalAmount0 = amount0In + amount0Out;
    
    if (totalAmount0 === 0n || !price || price === 0n) {
      return null;
    }

    // 볼륨 = (amount0In + amount0Out) * price
    // price는 이미 18 decimals로 계산되어 있음
    const volume = (totalAmount0 * price) / ethers.parseUnits('1', 18);
    
    return volume;
  } catch (error) {
    console.error('Error calculating volume:', error);
    return null;
  }
}

/**
 * 리저브에서 가격 계산
 */
function calculatePriceFromReserves(reserve0, reserve1) {
  try {
    if (reserve0 === 0n) {
      return null;
    }

    // 가격 = reserve1 / reserve0 (token0 1개당 token1 가격)
    const price = (BigInt(reserve1) * BigInt(10 ** 18)) / BigInt(reserve0);
    return price;
  } catch (error) {
    console.error('Error calculating price from reserves:', error);
    return null;
  }
}

module.exports = { calculatePrice, calculateVolume, calculatePriceFromReserves };

