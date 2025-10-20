// routes/categories.js
const express = require('express');
const router = express.Router();

const upload = require("../config/multer")

// Assume authMiddleware and requireRole are imported or global
const authMiddleware = require('../middleware/auth');
// const requireRole = require('../middleware/requireRole'); // If separate; otherwise inline

const {createCategory, getCategories, getCategoryById, updateCategory, deleteCategory} = require("../controller/categoryController")



// Auth and role middleware
const requireRole = (roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, msg: 'Access denied' });
  }
  next();
};
 

// =============================================================================
// CATEGORY ROUTES: Full CRUD (Protected for Manager/Super Admin)
// =============================================================================


router.post('/', upload.single('image'), authMiddleware, requireRole(['Super Admin', 'Manager']), createCategory);

router.get('/', getCategories);

router.get('/:id', getCategoryById);

// Update Category
router.put('/:id', upload.single('image'), authMiddleware, requireRole(['Super Admin', 'Manager']), updateCategory);

// Delete Category
router.delete('/:id', authMiddleware, requireRole(['Super Admin', 'Manager']), deleteCategory);


module.exports = router;
