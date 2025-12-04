// src/models/SentEmailLog.js
const mongoose = require("mongoose");

const SentEmailLogSchema = new mongoose.Schema(
  {
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      required: true,
    },
    contactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contact",
      required: true,
    },
    sequence: { type: Number, required: true },
    sentAt: { type: Date, default: Date.now },
    messageId: String,
    status: {
      type: String,
      enum: ["queued", "delivered", "failed"],
      default: "queued",
    },
    error: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model("SentEmailLog", SentEmailLogSchema);
