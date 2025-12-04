// src/services/streamUtils.js
const { Readable } = require("stream");

function streamFromBuffer(buf) {
  const stream = new Readable();
  stream.push(buf);
  stream.push(null);
  return stream;
}

module.exports = { streamFromBuffer };
