const express = require('express');
const router = express.Router();
const mongoSanitize = require('express-mongo-sanitize');
const {
  createSupplier,
  getAllSuppliers,
  getSupplierById,
  updateSupplier,
  deleteSupplier,
} = require('../controller/supplierController');
const upload = require('../config/multer');

// Authentication middleware (placeholder)



router.use(authMiddleware);
router.use(mongoSanitize());

// Routes
router.post('/', upload(''), createSupplier);
router.get('/', getAllSuppliers);
router.get('/:id', getSupplierById);
router.put('/:id', uploadMiddleware, updateSupplier);
router.delete('/:id', deleteSupplier);

module.exports = router;