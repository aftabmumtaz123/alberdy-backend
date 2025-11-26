// routes/product.js (Updated for consistency)
const express = require('express');
const router = express.Router();
const upload = require('../config/multer'); // Assuming multer config for multiple files

const { createProduct, getAllProducts, updateProduct, deleteProduct, getProductById } = require('../controller/productController'); // Note: path to controller
const productController = require('../controller/productController');
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
router.get('/', getAllProducts);

// POST /api/products - Create Product (with multiple images)
// POST /api/products - Create Product (with images[] and thumbnail fields)
router.post('/', authMiddleware, requireRole(['Super Admin', 'Manager']), upload.fields([
  { name: 'images', maxCount: 5 },  // Multiple files under 'images' field
  { name: 'thumbnail', maxCount: 1 }  // Single file under 'thumbnail' field
]), createProduct);

// GET /api/products/:id - View Product Details
router.get('/:id',  getProductById);

// PUT /api/products/:id - Update Product (append new images + optional new thumbnail)
router.put('/:id', authMiddleware, requireRole(['Super Admin', 'Manager']), upload.fields([
  { name: 'images', maxCount: 5 },  // Append to existing images
  { name: 'thumbnail', maxCount: 1 }  // Replace/update thumbnail
]), updateProduct);
// DELETE /api/products/:id
router.delete('/:id', authMiddleware, requireRole(['Super Admin', 'Manager']), deleteProduct);



router.get('/category/:categoryIdOrName', async (req, res) => {
  try {
    const { categoryIdOrName } = req.params;
    const { page = 1, limit = 10, subcategory, brand, unit, status, name, lowStock } = req.query;

    // Local requires for models
    const mongoose = require('mongoose');
    const Product = require('../model/Product');
    const Category = require('../model/Category');
    const Subcategory = require('../model/Subcategory');
    const Brand = require('../model/Brand');
    const Unit = require('../model/Unit');

    // Local helper functions (copied from controller for independence)
    const findCategoryByIdOrName = async (value) => {
      if (!value) return null;
      const trimmedValue = value.toString().trim();
      if (mongoose.Types.ObjectId.isValid(trimmedValue)) {
        return await Category.findById(trimmedValue);
      }
      return await Category.findOne({ name: trimmedValue, status: 'Active' });
    };

    const findSubcategoryByIdOrName = async (value) => {
      if (!value) return null;
      const trimmedValue = value.toString().trim();
      let subDoc;
      if (mongoose.Types.ObjectId.isValid(trimmedValue)) {
        subDoc = await Subcategory.findById(trimmedValue);
      } else {
        subDoc = await Subcategory.findOne({ subcategoryName: trimmedValue, status: 'Active' });
      }
      if (subDoc && subDoc.status === 'Active') {
        return await subDoc.populate('parent_category_id', 'name');
      }
      return null;
    };

    const findBrandByIdOrName = async (value) => {
      if (!value) return null;
      const trimmedValue = value.toString().trim();
      if (mongoose.Types.ObjectId.isValid(trimmedValue)) return await Brand.findById(trimmedValue);
      return await Brand.findOne({ name: trimmedValue, status: 'Active' });
    };

    const findUnitByIdOrName = async (value) => {
      if (!value) return null;
      const trimmedValue = value.toString().trim();
      if (mongoose.Types.ObjectId.isValid(trimmedValue)) return await Unit.findById(trimmedValue);
      return await Unit.findOne({ unit_name: trimmedValue, unit_status: 'enable' });
    };

    // Validate and find category
    const category = await findCategoryByIdOrName(categoryIdOrName);
    if (!category) {
      return res.status(400).json({ success: false, msg: `Category not found for value: ${categoryIdOrName}` });
    }

    // Build filter with category enforced
    const filter = { category: category._id };
    if (subcategory) {
      const sub = await findSubcategoryByIdOrName(subcategory);
      if (sub) filter.subcategory = sub._id;
      else return res.status(400).json({ success: false, msg: 'Invalid subcategory filter' });
    }
    if (brand) {
      const br = await findBrandByIdOrName(brand);
      if (br) filter.brand = br._id;
      else return res.status(400).json({ success: false, msg: 'Invalid brand filter' });
    }
    if (unit) {
      const u = await findUnitByIdOrName(unit);
      if (u) filter.unit = u._id;
      else return res.status(400).json({ success: false, msg: 'Invalid unit filter' });
    }
    if (status) filter.status = status;
    if (name) filter.name = { $regex: name, $options: 'i' };
    if (lowStock === 'true') filter.stockQuantity = { $lt: 10 };

    // Reuse the aggregation pipeline from getAllProducts but with enforced filter
    const pipeline = [
      { $match: filter },
      {
        $lookup: {
          from: 'categories',
          localField: 'category',
          foreignField: '_id',
          as: 'category'
        }
      },
      { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'subcategories',
          localField: 'subcategory',
          foreignField: '_id',
          as: 'subcategory'
        }
      },
      { $unwind: { path: '$subcategory', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'brands',
          localField: 'brand',
          foreignField: '_id',
          as: 'brand'
        }
      },
      { $unwind: { path: '$brand', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'units',
          localField: 'unit',
          foreignField: '_id',
          as: 'unit'
        }
      },
      { $unwind: { path: '$unit', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'offers',
          let: { prodId: '$_id', currentDate: new Date() },
          pipeline: [
            {
              $match: {
                $expr: { $in: ['$$prodId', '$applicableProducts'] },
                status: 'active',
                $expr: {
                  $and: [
                    { $lte: ['$startDate', '$$currentDate'] },
                    { $gte: ['$endDate', '$$currentDate'] }
                  ]
                }
              }
            },
            { $sort: { createdAt: -1 } },
            { $limit: 1 },
            {
              $project: {
                discountType: 1,
                discountValue: 1,
                _id: 0
              }
            }
          ],
          as: 'activeOffer'
        }
      },
      { $unwind: { path: '$activeOffer', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          effectivePrice: {
            $cond: {
              if: { $ne: ['$activeOffer', null] },
              then: {
                $cond: {
                  if: { $eq: ['$activeOffer.discountType', 'Percentage'] },
                  then: {
                    $subtract: [
                      { $ifNull: ['$price', 0] },
                      { $multiply: [{ $ifNull: ['$price', 0] }, { $divide: ['$activeOffer.discountValue', 100] }] }
                    ]
                  },
                  else: { $subtract: [{ $ifNull: ['$price', 0] }, '$activeOffer.discountValue'] }
                }
              },
              else: { $ifNull: ['$price', 0] }
            }
          }
        }
      },
      { $sort: { createdAt: -1 } },
      { $skip: (parseInt(page) - 1) * parseInt(limit) },
      { $limit: parseInt(limit) },
      {
        $project: {
          __v: 0
        }
      }
    ];

    const products = await Product.aggregate(pipeline);
    const total = await Product.countDocuments(filter);

    res.json({
      success: true,
      products,
      total,
      pages: Math.ceil(total / limit),
      currentPage: page,
      category: category // Include the category info for context
    });
  } catch (err) {
    console.error('Products by category error:', err);
    res.status(500).json({ success: false, msg: 'Server error fetching products by category' });
  }
});





module.exports = router;
