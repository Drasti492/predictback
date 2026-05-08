require("dotenv").config();
const express  = require("express");
const mongoose = require("mongoose");
const cors     = require("cors");
const jwt      = require("jsonwebtoken");
const axios    = require("axios");

if (!process.env.JWT_SECRET) { console.error("❌ JWT_SECRET missing"); process.exit(1); }
if (!process.env.MONGO_URI)  { console.error("❌ MONGO_URI missing");  process.exit(1); }

const app = express();

const allowedOrigins = [
  "https://your-predictor-frontend.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:5500"
];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) callback(null, true);
    else callback(new Error("CORS blocked"));
  },
  methods: ["GET","POST","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"],
  credentials: true
}));
app.use(cors());
app.use(express.json());

// ── Auth middleware ──────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Unauthorized" });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ message: "Invalid token" }); }
}

// ── Routes ───────────────────────────────────────────────────────
app.use("/api/auth", require("./routes/predictorAuthRoutes"));

app.get("/health", (req, res) =>
  res.json({ status: "ok", db: mongoose.connection.readyState })
);

// Protected — proxy crash data from main aviator backend
app.get("/api/predictor/next", authMiddleware, async (req, res) => {
  try {
    const { data } = await axios.get(
      "https://aviator-9raf.onrender.com/api/predictor/next",
      { timeout: 5000 }
    );
    res.json(data);
  } catch (err) {
    res.status(502).json({ message: "Game engine unavailable. Try again." });
  }
});

// ── Database ─────────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Predictor DB connected"))
  .catch(err => { console.error("❌ DB error:", err.message); process.exit(1); });

mongoose.connection.on("error", err =>
  console.error("❌ DB runtime error:", err.message)
);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🔮 Predictor server running on port ${PORT}`));