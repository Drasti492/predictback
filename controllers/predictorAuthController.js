const jwt     = require("jsonwebtoken");
const axios   = require("axios");
const User    = require("../models/PredictorUser");
const Payment = require("../models/PredictorPayment");

const AMOUNT = 1;

function formatPhone(raw) {
  let p = raw.replace(/\s+/g, "").replace(/^0/, "254");
  if (p.startsWith("+")) p = p.slice(1);
  if (!/^254(7\d{8}|1\d{8})$/.test(p)) return null;
  return p;
}

function validatePin(pin) {
  if (!/^\d{4}$/.test(pin))       return "PIN must be exactly 4 digits";
  if (/^(\d)\1{3}$/.test(pin))    return "PIN too simple — avoid 1111";
  const d = pin.split("").map(Number);
  let a = true, de = true;
  for (let i = 1; i < 4; i++) {
    if (d[i] !== d[i-1]+1) a  = false;
    if (d[i] !== d[i-1]-1) de = false;
  }
  if (a || de) return "Avoid sequences like 1234 or 9876";
  return null;
}

// ================================================================
// INITIATE REGISTER — validate, send STK, save pending payment
// ================================================================
exports.initiateRegister = async (req, res) => {
  try {
    const { phone: rawPhone, pin, pin2 } = req.body;

    if (!rawPhone)      return res.status(400).json({ message: "Phone required" });
    if (!pin)           return res.status(400).json({ message: "PIN required" });
    if (!pin2)          return res.status(400).json({ message: "Please confirm your PIN" });
    if (pin !== pin2)   return res.status(400).json({ message: "PINs do not match" });

    const pinErr = validatePin(pin);
    if (pinErr)         return res.status(400).json({ message: pinErr });

    const phone = formatPhone(rawPhone);
    if (!phone)         return res.status(400).json({ message: "Enter a valid Kenyan number (07XX or 01XX)" });

    // Block if already registered
    const existing = await User.findOne({ phone });
    if (existing && existing.accessGranted) {
      return res.status(409).json({ message: "Account already exists. Please sign in." });
    }

    const reference = "PRED_" + Date.now() + "_" + Math.random().toString(36).substr(2,6).toUpperCase();

    // Save pending payment (stores pin temporarily until callback confirms)
    await Payment.create({ phone, pin, amount: AMOUNT, reference, status: "pending" });

    // Send STK push via PayHero
    await axios.post(
      `${process.env.PAYHERO_BASE_URL}/api/v2/payments`,
      {
        amount:             AMOUNT,
        phone_number:       phone,
        channel_id:         Number(process.env.PAYHERO_CHANNEL_ID),
        provider:           "m-pesa",
        external_reference: reference,
        callback_url:       process.env.PAYHERO_CALLBACK_URL
      },
      {
        headers: {
          Authorization:  `Basic ${process.env.PAYHERO_BASIC_AUTH}`,
          "Content-Type": "application/json"
        },
        timeout: 15000
      }
    );

    console.log(`📲 STK sent — ${phone} — ref: ${reference}`);
    res.json({ message: "M-Pesa prompt sent. Enter your M-Pesa PIN.", reference });

  } catch (err) {
    console.error("initiateRegister error:", err.response?.data || err.message);
    res.status(500).json({ message: "Failed to send payment prompt. Try again." });
  }
};

// ================================================================
// CHECK REGISTRATION STATUS — frontend polls this
// ================================================================
exports.checkStatus = async (req, res) => {
  try {
    const { reference } = req.params;
    const payment = await Payment.findOne({ reference });
    if (!payment) return res.status(404).json({ status: "not_found" });

    if (payment.status === "success") {
      const user = await User.findOne({ phone: payment.phone });
      if (!user || !user.accessGranted) {
        return res.json({ status: "pending" });
      }
      const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "30d" });
      return res.json({ status: "success", token });
    }

    if (payment.status === "failed") {
      return res.json({ status: "failed" });
    }

    return res.json({ status: "pending" });

  } catch (err) {
    console.error("checkStatus error:", err.message);
    res.status(500).json({ message: "Status check failed" });
  }
};

// ================================================================
// PAYHERO CALLBACK — PayHero calls this after payment
// ================================================================
exports.paymentCallback = async (req, res) => {
  try {
    const body = req.body;
    const ref  = body?.response?.ExternalReference || body?.ExternalReference;
    const code = body?.response?.ResultCode ?? body?.ResultCode;

    console.log("📩 Predictor callback:", JSON.stringify(body).slice(0, 400));
    if (!ref) return res.sendStatus(400);

    const payment = await Payment.findOne({ reference: ref });
    if (!payment) return res.sendStatus(404);
    if (payment.status !== "pending") return res.sendStatus(200);

    if (code === 0 || code === "0") {
      payment.status = "success";
      await payment.save();

      // Create or update user — only now is account activated
      await User.findOneAndUpdate(
        { phone: payment.phone },
        {
          phone:         payment.phone,
          pin:           payment.pin,
          accessGranted: true,
          reference:     ref
        },
        { upsert: true, new: true }
      );

      console.log(`✅ Predictor access granted: ${payment.phone}`);
    } else {
      payment.status = "failed";
      await payment.save();
      console.log(`❌ Payment failed — ref: ${ref} — account NOT created`);
    }

    res.sendStatus(200);

  } catch (err) {
    console.error("Callback error:", err.message);
    res.sendStatus(500);
  }
};

// ================================================================
// LOGIN
// ================================================================
exports.login = async (req, res) => {
  try {
    const { phone: rawPhone, pin } = req.body;
    if (!rawPhone || !pin) return res.status(400).json({ message: "Phone and PIN required" });

    const phone = formatPhone(rawPhone);
    if (!phone) return res.status(400).json({ message: "Invalid phone number" });

    const user = await User.findOne({ phone }).select("+pin");
    if (!user || !user.accessGranted) {
      return res.status(400).json({ message: "No active account found. Please register and pay to access." });
    }

    if (user.pin !== pin) {
      return res.status(400).json({ message: "Incorrect PIN. Try again." });
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "30d" });
    console.log(`🔐 Predictor login: ${phone}`);
    res.json({ token });

  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ message: "Login failed. Try again." });
  }
};