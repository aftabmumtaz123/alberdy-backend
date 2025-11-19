// routes/inventory.js
const express = require('express');
const router = express.Router();
const {
  addInventory,
  getInventoryDashboard,
  updateInventory,
  getSingleVariant
} = require('../controller/inventoryController');

router.post('/add', addInventory);
router.put('/update/:variantId', updateInventory);
router.get('/summary', getInventoryDashboard);
router.get('/:variantId', getSingleVariant); 

module.exports = router;