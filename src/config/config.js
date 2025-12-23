const path = require('path');
const fs = require('fs');

function loadConfig(network = 'testnet') {
  const configPath = path.join(__dirname, network, 'contracts.json');
  
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  
  return {
    factory: config.UniswapV2Factory,
    factoryDeployBlock: config.FactoryDeployBlock || 0,
    weth9: config.gUSDT,
    usdt0: config.USDT0,
    stable: config.STABLE,
    gassssView: config.GASSSSView,
    allowedTokens: [
      config.gUSDT,
      config.USDT0,
      config.STABLE
    ].filter(Boolean) // null/undefined 제거
  };
}

module.exports = { loadConfig };

