const express = require('express');
const router = express.Router();
const {
  receiveStock,
  reduceStock,
  adjustStock,
  getStockMovementHistory,
  getStockLevel,
} = require('../controller/inventoryController');
const { protect, authorize } = require('../middleware/auth'); // your auth middleware

router.use(protect); // all routes require login

router.post('/receive', receiveStock);
router.post('/reduce', reduceStock);
router.post('/adjust', authorize('Inventory Manager' || 'Super Admin'), adjustStock);
router.get('/history', getStockMovementHistory);
router.get('/level/:sku', getStockLevel);

module.exports = router;