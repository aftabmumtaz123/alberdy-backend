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
const authMiddleware = (req, res, next) => {
  // Implement JWT or other auth logic here
  // Example: const token = req.header('Authorization')?.replace('Bearer ', '');
  next(); // Remove this and add actual auth logic
};

// Multer middleware with error handling
const uploadMiddleware = (req, res, next) => {
  upload.array('attachments', 5)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({
        success: false,
        message: `Multer error: ${err.message}`,
      });
    } else if (err) {
      return res.status(400).json({
        success: false,
        message: 'File upload failed',
        error: err.message,
      });
    }
    next();
  });
};

router.use(authMiddleware);
router.use(mongoSanitize());

// Routes
router.post('/', uploadMiddleware, createSupplier);
router.get('/', getAllSuppliers);
router.get('/:id', getSupplierById);
router.put('/:id', uploadMiddleware, updateSupplier);
router.delete('/:id', deleteSupplier);

module.exports = router;