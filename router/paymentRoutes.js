const express = require('express');
const router = express.Router();
const paymentController = require('../controller/paymentController');

router.post('/', paymentController.createPayment);
router.put('/:id', paymentController.updatePayment);
router.delete('/:id', paymentController.deletePayment);
router.get('/', paymentController.getAllPayments);

module.exports = router;