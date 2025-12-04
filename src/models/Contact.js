// src/models/Contact.js
const mongoose = require("mongoose");

const ContactSchema = new mongoose.Schema(
  {
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      index: true,
      required: true,
    },
    email: { type: String, required: true, index: true },
    fields: { type: Object, default: {} }, // keys from CSV headers (first_name, company, etc.)
    status: {
      type: String,
      enum: ["pending", "sent", "replied", "bounced", "unsubscribed"],
      default: "pending",
    },
    lastSentAt: Date,
    lastMessageId: String,
    metadata: { type: Object, default: {} },
  },
  { timestamps: true }
);

// Optional compound index to prevent duplicates per campaign
ContactSchema.index({ campaignId: 1, email: 1 }, { unique: true });

module.exports = mongoose.model("Contact", ContactSchema);
