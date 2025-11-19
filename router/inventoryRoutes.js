const express = require('express');
const router = express.Router();
const {
  addInventory,
  getInventoryDashboard,
  updateInventory,
  getSingleInventory
} = require('../controller/inventoryController');



router.post('/add', addInventory);
router.put('/update/:id', updateInventory);
router.get('/summary', getInventoryDashboard);
router.get('/:id', getSingleInventory);
module.exports = router;