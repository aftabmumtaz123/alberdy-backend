const express = require('express');
const router = express.Router();
const {
  addInventory,
  getInventoryDashboard,
  updateInventory,
  getSingleVariant
} = require('../controller/inventoryController');



router.post('/add', addInventory);
router.put('/update/:id', updateInventory);
router.get('/summary', getInventoryDashboard);
router.get('/:id', getSingleVariant);
module.exports = router;