const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  phone:         { type: String, unique: true, required: true, trim: true },
  pin:           { type: String, required: true, select: false },
  accessGranted: { type: Boolean, default: false },
  reference:     { type: String }
}, { timestamps: true });

module.exports = mongoose.model("PredictorUser", schema);