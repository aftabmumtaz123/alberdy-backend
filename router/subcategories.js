const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const upload = require('../config/multer')


const { createSubcategory, getAllSubcategories, updateSubcategory, getsubcategoryById, deleteSubcategory } = require('../controller/subCategoryController');



// Auth and role middleware
const authMiddleware = require('../middleware/auth');
const requireRole = (roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, msg: 'Access denied' });
  }
  next();
};

// =============================================================================
// SUBCATEGORY ROUTES: Full CRUD (Protected for Manager/Super Admin)
// =============================================================================

// Create Subcategory
router.post('/', upload.single('image'), authMiddleware, requireRole(['Super Admin', 'Manager']), createSubcategory);

// Get All Subcategories
router.get('/',  authMiddleware, requireRole(['Super Admin', 'Manager']), getAllSubcategories);

// Get Single Subcategory
router.get('/:id', authMiddleware, requireRole(['Super Admin', 'Manager']), getsubcategoryById);

// Update Subcategory (Enhanced with better validation and error handling)
router.put('/:id', upload.single('image'), authMiddleware, requireRole(['Super Admin', 'Manager']), updateSubcategory);

// Delete Subcategory
router.delete('/:id', authMiddleware, requireRole(['Super Admin', 'Manager']), deleteSubcategory);

module.exports = router;