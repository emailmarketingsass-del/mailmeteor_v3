// worker.js
require("dotenv").config();

// connect DB (this uses your src/config/db.js connectDB export)
const { connectDB } = require("./src/config/db");

// Make sure DB connects before starting Agenda
(async () => {
  try {
    await connectDB();
    // require agenda module which defines and starts agenda
    const agenda = require("./src/config/agenda");
    console.log("Worker started - Agenda should be running");
  } catch (err) {
    console.error("Worker failed to start", err);
    process.exit(1);
  }
})();
