const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  phone:     { type: String, required: true },
  pin:       { type: String, required: true },
  amount:    { type: Number, required: true },
  reference: { type: String, unique: true, required: true },
  status:    { type: String, enum: ["pending","success","failed"], default: "pending" }
}, { timestamps: true });

module.exports = mongoose.model("PredictorPayment", schema);