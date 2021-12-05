/*
  This script acts as an example method to generate keys which might be used
  accidentally or otherwise.
  I encourage you to think of your own methods of generating keys and make your
  database as large as possible.
  I've run with a database of over 200GB with no noticeable performance impact.
*/

const { isValidPrivate, privateToAddress } = require("ethereumjs-util");
const sqlite = require("sqlite");
const sqlite3 = require("sqlite3");

async function insertWithFill(statement, fill) {
  const buffer = Buffer.alloc(32, fill);
  if (isValidPrivate(buffer)) {
    const key = `0x${buffer.toString("hex")}`;
    const address = `0x${privateToAddress(buffer).toString("hex")}`;
    console.log(key);
    await statement.run(address, key);
  }
}

async function insert16bAtOffset(db, statement, offset) {
  const buffer = Buffer.alloc(32);
  await db.run("BEGIN");
  for (let i = 0; i < 2 ** 16; i += 1) {
    buffer.fill(0);
    buffer.writeUIntLE(i, offset, 2);
    if (isValidPrivate(buffer)) {
      const key = `0x${buffer.toString("hex")}`;
      const address = `0x${privateToAddress(buffer).toString("hex")}`;
      console.log(key);
      await statement.run(address, key);
    }
  }
  await db.run("COMMIT");
}

async function main() {
  const db = await sqlite.open({
    filename: "./keys.db",
    driver: sqlite3.Database,
  });

  await db.exec(
    `
      CREATE TABLE IF NOT EXISTS pairs (
        address TEXT primary key collate nocase,
        key TEXT unique not null collate nocase
      )
    `
  );
  const statement = await db.prepare(
    "INSERT OR IGNORE INTO pairs VALUES (?, ?)"
  );

  // 0x0001 to 0xffff
  await insert16bAtOffset(db, statement, 30);

  // 0x0101...0101, 0x0202...0202 etc.
  for (let fill = 1; fill < 256; fill += 1) {
    await insertWithFill(statement, fill);
  }

  await statement.finalize();
  await db.close();
}

main();
