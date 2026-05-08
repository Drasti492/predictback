const router = require("express").Router();
const ctrl   = require("../controllers/predictorAuthController");

router.post("/register",         ctrl.initiateRegister);
router.get("/status/:reference", ctrl.checkStatus);
router.post("/callback",         ctrl.paymentCallback);
router.post("/login",            ctrl.login);

module.exports = router;