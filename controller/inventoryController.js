// controllers/inventoryController.js - Aligned with provided Product schema
const StockEntry = require('../model/stockEntry');
const Product = require('../model/Product');
const Category = require('../model/Category')
const mongoose = require('mongoose');

// Helper to calculate current stock for a product (sum quantities where expiryDate > now or null)
const calculateCurrentStock = async (productId) => {
  const now = new Date();
  const total = await StockEntry.aggregate([
    { $match: { product: new mongoose.Types.ObjectId(productId) } },
    {
      $addFields: {
        isValid: {
          $or: [
            { $eq: ['$expiryDate', null] },
            { $gt: ['$expiryDate', now] }
          ]
        }
      }
    },
    { $match: { isValid: true } },
    {
      $group: {
        _id: null,
        totalQuantity: { $sum: '$quantity' }
      }
    }
  ]);
  let stock = total[0]?.totalQuantity || 0;
  
  // Fallback to denormalized product.stockQuantity if no valid entries
  if (stock === 0) {
    const product = await Product.findById(productId).select('stockQuantity');
    stock = product?.stockQuantity || 0;
  }
  
  return stock;
};

// Helper to get latest expiry date for a product (max expiryDate among valid entries)
const getLatestExpiryDate = async (productId) => {
  const now = new Date();
  const result = await StockEntry.aggregate([
    { $match: { product: new mongoose.Types.ObjectId(productId) } },
    {
      $addFields: {
        isValid: {
          $or: [
            { $eq: ['$expiryDate', null] },
            { $gt: ['$expiryDate', now] }
          ]
        }
      }
    },
    { $match: { isValid: true, expiryDate: { $ne: null } } },
    { $group: { _id: null, latestExpiry: { $max: '$expiryDate' } } }
  ]);
  let expiry = result[0]?.latestExpiry;
  
  // Fallback to denormalized product.expiryDate if no valid entries
  if (!expiry) {
    const product = await Product.findById(productId).select('expiryDate');
    expiry = product?.expiryDate;
  }
  
  return expiry;
};

// GET /api/products - Simplified list for product management (ID, name, category, alpha sorted)
exports.getProductsList = async (req, res) => {
  try {
    const products = await Product.find({})
      .select('_id name category')
      .populate('category', 'name')
      .sort({ name: 1 }); // Alphabetical by name
    res.json({
      success: true,
      products
    });
  } catch (err) {
    console.error('Products list error:', err);
    res.status(500).json({ success: false, msg: 'Server error fetching products' });
  }
};

// GET /api/inventory/{product_id} - Current stock and latest expiry
exports.getInventoryByProduct = async (req, res) => {
  try {
    const { product_id } = req.params;
    const product = await Product.findById(product_id);
    if (!product) {
      return res.status(404).json({ success: false, msg: 'Product not found' });
    }

    const currentStock = await calculateCurrentStock(product_id);
    const latestExpiry = await getLatestExpiryDate(product_id);

    res.json({
      success: true,
      productId: product._id,
      productName: product.name,
      currentStock,
      latestExpiry
    });
  } catch (err) {
    console.error('Inventory get error:', err);
    res.status(500).json({ success: false, msg: 'Server error fetching inventory' });
  }
};

// POST /api/inventory/update - Add/Remove stock
exports.updateInventory = async (req, res) => {
  try {
    const { product_id, quantity, expiry_date } = req.body;
    if (!mongoose.Types.ObjectId.isValid(product_id)) {
      return res.status(400).json({ success: false, msg: 'Invalid product ID' });
    }
    if (!quantity || typeof quantity !== 'number') {
      return res.status(400).json({ success: false, msg: 'Quantity is required and must be a number' });
    }

    const product = await Product.findById(product_id);
    if (!product) {
      return res.status(404).json({ success: false, msg: 'Product not found' });
    }

    // Calculate new stock
    const currentStock = await calculateCurrentStock(product_id);
    const newStock = currentStock + quantity;
    if (newStock < 0) {
      return res.status(400).json({ success: false, msg: 'Stock cannot be negative' });
    }

    // Create stock entry (expiry_date optional, only for adds)
    const stockEntry = new StockEntry({
      product: product_id,
      quantity,
      ...(quantity > 0 && expiry_date && { expiryDate: new Date(expiry_date) })
    });
    await stockEntry.save();

    // Update product stockQuantity
    product.stockQuantity = newStock;
    await product.save();

    // Recalc to confirm (in case of expiry filter)
    const updatedStock = await calculateCurrentStock(product_id);
    const updatedExpiry = await getLatestExpiryDate(product_id);

    res.status(201).json({
      success: true,
      message: 'Inventory updated successfully',
      updatedStock: updatedStock,
      latestExpiry: updatedExpiry
    });
  } catch (err) {
    console.error('Inventory update error:', err);
    res.status(500).json({ success: false, msg: 'Server error updating inventory' });
  }
};

