const { ethers } = require('ethers');
const PairABI = require('../abis/Pair.json');

class PairContract {
  constructor(address, provider) {
    this.address = address;
    this.contract = new ethers.Contract(address, PairABI, provider);
  }

  async getToken0() {
    try {
      return await this.contract.token0();
    } catch (error) {
      console.error(`Error getting token0 for pair ${this.address}:`, error);
      return null;
    }
  }

  async getToken1() {
    try {
      return await this.contract.token1();
    } catch (error) {
      console.error(`Error getting token1 for pair ${this.address}:`, error);
      return null;
    }
  }

  async getReserves() {
    try {
      const reserves = await this.contract.getReserves();
      return {
        reserve0: reserves[0],
        reserve1: reserves[1]
      };
    } catch (error) {
      console.error(`Error getting reserves for pair ${this.address}:`, error);
      return null;
    }
  }

  getContract() {
    return this.contract;
  }
}

module.exports = { PairContract };

