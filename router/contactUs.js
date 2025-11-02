const express = require("express");
const router = express.Router();
const contactUsController = require("../controller/contactUs");

router.post("/", contactUsController.submitContactForm);
router.get("/", contactUsController.getAllContacts);


module.exports = router;
