const express = require('express');
const router = express.Router();
const saleController = require('../controller/salesController');

router.get('/', saleController.getAllSales);
router.post('/', saleController.createSale);
router.get('/:id', saleController.getSaleById);
router.put('/:id', saleController.updateSale);
router.delete('/:id', saleController.deleteSale);

module.exports = router;