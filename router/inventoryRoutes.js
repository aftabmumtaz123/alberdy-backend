const express = require('express');
const router = express.Router();
const {
  addInventory
} = require('../controller/inventoryController');



router.post('/add', addInventory);
module.exports = router;

