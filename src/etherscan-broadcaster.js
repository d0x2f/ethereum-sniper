const got = require("got");

const { log } = require("./utils");

class EtherscanBroadcaster {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  async sendRawTransaction(transactionHex) {
    log("Sending transaction to Etherscan");
    return got("https://api.etherscan.io/api", {
      module: "proxy",
      action: "eth_sendRawTransaction",
      hex: transactionHex,
      apikey: this.apiKey,
    });
  }

  // Stub
  static close() {}
}

module.exports = EtherscanBroadcaster;
