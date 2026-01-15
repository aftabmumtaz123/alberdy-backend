const express = require('express');
const router = express.Router();

const { createBanner, getBanner, updateBanner, deleteBanner, getBannerById } = require('../controller/bannerController');


const auth = require('../middleware/auth');
const requireRole = (roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, msg: 'Access denied' });
  }
  next();
};


const Upload = require('../config/multer')



router.post("/", Upload.single("image"), auth, requireRole(['Super Admin']), createBanner);
router.get("/", getBanner);
router.get("/:id", getBannerById);
router.put("/:id", Upload.single("image"), auth, requireRole(['Super Admin']), updateBanner);
router.delete("/:id", auth, requireRole(['Super Admin']), deleteBanner);
module.exports = router;
