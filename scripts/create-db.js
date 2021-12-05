const sqlite3 = require("sqlite3");
const sqlite = require("sqlite");

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

  await db.close();
}

main();
