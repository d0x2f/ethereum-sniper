// Prints a log message that includes a timestamp.
function log(msg) {
  const date = new Date().toISOString();
  console.log(`[${date}] ${msg}`);
}

module.exports = { log };
