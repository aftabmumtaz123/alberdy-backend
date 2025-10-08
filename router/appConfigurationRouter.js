const express = require("express");
const router = express.Router();
const upload = require("../config/multer");


// Auth and role middleware
const authMiddleware = require('../middleware/auth');
const requireRole = (roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, msg: 'Access denied' });
  }
  next();
};

const {
  // createAppConfiguration,
  updateAppConfiguration,
  getAppConfigurationById
} = require("../controller/appConfigurationController");

// Create new configuration
// router.post("/set", authMiddleware, upload.single("appLogo"), createAppConfiguration);

// Update configuration
router.put("/set/:id", authMiddleware, requireRole(['Super Admin', 'Manager']), upload.single("appLogo"), updateAppConfiguration);

// Get configuration (no file upload needed)
router.get("/get/:id", authMiddleware, requireRole(['Super Admin', 'Manager']), getAppConfigurationById);

module.exports = router;
