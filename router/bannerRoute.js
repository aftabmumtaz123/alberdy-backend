const express = require('express');
const router = express.Router();

const { createBanner, getBanner } = require('../controller/bannerController');


const Upload = require('../config/multer')



router.post("/", Upload.array("images") ,createBanner);
router.get("/", getBanner)

module.exports = router;
