// server.js
require("dotenv").config();
const express = require("express");
const morgan = require("morgan");
const { connectDB } = require("./src/config/db");

const campaignRoutes = require("./src/routes/campaigns");

const app = express();
const PORT = process.env.PORT || 3000;

// Connect to MongoDB
connectDB();

// Middlewares
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));

// Routes
app.use("/api/campaigns", campaignRoutes);

// Health
app.get("/health", (req, res) =>
  res.json({ status: "ok", time: new Date().toISOString() })
);

// Error handler simple
app.use((err, req, res, next) => {
  console.error(err);
  res
    .status(err.status || 500)
    .json({ error: err.message || "Internal Server Error" });
});

// Start server
app.listen(PORT, () => {
  console.log(
    `Server running on http://localhost:${PORT} (env=${process.env.NODE_ENV})`
  );
});
