// product controller 
const fs = require('fs').promises; // For async file cleanup
const path = require('path');

const Product = require('../model/Product');
const Category = require('../model/Category');
const Subcategory = require('../model/subCategory');
const Brand = require('../model/Brand');
const Unit = require('../model/Unit'); // Adjust path as needed
const mongoose = require('mongoose');

// Flexible lookups (Enhanced with logging and status check)
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
  console.log('DEBUG: Attempting subcategory lookup for value:', trimmedValue); // Remove in prod
  console.log('DEBUG: Is valid ObjectId?', mongoose.Types.ObjectId.isValid(trimmedValue)); // Remove in prod

  let subDoc;
  if (mongoose.Types.ObjectId.isValid(trimmedValue)) {
    subDoc = await Subcategory.findById(trimmedValue);
    console.log('DEBUG: Raw findById result:', subDoc ? 'Found' : 'Null'); // Remove in prod
  } else {
    // Fallback to name if ID invalid
    subDoc = await Subcategory.findOne({ subcategoryName: trimmedValue, status: 'Active' });
    console.log('DEBUG: Raw name search result:', subDoc ? 'Found' : 'Null'); // Remove in prod
  }

  if (subDoc) {
    // Optional: Enforce Active status even for ID lookups
    if (subDoc.status !== 'Active') {
      console.log('DEBUG: Subcategory found but Inactive:', subDoc._id); // Remove in prod
      return null; // Or return subDoc if you allow Inactive
    }
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


// Create Product (Enhanced with key alias and type conversion, now with variations support)
exports.createProduct = async (req, res) => {
  console.log('DEBUG: Full req.body:', req.body); // Remove in prod
  const { name, category: categoryValue, description, subCategory: subcategoryValueFromCamel, subcategory: subcategoryValueFromSnake, brand: brandValue, weightQuantity, unit: unitValue, purchasePrice, price, discountPrice, stockQuantity, expiryDate, ingredients, suitableFor, status = 'Active', variations } = req.body;

  // Use camelCase if present, fallback to snake_case
  const subcategoryValue = subcategoryValueFromCamel || subcategoryValueFromSnake;

  // Handle multi-field uploads: images (array) and thumbnail (single)
  const imagesFiles = req.files && req.files['images'] ? req.files['images'] : [];
  const thumbnailFile = req.files && req.files['thumbnail'] ? req.files['thumbnail'][0] : null;
  const images = imagesFiles.map(file => file.path);
  const thumbnail = thumbnailFile ? thumbnailFile.path : null;

  // Handle variation images: assume variations.images is an array of file objects if uploaded
  const variationImages = {};
  if (req.files && variations) {
    // Parse variations to get length
    let parsedVariations;
    try {
      parsedVariations = JSON.parse(variations);
    } catch {
      parsedVariations = [];
    }
    for (let i = 0; i < parsedVariations.length; i++) {
      const fieldName = `variation_images_${i}`;
      if (req.files[fieldName]) {
        variationImages[i] = req.files[fieldName].map(file => file.path);
      }
    }
  }

  // Consolidated cleanup helper
  const cleanupAllFiles = async () => {
    const allFiles = [...imagesFiles, thumbnailFile, ...Object.values(variationImages).flat()].filter(f => f);
    for (const file of allFiles) {
      try { await fs.unlink(file.path); } catch { }
    }
  };

  // Validation for base product
  if (suitableFor && !['Puppy', 'Adult', 'Senior', 'All Ages'].includes(suitableFor)) {
    await cleanupAllFiles();
    return res.status(400).json({ success: false, msg: 'Invalid suitableFor' });
  }
  if (!thumbnail) {
    await cleanupAllFiles();
    return res.status(400).json({ success: false, msg: 'Thumbnail is required' });
  }
  if (!['Active', 'Inactive'].includes(status)) {
    await cleanupAllFiles();
    return res.status(400).json({ success: false, msg: 'Invalid status' });
  }
  const parsedStockQuantity = parseInt(stockQuantity);
  if (parsedStockQuantity < 0) {
    await cleanupAllFiles();
    return res.status(400).json({ success: false, msg: 'Stock quantity must be non-negative' });
  }
  const parsedDiscountPrice = parseFloat(discountPrice);
  const parsedPrice = parseFloat(price);
  if (discountPrice !== undefined && (isNaN(parsedDiscountPrice) || parsedDiscountPrice > parsedPrice)) { // Added isNaN
    await cleanupAllFiles();
    return res.status(400).json({ success: false, msg: `Discount price (${parsedDiscountPrice}) must be less than or equal to sell price (${parsedPrice})` });
  }
  const parsedPurchasePrice = parseFloat(purchasePrice);
  if (isNaN(parsedPrice) || parsedPrice <= parsedPurchasePrice) { // Added isNaN
    await cleanupAllFiles();
    return res.status(400).json({ success: false, msg: `Sell price (${parsedPrice}) must be greater than purchase price (${parsedPurchasePrice})` });
  }
  if (expiryDate) {
    const parsedExpiry = new Date(expiryDate);
    if (parsedExpiry <= new Date()) {
      await cleanupAllFiles();
      return res.status(400).json({ success: false, msg: 'Expiry date must be in the future' });
    }
  }

  // Variation validation (only if provided)
  let parsedVariations = [];
  if (variations) {
    try {
      parsedVariations = JSON.parse(variations);
      if (!Array.isArray(parsedVariations)) {
        throw new Error('Not an array');
      }
    } catch (e) {
      await cleanupAllFiles();
      return res.status(400).json({ success: false, msg: `Invalid variations JSON: ${e.message}` });
    }
    for (let i = 0; i < parsedVariations.length; i++) {
      const varObj = parsedVariations[i];
      if (!varObj.attribute || !varObj.value || !varObj.sku) {
        await cleanupAllFiles();
        return res.status(400).json({ success: false, msg: `Variation ${i} missing required fields: attribute, value, or sku` });
      }
      const varPrice = parseFloat(varObj.price);
      const varStock = parseInt(varObj.stockQuantity || 0);
      if (isNaN(varPrice) || varPrice <= 0 || isNaN(varStock) || varStock < 0) { // Added isNaN
        await cleanupAllFiles();
        return res.status(400).json({ success: false, msg: `Variation ${i} invalid price or stock` });
      }
      // Check for duplicate SKUs across variations
      const skuExists = parsedVariations.some((v, idx) => idx !== i && v.sku === varObj.sku);
      if (skuExists) {
        await cleanupAllFiles();
        return res.status(400).json({ success: false, msg: `Duplicate SKU in variations` });
      }
    }
  }

  try {
    // Lookups
    const category = await findCategoryByIdOrName(categoryValue);
    if (!category) {
      await cleanupAllFiles();
      return res.status(400).json({ success: false, msg: `Category not found for value: ${categoryValue}` });
    }

    console.log('DEBUG: Subcategory value before lookup:', subcategoryValue); // Remove in prod
    const subcategory = await findSubcategoryByIdOrName(subcategoryValue);
    if (!subcategory) {
      await cleanupAllFiles();
      return res.status(400).json({ success: false, msg: `Subcategory not found for value: ${subcategoryValue}` });
    }

    const brand = await findBrandByIdOrName(brandValue);
    if (!brand) {
      await cleanupAllFiles();
      return res.status(400).json({ success: false, msg: `Brand not found for value: ${brandValue}` });
    }

    const unit = await findUnitByIdOrName(unitValue);
    if (!unit) {
      await cleanupAllFiles();
      return res.status(400).json({ success: false, msg: `Unit not found for value: ${unitValue}` });
    }

    // Uniqueness check (name + brand)
    const existingProduct = await Product.findOne({ name, brand: brand._id });
    if (existingProduct) {
      await cleanupAllFiles();
      return res.status(400).json({ success: false, msg: 'Product with this name already exists under this brand' });
    }

    // Convert ingredients array to string if needed
    const ingredientsString = Array.isArray(ingredients) ? ingredients.join('\n') : ingredients;
    console.log('DEBUG: Ingredients processed:', ingredientsString); // Remove in prod

    const productData = {
      name: name.trim(), // Added trim
      category: category._id,
      subcategory: subcategory._id,
      brand: brand._id,
      description,
      weightQuantity: parseFloat(weightQuantity),
      unit: unit._id,
      purchasePrice: parsedPurchasePrice,
      price: parsedPrice,
      status,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      variations: [] // Explicitly set to empty array to avoid undefined
    };
    if (discountPrice !== undefined && !isNaN(parsedDiscountPrice)) productData.discountPrice = parsedDiscountPrice;
    if (stockQuantity !== undefined && !isNaN(parsedStockQuantity)) productData.stockQuantity = parsedStockQuantity;
    if (expiryDate) productData.expiryDate = new Date(expiryDate);
    if (ingredientsString) productData.ingredients = ingredientsString.trim();
    if (suitableFor) productData.suitableFor = suitableFor;
    if (images.length > 0) productData.images = images;
    productData.thumbnail = thumbnail;

    // Process variations if provided
    if (parsedVariations.length > 0) {
      productData.variations = parsedVariations.map((varObj, index) => {
        const varData = {
          attribute: varObj.attribute.trim(), // Added trim
          value: varObj.value.trim(),
          sku: varObj.sku.trim(),
          price: parseFloat(varObj.price),
          stockQuantity: parseInt(varObj.stockQuantity || 0)
        };
        if (varObj.discountPrice !== undefined) varData.discountPrice = parseFloat(varObj.discountPrice);
        if (variationImages[index] && variationImages[index].length > 0) {
          varData.image = variationImages[index][0];
        }
        return varData;
      });
    }

    const newProduct = new Product(productData);
    await newProduct.validate(); // Added explicit validation
    await newProduct.save();
    await newProduct.populate([
      { path: 'category', select: 'name' },
      { path: 'subcategory', select: 'subcategoryName' },
      { path: 'brand', select: 'name' },
      { path: 'unit', select: 'unit_name' }
    ]);

    res.status(201).json({
      success: true,
      msg: 'Product created successfully',
      product: newProduct
    });
  } catch (err) {
    console.error('Product creation error:', err.message || err); // Enhanced logging
    await cleanupAllFiles();
    if (err.name === 'MongoServerError' && err.code === 11000) { // More reliable check
      return res.status(400).json({ success: false, msg: `Duplicate data detected: ${err.errmsg || 'Check SKU or product name/brand uniqueness'}` });
    }
    if (err.name === 'ValidationError') {
      return res.status(400).json({ success: false, msg: `Validation error: ${Object.values(err.errors).map(e => e.message).join(', ')}` });
    }
    res.status(500).json({ success: false, msg: 'Server error during product creation', details: err.message || 'Unknown error' });
  }
};


// Get All Products (List View) - Enhanced with dynamic offers (Fixed projection, now includes variations)
exports.getAllProducts = async (req, res) => {
  const { page = 1, limit = 10, category, subcategory, brand, unit, status, name, lowStock } = req.query;
  const filter = {};
  if (category) {
    const cat = await findCategoryByIdOrName(category);
    if (cat) filter.category = cat._id;
    else return res.status(400).json({ success: false, msg: 'Invalid category filter' });
  }
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

  try {
    // Switch to aggregation for offer integration and effective price calc
    const pipeline = [
      { $match: filter },
      // Basic populates via lookup
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
      // Offer lookup
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
      // Calculate effective price (fixed: use 'price' consistently)
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
      // Pagination and sort
      { $sort: { createdAt: -1 } },
      { $skip: (page - 1) * parseInt(limit) },
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
      currentPage: page
    });
  } catch (err) {
    console.error('Product list error:', err.message || err);
    res.status(500).json({ success: false, msg: 'Server error fetching products', details: err.message || 'Unknown error' });
  }
};


