const express = require('express');
const router = express.Router();
const variantController = require('../controller/variantController');
const upload = require('../config/multer'); // Assuming Multer middleware


// Auth and role middleware
const authMiddleware = require('../middleware/auth');
const requireRole = (roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, msg: 'Access denied' });
  }
  next();
};

// router.use(authMiddleware);
// router.use(requireRole(['Admin', 'Manager']));

// POST /api/variants - Create variant
router.post('/', upload.fields([{ name: 'image', maxCount: 1 }]), variantController.createVariant);

// GET /api/variants - Get all variants
router.get('/', variantController.getAllVariants);

// GET /api/variants/:id - Get variant by ID
router.get('/:id', variantController.getVariantById);

// PUT /api/variants/:id - Update variant
router.put('/:id', upload.fields([{ name: 'image', maxCount: 1 }]), variantController.updateVariant);

// DELETE /api/variants/:id - Delete variant
router.delete('/:id', variantController.deleteVariant);

module.exports = router;