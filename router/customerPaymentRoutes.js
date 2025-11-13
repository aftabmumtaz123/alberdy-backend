const express = require('express');
const router = express.Router();
const customerPaymentController = require('../controller/customerPaymentController');
const authMiddleware = require('../middleware/auth');

// All routes require authentication
router.post('/', authMiddleware, customerPaymentController.createPayment);
router.put('/:id', authMiddleware, customerPaymentController.updatePayment);
router.delete('/:id', authMiddleware, customerPaymentController.deletePayment);
router.get('/', authMiddleware, customerPaymentController.getAllPayments);

module.exports = router;