// Get Product by ID - Enhanced with dynamic offers, now includes variations
exports.getProductById = async (req, res) => {
  try {
    const { id } = req.params;

    // Use aggregation for single product to include offer integration
    const pipeline = [
      { $match: { _id: new mongoose.Types.ObjectId(id) } },
      // Basic populates via lookup
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
      // Offer lookup
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
      // Calculate effective price (fixed: use 'price' consistently)
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
      {
        $project: {
          __v: 0
        }
      }
    ];

    const [product] = await Product.aggregate(pipeline);
    if (!product) {
      return res.status(404).json({ success: false, msg: 'Product not found' });
    }

    res.json({ success: true, product });
  } catch (err) {
    console.error('Product get error:', err.message || err);
    res.status(500).json({ success: false, msg: 'Server error fetching product', details: err.message || 'Unknown error' });
  }
};

// Update Product (Similar enhancements: logs, enriched errors, trim, now with variations CRUD)
exports.updateProduct = async (req, res) => {
  console.log('DEBUG: Update req.body:', req.body); // Remove in prod
  const { name, description, category: categoryValue, subcategory: subcategoryValue, brand: brandValue, weightQuantity, unit: unitValue, purchasePrice, price, discountPrice, stockQuantity, expiryDate, ingredients, suitableFor, status, variations: incomingVariations, variationOperation, variationIndex } = req.body;

  // Handle multi-field uploads for update: new images (append) and optional new thumbnail (replace)
  const newImagesFiles = req.files && req.files['images'] ? req.files['images'] : [];
  const newThumbnailFile = req.files && req.files['thumbnail'] ? req.files['thumbnail'][0] : null;
  const newImages = newImagesFiles.map(file => file.path);
  const newThumbnail = newThumbnailFile ? newThumbnailFile.path : undefined;

  // Handle variation images for add/update
  const variationImages = {};
  if (req.files && (variationOperation === 'add' || (variationOperation === 'update' && variationIndex !== undefined))) {
    let parsedIncoming;
    try {
      parsedIncoming = JSON.parse(incomingVariations || '[]');
    } catch {
      parsedIncoming = [];
    }
    const targetIndex = variationOperation === 'add' ? parsedIncoming.length - 1 : parseInt(variationIndex);
    const fieldName = `variation_images_${targetIndex}`;
    if (req.files[fieldName]) {
      variationImages[targetIndex] = req.files[fieldName].map(file => file.path);
    }
  }

  // Consolidated cleanup helper
  const cleanupAllNewFiles = async () => {
    const allNewFiles = [...newImagesFiles, newThumbnailFile, ...Object.values(variationImages).flat()].filter(f => f);
    for (const file of allNewFiles) {
      try { await fs.unlink(file.path); } catch { }
    }
  };

  // Validation (similar to create, but optional)
  if (status !== undefined && !['Active', 'Inactive'].includes(status)) {
    await cleanupAllNewFiles();
    return res.status(400).json({ success: false, msg: 'Invalid status' });
  }
  if (suitableFor !== undefined && !['Puppy', 'Adult', 'Senior', 'All Ages'].includes(suitableFor)) {
    await cleanupAllNewFiles();
    return res.status(400).json({ success: false, msg: 'Invalid suitableFor' });
  }

  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      await cleanupAllNewFiles();
      return res.status(400).json({ success: false, msg: 'Invalid product ID' });
    }

    const currentProduct = await Product.findById(req.params.id);
    if (!currentProduct) {
      await cleanupAllNewFiles();
      return res.status(404).json({ success: false, msg: 'Product not found' });
    }

    // Lookups if provided (same as before, omitted for brevity)

    // Prepare final values for validation
    const finalPurchasePrice = purchasePrice !== undefined ? parseFloat(purchasePrice) : currentProduct.purchasePrice;
    const finalPrice = price !== undefined ? parseFloat(price) : currentProduct.price;
    const finalDiscountPrice = discountPrice !== undefined ? parseFloat(discountPrice) : currentProduct.discountPrice;
    const finalStockQuantity = stockQuantity !== undefined ? parseInt(stockQuantity) : currentProduct.stockQuantity;
    const finalExpiryDate = expiryDate !== undefined ? new Date(expiryDate) : currentProduct.expiryDate;

    if (finalStockQuantity < 0) {
      await cleanupAllNewFiles();
      return res.status(400).json({ success: false, msg: 'Stock quantity must be non-negative' });
    }
    if (finalDiscountPrice !== undefined && (isNaN(finalDiscountPrice) || finalDiscountPrice > finalPrice)) { // Added isNaN
      await cleanupAllNewFiles();
      return res.status(400).json({ success: false, msg: 'Discount price must be less than or equal to sell price' });
    }
    if (isNaN(finalPrice) || finalPrice <= finalPurchasePrice) { // Added isNaN
      await cleanupAllNewFiles();
      return res.status(400).json({ success: false, msg: 'Sell price must be greater than purchase price' });
    }
    if (expiryDate !== undefined && finalExpiryDate <= new Date()) {
      await cleanupAllNewFiles();
      return res.status(400).json({ success: false, msg: 'Expiry date must be in the future' });
    }

    // Uniqueness if name or brand changed
    if ((name !== undefined && name.trim() !== currentProduct.name) || (brandValue !== undefined && brand.toString() !== currentProduct.brand.toString())) { // Added trim and toString
      const checkName = name !== undefined ? name.trim() : currentProduct.name;
      const existing = await Product.findOne({ name: checkName, brand });
      if (existing && existing._id.toString() !== req.params.id) {
        await cleanupAllNewFiles();
        return res.status(400).json({ success: false, msg: 'Product name already exists under this brand' });
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name.trim(); // Added trim
    if (description !== undefined) updateData.description = description.trim(); // Added trim
    if (categoryValue !== undefined && category.toString() !== currentProduct.category.toString()) updateData.category = category; // Added toString
    if (subcategoryValue !== undefined && subcategory.toString() !== currentProduct.subcategory.toString()) updateData.subcategory = subcategory;
    if (brandValue !== undefined && brand.toString() !== currentProduct.brand.toString()) updateData.brand = brand;
    if (unitValue !== undefined && unit.toString() !== currentProduct.unit.toString()) updateData.unit = unit;
    if (weightQuantity !== undefined) updateData.weightQuantity = parseFloat(weightQuantity);
    if (purchasePrice !== undefined) updateData.purchasePrice = finalPurchasePrice;
    if (price !== undefined) updateData.price = finalPrice;
    if (discountPrice !== undefined) updateData.discountPrice = finalDiscountPrice;
    if (stockQuantity !== undefined) updateData.stockQuantity = finalStockQuantity;
    if (expiryDate !== undefined) updateData.expiryDate = finalExpiryDate;
    if (ingredients !== undefined) updateData.ingredients = ingredients.trim(); // Added trim
    if (suitableFor !== undefined) updateData.suitableFor = suitableFor;
    if (status !== undefined) updateData.status = status;
    if (newImages.length > 0) {
      updateData.$push = updateData.$push || {};
      updateData.$push.images = { $each: newImages };
    }
    if (newThumbnail) {
      updateData.thumbnail = newThumbnail;
      if (currentProduct.thumbnail) try { await fs.unlink(currentProduct.thumbnail); } catch { }
    }

    // Handle variations CRUD
    if (variationOperation) {
      let currentVariations = currentProduct.variations || [];
      let parsedIncomingVariations = [];
      if (incomingVariations) {
        try {
          parsedIncomingVariations = JSON.parse(incomingVariations);
          if (!Array.isArray(parsedIncomingVariations)) throw new Error('Not an array');
        } catch (e) {
          await cleanupAllNewFiles();
          return res.status(400).json({ success: false, msg: `Invalid variations JSON: ${e.message}` });
        }
      }
      switch (variationOperation) {
        case 'add':
          if (parsedIncomingVariations.length === 0) {
            return res.status(400).json({ success: false, msg: 'Variations array required for add operation' });
          }
          for (let i = 0; i < parsedIncomingVariations.length; i++) {
            const varObj = parsedIncomingVariations[i];
            if (!varObj.attribute || !varObj.value || !varObj.sku) {
              await cleanupAllNewFiles();
              return res.status(400).json({ success: false, msg: `New variation ${i} missing required fields` });
            }
            const varPrice = parseFloat(varObj.price);
            const varStock = parseInt(varObj.stockQuantity || 0);
            if (isNaN(varPrice) || varPrice <= 0 || isNaN(varStock) || varStock < 0) { // Added isNaN
              await cleanupAllNewFiles();
              return res.status(400).json({ success: false, msg: `New variation ${i} invalid price or stock` });
            }
            const allSkus = [...currentVariations.map(v => v.sku), ...parsedIncomingVariations.slice(0, i).map(v => v.sku)];
            if (allSkus.includes(varObj.sku)) {
              await cleanupAllNewFiles();
              return res.status(400).json({ success: false, msg: `Duplicate SKU in new variations` });
            }
            // Added global SKU check
            const existingSku = await Product.findOne({ 'variations.sku': varObj.sku });
            if (existingSku) {
              await cleanupAllNewFiles();
              return res.status(400).json({ success: false, msg: `SKU '${varObj.sku}' already exists in another product` });
            }
          }
          const newVars = parsedIncomingVariations.map((varObj, index) => {
            const varData = {
              attribute: varObj.attribute.trim(),
              value: varObj.value.trim(),
              sku: varObj.sku.trim(),
              price: parseFloat(varObj.price),
              stockQuantity: parseInt(varObj.stockQuantity || 0)
            };
            if (varObj.discountPrice !== undefined) varData.discountPrice = parseFloat(varObj.discountPrice);
            if (variationImages[index] && variationImages[index].length > 0) {
              varData.image = variationImages[index][0];
            }
            return varData;
          });
          updateData.$push = updateData.$push || {};
          updateData.$push.variations = { $each: newVars };
          break;

        case 'update':
          if (variationIndex === undefined || parsedIncomingVariations.length === 0) {
            return res.status(400).json({ success: false, msg: 'Variations array and index required for update operation' });
          }
          const idx = parseInt(variationIndex);
          if (idx < 0 || idx >= currentVariations.length) {
            await cleanupAllNewFiles();
            return res.status(400).json({ success: false, msg: 'Invalid variation index' });
          }
          const updateVar = parsedIncomingVariations[0];
          if (!updateVar.attribute || !updateVar.value || !updateVar.sku) {
            await cleanupAllNewFiles();
            return res.status(400).json({ success: false, msg: 'Updated variation missing required fields' });
          }
          const updateVarPrice = parseFloat(updateVar.price);
          const updateVarStock = parseInt(updateVar.stockQuantity || 0);
          if (isNaN(updateVarPrice) || updateVarPrice <= 0 || isNaN(updateVarStock) || updateVarStock < 0) { // Added isNaN
            await cleanupAllNewFiles();
            return res.status(400).json({ success: false, msg: 'Updated variation invalid price or stock' });
          }
          const existingSkus = currentVariations.filter((v, i) => i !== idx).map(v => v.sku);
          if (existingSkus.includes(updateVar.sku)) {
            await cleanupAllNewFiles();
            return res.status(400).json({ success: false, msg: 'SKU conflicts with existing variation' });
          }
          // Added global SKU check if changed
          if (updateVar.sku !== currentVariations[idx].sku) {
            const existingSku = await Product.findOne({ 'variations.sku': updateVar.sku });
            if (existingSku) {
              await cleanupAllNewFiles();
              return res.status(400).json({ success: false, msg: `SKU '${updateVar.sku}' already exists in another product` });
            }
          }
          if (variationImages[idx] && variationImages[idx].length > 0 && currentVariations[idx].image) {
            try { await fs.unlink(currentVariations[idx].image); } catch { }
          }
          const updatedVarData = {
            attribute: updateVar.attribute.trim(),
            value: updateVar.value.trim(),
            sku: updateVar.sku.trim(),
            price: updateVarPrice,
            stockQuantity: updateVarStock
          };
          if (updateVar.discountPrice !== undefined) updatedVarData.discountPrice = parseFloat(updateVar.discountPrice);
          if (variationImages[idx] && variationImages[idx].length > 0) {
            updatedVarData.image = variationImages[idx][0];
          }
          updateData.$set = updateData.$set || {};
          updateData.$set[`variations.${idx}`] = updatedVarData;
          break;

        case 'remove':
          if (variationIndex === undefined) {
            return res.status(400).json({ success: false, msg: 'Variation index required for remove operation' });
          }
          const removeIdx = parseInt(variationIndex);
          if (removeIdx < 0 || removeIdx >= currentVariations.length) {
            return res.status(400).json({ success: false, msg: 'Invalid variation index' });
          }
          if (currentVariations[removeIdx].image) {
            try { await fs.unlink(currentVariations[removeIdx].image); } catch { }
          }
          // Remove by index: $unset then $pull null (shifts array)
          updateData.$unset = updateData.$unset || {};
          updateData.$unset[`variations.${removeIdx}`] = '';
          updateData.$pull = updateData.$pull || {};
          updateData.$pull.variations = null;
          break;

        default:
          return res.status(400).json({ success: false, msg: 'Invalid variationOperation: add, update, or remove' });
      }
    }

    if (Object.keys(updateData).length === 0 && newImages.length === 0 && !newThumbnail && !variationOperation) {
      return res.status(400).json({ success: false, msg: 'No fields provided to update' });
    }

    // Always update timestamp (moved outside if)
    updateData.updatedAt = new Date().toISOString();
    const product = await Product.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true })
      .populate([
        { path: 'category', select: 'name' },
        { path: 'subcategory', select: 'subcategoryName' },
        { path: 'brand', select: 'name' },
        { path: 'unit', select: 'unit_name' }
      ]);

    res.json({
      success: true,
      msg: 'Product updated successfully',
      product
    });
  } catch (err) {
    console.error('Product update error:', err.message || err);
    await cleanupAllNewFiles();
    if (err.name === 'MongoServerError' && err.code === 11000) {
      return res.status(400).json({ success: false, msg: `Duplicate data detected: ${err.errmsg || 'Check SKU or product name/brand uniqueness'}` });
    }
    if (err.name === 'ValidationError') {
      return res.status(400).json({ success: false, msg: `Validation error: ${Object.values(err.errors).map(e => e.message).join(', ')}` });
    }
    res.status(500).json({ success: false, msg: 'Server error updating product', details: err.message || 'Unknown error' });
  }
};

// Delete Product - Enhanced to clean variation images
exports.deleteProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, msg: 'Product not found' });
    }

    // Cleanup base images and thumbnail
    for (const img of product.images || []) {
      try { await fs.unlink(img); } catch { }
    }
    if (product.thumbnail) {
      try { await fs.unlink(product.thumbnail); } catch { }
    }

    // Cleanup variation images
    if (product.variations) {
      for (const variation of product.variations) {
        if (variation.image) {
          try { await fs.unlink(variation.image); } catch { }
        }
      }
    }

    await Product.findByIdAndDelete(req.params.id);

    res.json({ success: true, msg: 'Product deleted successfully' });
  } catch (err) {
    console.error('Product delete error:', err.message || err);
    res.status(500).json({ success: false, msg: 'Server error deleting product', details: err.message || 'Unknown error' });
  }
};

