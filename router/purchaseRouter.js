const express = require('express');
const router = express.Router();
const purchaseController = require('../controller/purchaseController');

// Create a new purchase
router.post('/', purchaseController.createPurchase);

// Get all purchases with pagination, sorting, and filtering
router.get('/', purchaseController.getAllPurchases);

// Get a single purchase by ID
router.get('/:id', purchaseController.getPurchaseById);

// Update a purchase by ID
router.put('/:id', purchaseController.updatePurchase);

// Delete a purchase by ID
router.delete('/:id', purchaseController.deletePurchase);

module.exports = router;