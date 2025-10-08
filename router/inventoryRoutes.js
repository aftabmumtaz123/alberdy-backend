// routes/inventoryRoutes.js - Reordered for route matching priority
const express = require('express');
const router = express.Router();
const {
  getProductsList,
  getInventoryByProduct,
  updateInventory,
  getExpiryAlerts,
  getInventoryList
} = require('../controller/inventoryController');
const  auth  = require('../middleware/auth'); // Auth for updates, optional for reads

// Product Management
router.get('/productslist', getProductsList); // Public

// Inventory List (specific path first to avoid param capture)
router.get('/inventory/list', getInventoryList);

// Expiry Alerts (specific before param)
router.get('/inventory/expiry-alerts', auth, getExpiryAlerts);

// Current Stock (param last)
router.get('/inventory/:product_id', getInventoryByProduct);

// Add/Remove Stock
router.post('/inventory/update', auth, updateInventory);

module.exports = router;