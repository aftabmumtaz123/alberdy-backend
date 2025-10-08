// routes/product.js (Updated for consistency)
const express = require('express');
const router = express.Router();
const upload = require('../config/multer'); // Assuming multer config for multiple files

const { createProduct, getAllProducts, updateProduct, deleteProduct, getProductById } = require('../controller/productController'); // Note: path to controller

// Auth and role middleware
const authMiddleware = require('../middleware/auth');
const requireRole = (roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, msg: 'Access denied' });
  }
  next();
};

// =============================================================================
// PRODUCT ROUTES: Full CRUD with Image Upload (Protected for Manager/Super Admin)
// =============================================================================

// GET /api/products - List View (paginated/filtered)
router.get('/', authMiddleware, requireRole(['Super Admin', 'Manager']), getAllProducts);

// POST /api/products - Create Product (with multiple images)
// POST /api/products - Create Product (with images[] and thumbnail fields)
router.post('/', authMiddleware, requireRole(['Super Admin', 'Manager']), upload.fields([
  { name: 'images', maxCount: 5 },  // Multiple files under 'images' field
  { name: 'thumbnail', maxCount: 1 }  // Single file under 'thumbnail' field
]), createProduct);

// GET /api/products/:id - View Product Details
router.get('/:id', authMiddleware, requireRole(['Super Admin', 'Manager']), getProductById);

// PUT /api/products/:id - Update Product (append new images + optional new thumbnail)
router.put('/:id', authMiddleware, requireRole(['Super Admin', 'Manager']), upload.fields([
  { name: 'images', maxCount: 5 },  // Append to existing images
  { name: 'thumbnail', maxCount: 1 }  // Replace/update thumbnail
]), updateProduct);
// DELETE /api/products/:id
router.delete('/:id', authMiddleware, requireRole(['Super Admin', 'Manager']), deleteProduct);

module.exports = router;