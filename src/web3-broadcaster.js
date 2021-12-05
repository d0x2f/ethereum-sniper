const Web3 = require("web3");

const { log } = require("./utils");

class Web3Broadcaster {
  constructor(name, connectionString) {
    this.web3 = new Web3(connectionString);
    this.name = name;
  }

  async sendRawTransaction(hex) {
    log(`Sending transaction to ${this.name}`);
    return this.web3.eth.sendSignedTransaction(hex);
  }
}

module.exports = Web3Broadcaster;
