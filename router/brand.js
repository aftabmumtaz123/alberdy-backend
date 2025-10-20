// routes/brand.js (New Router for Brand CRUD)
const express = require('express');
const router = express.Router();
const upload = require('../config/multer'); // Assuming multer config for single file

const { createBrand, getAllBrands, updateBrand, deleteBrand, getBrandById } = require('../controller/brandController'); // Note: path to brand controller

// Auth and role middleware
const authMiddleware = require('../middleware/auth');
const requireRole = (roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, msg: 'Access denied' });
  }
  next();
};

// =============================================================================
// BRAND ROUTES: Full CRUD with Logo Upload (Protected for Manager/Super Admin)
// =============================================================================

// GET /api/brands - List View (paginated/filtered)
router.get('/', getAllBrands);

// POST /api/brands - Create Brand (with optional image)
router.post('/', authMiddleware, requireRole(['Super Admin', 'Manager']), upload.single('image'), createBrand);

// GET /api/brands/:id - View Brand Details
router.get('/:id', getBrandById);

// PUT /api/brands/:id - Update Brand (with optional new image)
router.put('/:id', authMiddleware, requireRole(['Super Admin', 'Manager']), upload.single('image'), updateBrand);

// DELETE /api/brands/:id
router.delete('/:id', authMiddleware, requireRole(['Super Admin', 'Manager']), deleteBrand);


module.exports = router;