// GET /api/inventory/expiry-alerts - Products expiring in next 7 days
exports.getExpiryAlerts = async (req, res) => {
  try {
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const alerts = await StockEntry.aggregate([
      {
        $match: {
          expiryDate: {
            $gte: now,
            $lte: sevenDaysFromNow
          },
          quantity: { $gt: 0 }
        }
      },
      {
        $lookup: {
          from: 'products',
          localField: 'product',
          foreignField: '_id',
          as: 'product'
        }
      },
      { $unwind: '$product' },
      {
        $group: {
          _id: '$product._id',
          productName: { $first: '$product.name' },
          currentStock: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $or: [{ $eq: ['$expiryDate', null] }, { $gt: ['$expiryDate', now] }] },
                    { $gt: ['$quantity', 0] }
                  ]
                },
                '$quantity',
                0
              ]
            }
          },
          expiryDate: { $min: '$expiryDate' } // Soonest expiry for the product
        }
      },
      { $match: { currentStock: { $gt: 0 } } },
      {
        $project: {
          _id: 0,
          productName: 1,
          currentStock: 1,
          expiryDate: 1
        }
      },
      { $sort: { expiryDate: 1 } } // Soonest first
    ]);

    res.json({
      success: true,
      alerts,
      asOfDate: now
    });
  } catch (err) {
    console.error('Expiry alerts error:', err);
    res.status(500).json({ success: false, msg: 'Server error fetching expiry alerts' });
  }
};



