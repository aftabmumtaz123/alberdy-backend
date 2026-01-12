const express = require('express');
const router = express.Router();

const { createBanner, getBanner, updateBanner, deleteBanner } = require('../controller/bannerController');


const auth = require('../middleware/auth');
const requireRole = (roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, msg: 'Access denied' });
  }
  next();
};


const Upload = require('../config/multer')



router.post("/", Upload.array("images"), auth, requireRole(['admin']), createBanner);
router.get("/", getBanner);
router.put("/:id", Upload.array("images"), auth, requireRole(['admin']), updateBanner);
router.delete("/:id", auth, requireRole(['admin']), deleteBanner);
module.exports = router;
