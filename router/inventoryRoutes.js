const express = require('express');
const router = express.Router();
const {
  addInventory,
  getInventoryDashboard
} = require('../controller/inventoryController');



router.post('/add', addInventory);

router.get('/summary', getInventoryDashboard);
module.exports = router;