// GET /api/inventory/list - Enhanced inventory list view matching UI (Fixed projection)
exports.getInventoryList = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit , 
      category, 
      expiryStart, 
      expiryEnd, 
      search, 
      sortBy = 'productName', 
      sortDir = 'asc' 
    } = req.query;
    const filter = {};
    const now = new Date();
    const threshold = parseInt(process.env.LOW_STOCK_THRESHOLD) || 10;
    let catId = null;

    // Search filter on name
    if (search) {
      filter.name = { $regex: search, $options: 'i' };
    }

    // Category filter
    if (category) {
      const cat = await findCategoryByIdOrName(category);
      if (!cat) return res.status(400).json({ success: false, msg: 'Invalid category' });
      catId = cat._id;
      filter.category = catId;
    }

    // Build main pipeline stages conditionally
    const expiryStartStage = expiryStart ? [{ $match: { expiryDate: { $gte: new Date(expiryStart) } } }] : [];
    const expiryEndStage = expiryEnd ? [{ $match: { $and: [{ expiryDate: { $exists: true } }, { expiryDate: { $lte: new Date(expiryEnd) } }] } }] : [];
    const categoryMatchStage = catId ? [{ $match: { 'category._id': catId } }] : [];

    const pipeline = [
      { $match: filter },
      // Lookup all stock entries
      {
        $lookup: {
          from: 'stockentries',
          localField: '_id',
          foreignField: 'product',
          as: 'allEntries'
        }
      },
      // Filter valid entries (non-expired)
      {
        $addFields: {
          validEntries: {
            $filter: {
              input: '$allEntries',
              cond: {
                $or: [
                  { $eq: ['$$this.expiryDate', null] },
                  { $gt: ['$$this.expiryDate', now] }
                ]
              }
            }
          }
        }
      },
      // Compute stocks and counts
      {
        $addFields: {
          totalStock: { $sum: '$validEntries.quantity' },
          latestExpiry: { $max: '$validEntries.expiryDate' },
          historicalEntries: { $size: '$allEntries' },
          validCount: { $size: '$validEntries' },
          lastUpdated: { $max: '$allEntries.createdAt' }
        }
      },
      // Fallback for no entries: Use denormalized product fields
      {
        $addFields: {
          totalStock: {
            $cond: {
              if: { $gt: ['$historicalEntries', 0] },
              then: '$totalStock',
              else: '$stockQuantity'
            }
          },
          expiryDateFallback: {
            $cond: {
              if: { $gt: ['$historicalEntries', 0] },
              then: '$latestExpiry',
              else: '$expiryDate'
            }
          },
          lastUpdatedFallback: {
            $cond: {
              if: { $gt: ['$historicalEntries', 0] },
              then: '$lastUpdated',
              else: '$updatedAt'
            }
          }
        }
      },
      {
        $addFields: {
          expired: { $and: [{ $gt: ['$historicalEntries', 0] }, { $eq: ['$validCount', 0] }] },
          lowStock: { 
            $and: [ 
              { $not: [{ $and: [{ $gt: ['$historicalEntries', 0] }, { $eq: ['$validCount', 0] }] }] }, 
              { $gt: ['$totalStock', 0] }, 
              { $lt: ['$totalStock', threshold] } 
            ] 
          },
          expiryDate: '$expiryDateFallback',
          stockQuantity: {
            $cond: {
              if: { $and: [{ $gt: ['$historicalEntries', 0] }, { $eq: ['$validCount', 0] }] },
              then: 0,
              else: '$totalStock'
            }
          },
          status: {
            $cond: {
              if: { $and: [{ $gt: ['$historicalEntries', 0] }, { $eq: ['$validCount', 0] }] },
              then: 'Expired',
              else: {
                $cond: {
                  if: '$lowStock',
                  then: 'Low Stock',
                  else: {
                    $cond: {
                      if: { $and: [{ $eq: ['$historicalEntries', 0] }, { $eq: ['$totalStock', 0] }] },
                      then: 'Out of Stock',
                      else: null
                    }
                  }
                }
              }
            }
          },
          lastUpdated: '$lastUpdatedFallback'
        }
      },
      // Expiry range filters (after computing expiryDate)
      ...expiryStartStage,
      ...expiryEndStage,
      // Lookups for category, brand
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
          from: 'brands',
          localField: 'brand',
          foreignField: '_id',
          as: 'brand'
        }
      },
      { $unwind: { path: '$brand', preserveNullAndEmptyArrays: true } },
      // Category match after lookup
      ...categoryMatchStage,
      // Project UI fields (all inclusions, no __v exclusion)
      {
        $project: {
          productName: '$name',
          imageUrl: { $arrayElemAt: ['$images', 0] },
          brandName: '$brand.name',
          stockQuantity: 1,
          lowStock: 1,
          status: 1,
          expiryDate: 1,
          categoryName: '$category.name',
          lastUpdated: 1
        }
      },
      // Sort (default productName asc)
      { 
        $sort: { 
          [sortBy]: sortDir === 'desc' ? -1 : 1 
        } 
      },
      // Pagination
      { $skip: (parseInt(page) - 1) * parseInt(limit) },
      { $limit: parseInt(limit) }
    ];

    const inventory = await Product.aggregate(pipeline);

    // Total count pipeline (simplified mirror without pagination/sort)
    // Rebuild conditional stages for count
    const countExpiryStartStage = expiryStart ? [
      { 
        $addFields: {
          expiryDate: {
            $cond: {
              if: { $and: [{ $gt: ['$historicalEntries', 0] }, { $eq: ['$validCount', 0] }] },
              then: { $max: '$allEntries.expiryDate' },
              else: { $max: '$validEntries.expiryDate' }
            }
          }
        }
      },
      { $match: { expiryDate: { $gte: new Date(expiryStart) } } }
    ] : [];
    const countExpiryEndStage = expiryEnd ? [
      { 
        $addFields: {
          expiryDate: {
            $cond: {
              if: { $and: [{ $gt: ['$historicalEntries', 0] }, { $eq: ['$validCount', 0] }] },
              then: { $max: '$allEntries.expiryDate' },
              else: { $max: '$validEntries.expiryDate' }
            }
          }
        }
      },
      { $match: { $and: [{ expiryDate: { $exists: true } }, { expiryDate: { $lte: new Date(expiryEnd) } }] } }
    ] : [];

    const countPipeline = [
      { $match: filter },
      {
        $lookup: {
          from: 'stockentries',
          localField: '_id',
          foreignField: 'product',
          as: 'allEntries'
        }
      },
      {
        $addFields: {
          validEntries: {
            $filter: {
              input: '$allEntries',
              cond: {
                $or: [
                  { $eq: ['$$this.expiryDate', null] },
                  { $gt: ['$$this.expiryDate', now] }
                ]
              }
            }
          }
        }
      },
      {
        $addFields: {
          totalStock: { $sum: '$validEntries.quantity' },
          validCount: { $size: '$validEntries' },
          historicalEntries: { $size: '$allEntries' }
        }
      },
      // Fallback for count (mirror main)
      {
        $addFields: {
          totalStock: {
            $cond: {
              if: { $gt: ['$historicalEntries', 0] },
              then: '$totalStock',
              else: '$stockQuantity'
            }
          }
        }
      },
      // Include all products for count
      // No restrictive $match
      // Expiry filters for count
      ...countExpiryStartStage,
      ...countExpiryEndStage,
      ...(catId ? [{ $match: { category: catId } }] : []),
      { $count: 'total' }
    ];

    const countResult = await Product.aggregate(countPipeline);
    const total = countResult[0]?.total || 0;

    res.json({
      success: true,
      inventory,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
        total
      }
    });
  } catch (err) {
    console.error('Inventory list error:', err);
    res.status(500).json({ success: false, msg: 'Server error fetching inventory list' });
  }
};
