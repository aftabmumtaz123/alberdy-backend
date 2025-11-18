const express = require('express');
const router = express.Router();
const {
  addInventory,
  getInventoryDashboard
} = require('../controller/inventoryController');



router.post('/add', addInventory);

router.get('/dashboard', getInventoryDashboard);
module.exports = router;

