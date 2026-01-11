const express = require('express');
const router = express.Router();

const { createBanner, getBanner, updateBanner } = require('../controller/bannerController');


const Upload = require('../config/multer')



router.post("/", Upload.array("images") ,createBanner);
router.get("/", getBanner);
router.put("/:id", Upload.array("images"), updateBanner);
module.exports = router;
