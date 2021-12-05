# Ethereum Sniper

This project watches the ethereum blockchain for deposits into addresses with a
known private key.

It then submits a transaction to withdraw that balance immediately.

It works by connecting to a web3 service (such as openethereum or geth) and
subscribing to 'new block' and 'new pending transaction' events.

It will then examine all transactions for transfers into plunderable addresses.

As soon as such a transaction is included in a block, it will submit a
new transaction to transfer the funds to a configured user-controlled address.

Note that there are evidently a lot of bots out there doing the same thing and
probably doing it in a much better way than this.

There are also front-running bots that will notice your profitable transaction
and duplicate it with a higher fee set so as to be mined in place of yours.

I've also noticed that a lot of these kind of sniper transactions aren't
published to the mempool, probably to avoid being front-run, but I suspect it's
also the miners doing this so they can plunder the eth within the same block.

# Quick Start

It is assumed you have access to a suitable web3 provider and a websocket
connection.

I strongly recommend a local fully synced openethereum or geth node because you
really want the lowest latency to the network as possible. You will need to
start geth with the following arguments `--ws --ws.api eth,net,web3`,
openethereum enables the right apis by default.

1. Install dependencies.

```
npm install
```

2. Create a new key database and populate it with some example keys.

```
npm run populate-db
```

3. Set your target address and web3 provider in `src/main.js`

```
const PILFER_ADDRESS = "YOUR_ADDRESS";
const WEB3_WEBSOCKET_ADDRESS = "ws://127.0.0.1:8546";
```

4. Start monitoring!

```
npm run start
```

# Key Database

Address and key pairs are stored in an sqlite database with the table schema:

```
CREATE TABLE pairs (
    address TEXT primary key collate nocase,
    key TEXT unique not null collate nocase
);
```

You can create a new database with the included scripts:

 - `npm run create-db` will create a new empty database.
 - `npm run populate-db` will populate the database with an example set of keys.
    - See `scripts/popluate-db.js` for ideas on creating keys.

# Output

The script will output processing times for each block that looks like this:

```
[2021-12-05T02:38:50.280Z] Received block #13743449 at T+3.28s
[2021-12-05T02:38:50.326Z] Processed block #13743449 in 46ms (w4b: 0)
```

- `[2021-12-05T02:38:50.280Z]`: The time of the log entry
- `Received block #13743449`: The block number being received and processed.
- `T+3.28s`: The amount of time between receiving the block and the timestamp
  the block was mined.
- `in 46ms`: The amount of time taken to process the block, including sending
  pilfer transactions.
- `(w4b: 0)`: The number of pilfer transactions waiting for a pending
  transaction to be included in a block.
  - If there are transactions waiting for a block, you may want to wait before
    quitting the script.
  - Pilfer transactions are automatically pruned after waiting for over 10
    minutes.

Every time a wallet with a known private key is funded and the script notices it
in the mempool, it will output a log showing the address and value like so. A
signed pilfer transaction is made immediately and sent as soon as this
transaction is included in a block.

```
[2021-12-04T19:20:23.811Z] Found mempool candidate 0x2b5ad5c4795c026514f8317c7a215e218dccd6cf, value: 0.003411872 eth
```

Similarly for plunderable transactions found within a block there is this log.
Transactions discovered this way are pilfered immediately.

```
[2021-12-04T19:49:46.430Z] Found block candidate 0x2b5ad5c4795c026514f8317c7a215e218dccd6cf, value: 0.0003961294087008 eth
```

If the wallet is not able to meet your configured minimum gas threshold (200
gwei by default), then the following will be logged and the opportunity ignored.
See the configuration section of `src/main.js` for options.

```
[2021-12-04T19:49:46.430Z] Not enough eth to cover fees, ignoring transaction to 0x2b5ad5c4795c026514f8317c7a215e218dccd6cf
```

When a pilfer transaction is sent you will see a large log entry like this.

```
[2021-12-04T22:40:25.925Z] Attempting pilfer:
link: https://etherscan.io/tx/0xdead...beef
manual: https://etherscan.io/pushTx?hex=0xabcd...abcd
{
  "to": "0x1337...cafe",
  "gasLimit": "21000",
  "gasPrice": "186.679136833 gwei",
  "value": "0.000980065468373437 eth",
  "nonce": 1281
}
```

- `link: https://etherscan.io/tx/0xdead...beef`: A link to the transaction on
etherscan
- `manual: https://etherscan.io/pushTx?hex=0xabcd...abcd`: A link to a
pre-filled manual submission page on etherscan.
- Also shown are the transaction parameters with nicely formatted values.

This will be logged upon a successful pilfer.

```
[2021-12-04T16:03:55.684Z] Pilfer of 1.958eth successful!
tx:0x43315e89b8b7f8eea44b21a54f44c91bc4cd3a903285e23a1fc1f89abaceecb7 (39ms).
```

Good luck :)