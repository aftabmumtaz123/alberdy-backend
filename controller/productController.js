// product controller 
const fs = require('fs').promises; // For async file cleanup
const path = require('path');

const Product = require('../model/Product');
const Variant = require('../model/variantProduct');
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
  const trimmedValue = value.toString();
  if (mongoose.Types.ObjectId.isValid(trimmedValue)) return await Unit.findById(trimmedValue);
  return await Unit.findOne({ unit_name: trimmedValue, unit_status: 'enable' });
};

const generateSKU = async () => {
  const lastVariant = await Variant.findOne().sort({ createdAt: -1 });
  let nextNumber = 1;
  if (lastVariant && lastVariant.sku) {
    const match = lastVariant.sku.match(/SKU-NUM-(\d+)/);
    if (match) nextNumber = parseInt(match[1], 10) + 1;
  }
  return `SKU-NUM-${String(nextNumber).padStart(3, '0')}`;
};

exports.createProduct = async (req, res) => {
  console.log('DEBUG: Full req.body:', req.body); // Remove in prod
  const { name, category: categoryValue, description, subCategory: subcategoryValueFromCamel, subcategory: subcategoryValueFromSnake, brand: brandValue, weightQuantity, unit: unitValue, purchasePrice, price, discountPrice, stockQuantity, expiryDate, sku, ingredients, suitableFor, status = 'Active', variants } = req.body;

  const subcategoryValue = subcategoryValueFromCamel || subcategoryValueFromSnake;

  // Handle multi-field uploads: images (array) and thumbnail (single)
  const imagesFiles = req.files && req.files['images'] ? req.files['images'] : [];
  const thumbnailFile = req.files && req.files['thumbnail'] ? req.files['thumbnail'][0] : null;
  const images = imagesFiles.map(file => file.path);
  const thumbnail = thumbnailFile ? thumbnailFile.path : null;

  // Handle variation images: assume variants.images is an array of file objects if uploaded
  const variationImages = {};
  let parsedVariations = [];
  if (req.files && variants) {
    try {
      parsedVariations = JSON.parse(variants);
      if (!Array.isArray(parsedVariations)) {
        throw new Error('Not an array');
      }
    } catch (e) {
      parsedVariations = [];
    }
    for (let i = 0; i < parsedVariations.length; i++) {
      const fieldName = `variation_images_${i}`;
      if (req.files[fieldName]) {
        variationImages[i] = req.files[fieldName][0].path; // Single image for variant
      }
    }
  }

  // Consolidated cleanup helper
  const cleanupAllFiles = async () => {
    const allFiles = [...imagesFiles, thumbnailFile, ...Object.values(variationImages).filter(Boolean)].filter(f => f);
    for (const file of allFiles) {
      try { await fs.unlink(file); } catch { }
    }
  };

  // Validation for base product
  if (suitableFor && !['Puppy', 'Adult', 'Senior', 'All Ages'].includes(suitableFor)) {
    await cleanupAllFiles();
    return res.status(400).json({ success: false, msg: 'Invalid suitableFor' });
  }
  
  if (!['Active', 'Inactive'].includes(status)) {
    await cleanupAllFiles();
    return res.status(400).json({ success: false, msg: 'Invalid status' });
  }

  // Handle default variant if no variations provided
  if (parsedVariations.length === 0) {
    const defaultSku = sku?.trim() || await generateSKU();
    parsedVariations = [{
      attribute: 'Default',
      value: 'Standard',
      sku: defaultSku,
      unit: unitValue,
      weightQuantity: weightQuantity || 0,
      price: price || 0,
      discountPrice: discountPrice || 0,
      purchasePrice: purchasePrice || 0,
      stockQuantity: stockQuantity || 0,
      expiryDate: expiryDate,
      status: 'Active'
    }];
  }

  // Variation validation (now always at least one)
  for (let i = 0; i < parsedVariations.length; i++) {
    const v = parsedVariations[i];
   

    const varPrice = parseFloat(v.price);
    const varStock = parseInt(v.stockQuantity || 0);
    const varDiscount = parseFloat(v.discountPrice || 0);
    const varPurchase = parseFloat(v.purchasePrice || 0);
    const varWeight = parseFloat(v.weightQuantity || 0);

    if (isNaN(varPrice) || varPrice <= 0 || isNaN(varStock) || varStock < 0 || isNaN(varPurchase) || varPurchase < 0 || isNaN(varWeight) || varWeight <= 0) {
      await cleanupAllFiles();
      return res.status(400).json({ success: false, msg: `Variation ${i + 1} invalid numeric fields` });
    }
    if (v.discountPrice !== undefined && (isNaN(varDiscount) || varDiscount > varPrice)) {
      await cleanupAllFiles();
      return res.status(400).json({ success: false, msg: `Variation ${i + 1} invalid discountPrice` });
    }

    if (v.expiryDate) {
      const parsedExpiry = new Date(v.expiryDate);
      if (isNaN(parsedExpiry.getTime()) || parsedExpiry <= new Date()) {
        await cleanupAllFiles();
        return res.status(400).json({ success: false, msg: `Variation ${i + 1} invalid expiryDate` });
      }
    }
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Lookups
    const category = await findCategoryByIdOrName(categoryValue);
    if (!category) {
      await cleanupAllFiles();
      throw new Error(`Category not found for value: ${categoryValue}`);
    }

    console.log('DEBUG: Subcategory value before lookup:', subcategoryValue); // Remove in prod
    const subcategory = await findSubcategoryByIdOrName(subcategoryValue);
    if (!subcategory) {
      await cleanupAllFiles();
      throw new Error(`Subcategory not found for value: ${subcategoryValue}`);
    }

    const brand = await findBrandByIdOrName(brandValue);
    if (!brand) {
      await cleanupAllFiles();
      throw new Error(`Brand not found for value: ${brandValue}`);
    }

    // Check uniqueness (name + brand)
    const existingProduct = await Product.findOne({ name: name.trim(), brand: brand._id }).session(session);
    if (existingProduct) {
      await cleanupAllFiles();
      throw new Error('Product with this name already exists under this brand');
    }

    // Convert ingredients array to string if needed
    const ingredientsString = Array.isArray(ingredients) ? ingredients.join('\n') : ingredients;

    const productData = {
      name: name.trim(),
      category: category._id,
      subcategory: subcategory._id,
      brand: brand._id,
      status,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      variations: [] 
    };
    if (ingredientsString) productData.ingredients = ingredientsString.trim();
    if (suitableFor) productData.suitableFor = suitableFor;
    if (images.length > 0) productData.images = images;
    if (thumbnail) productData.thumbnail = thumbnail;
    if (description) productData.description = description.trim();

    const newProduct = new Product(productData);
    await newProduct.validate();
    await newProduct.save({ session });

    // Fill missing attribute/value
    for (let i = 0; i < parsedVariations.length; i++) {
      const v = parsedVariations[i];
      if (!v.attribute?.trim()) v.attribute = 'Default';
      if (!v.value?.trim()) v.value = 'Standard';
    }

    // Generate missing SKUs
    for (let i = 0; i < parsedVariations.length; i++) {
      const v = parsedVariations[i];
      if (!v.sku?.trim()) {
        v.sku = await generateSKU();
      }
    }

    // Check for duplicate SKUs in variations
    const trimmedSkus = parsedVariations.map(v => v.sku.trim());
    if (new Set(trimmedSkus).size !== trimmedSkus.length) {
      await cleanupAllFiles();
      throw new Error('Duplicate SKU detected in variations');
    }

    let variantIds = [];
    // Check global SKU uniqueness before creating
    for (const v of parsedVariations) {
      const existingVariant = await Variant.findOne({ sku: v.sku.trim() }).session(session);
      if (existingVariant) {
        throw new Error(`SKU '${v.sku}' already exists`);
      }
    }

    // Create variants
    for (let i = 0; i < parsedVariations.length; i++) {
      const v = parsedVariations[i];

      const unit = await findUnitByIdOrName(v.unit);
      if (!unit) {
        throw new Error(`Unit not found for variation ${i + 1}: ${v.unit}`);
      }

      const variantData = {
        product: newProduct._id,
        attribute: v.attribute.trim(),
        value: v.value.trim(),
        sku: v.sku.trim(),
        unit: unit._id,
        purchasePrice: parseFloat(v.purchasePrice),
        price: parseFloat(v.price),
        discountPrice: parseFloat(v.discountPrice || 0),
        stockQuantity: parseInt(v.stockQuantity || 0),
        weightQuantity: parseFloat(v.weightQuantity),
        status: v.status || 'Active'
      };
      if (v.expiryDate) variantData.expiryDate = new Date(v.expiryDate);
      const imagePath = variationImages[i];
      if (imagePath) variantData.image = imagePath;

      const newVariant = new Variant(variantData);
      await newVariant.validate();
      await newVariant.save({ session });
      variantIds.push(newVariant._id);
    }

    // Add to product
    if (variantIds.length > 0) {
      await Product.findByIdAndUpdate(newProduct._id, { $push: { variations: { $each: variantIds } } }, { session });
    }

    await session.commitTransaction();
    session.endSession();

    await newProduct.populate([
      { path: 'category', select: 'name' },
      { path: 'subcategory', select: 'subcategoryName' },
      { path: 'brand', select: 'name' },
      { path: 'variations', select: 'attribute value sku price stockQuantity discountPrice image unit purchasePrice expiryDate status weightQuantity' }
    ]);
    if (variantIds.length > 0) {
      await Variant.populate(newProduct.variations, { path: 'unit', select: 'unit_name' });
    }

    res.status(201).json({
      success: true,
      msg: 'Product created successfully',
      product: newProduct
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    await cleanupAllFiles();
    console.error('Product creation error:', err.message || err); // Enhanced logging
    if (err.name === 'MongoServerError' && err.code === 11000) { // More reliable check
      return res.status(400).json({ success: false, msg: `Duplicate data detected: ${err.errmsg || 'Check SKU or product name/brand uniqueness'}` });
    }
    if (err.name === 'ValidationError') {
      return res.status(400).json({ success: false, msg: `Validation error: ${Object.values(err.errors).map(e => e.message).join(', ')}` });
    }
    res.status(400).json({ success: false, msg: err.message });
  }
};


exports.getAllProducts = async (req, res) => {
  const { page = 1, limit = 10, category, subcategory, brand, status, name, lowStock } = req.query;
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
  if (status) filter.status = status;
  if (name) filter.name = { $regex: name, $options: 'i' };

  try {
    // Base pipeline stages (matching getProductById structure)
    let pipeline = [
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
      // Full variations lookup (like getProductById)
      {
        $lookup: {
          from: 'variants',
          let: { varIds: { $ifNull: ['$variations', []] } },
          pipeline: [
            {
              $match: {
                $expr: { $in: ['$_id', '$$varIds'] }
              }
            },
            // Nested lookup for unit in variants
            {
              $lookup: {
                from: 'units',
                localField: 'unit',
                foreignField: '_id',
                as: 'unit'
              }
            },
            { $unwind: { path: '$unit', preserveNullAndEmptyArrays: true } },
            // Project specific fields from Variant model
            {
              $project: {
                attribute: 1,
                value: 1,
                sku: 1,
                unit: { $ifNull: ['$unit', null] },
                purchasePrice: 1,
                price: 1,
                discountPrice: 1,
                stockQuantity: 1,
                expiryDate: 1,
                weightQuantity: 1,
                image: 1,
                status: 1,
                _id: 1
              }
            }
          ],
          as: 'variations'
        }
      },
      // Offer lookup (same as getProductById)
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
      // Calculate effective price for each variation (matching getProductById)
      {
        $addFields: {
          variations: {
            $map: {
              input: { $ifNull: ['$variations', []] },
              as: 'var',
              in: {
                $mergeObjects: [
                  '$$var',
                  {
                    effectivePrice: {
                      $cond: {
                        if: { $ne: ['$activeOffer', null] },
                        then: {
                          $cond: {
                            if: { $eq: ['$activeOffer.discountType', 'Percentage'] },
                            then: {
                              $subtract: [
                                { $ifNull: ['$$var.price', 0] },
                                { $multiply: [{ $ifNull: ['$$var.price', 0] }, { $divide: ['$activeOffer.discountValue', 100] }] }
                              ]
                            },
                            else: { $subtract: [{ $ifNull: ['$$var.price', 0] }, '$activeOffer.discountValue'] }
                          }
                        },
                        else: { $ifNull: ['$$var.price', 0] }
                      }
                    }
                  }
                ]
              }
            }
          }
        }
      }
    ];

    // Add lowStock filter after addFields (filter on total stock across variations)
    if (lowStock === 'true') {
      pipeline.push({
        $addFields: {
          totalStock: { $sum: "$variations.stockQuantity" }
        }
      });
      pipeline.push({ $match: { totalStock: { $lt: 10 } } });
    }

    // Count pipeline (replicate for accurate count with filters)
    let countPipeline = [...pipeline];
    if (lowStock !== 'true') {
      // If no lowStock, add totalStock field only for count if needed, but since no filter, can count earlier
      countPipeline = pipeline.slice(0, pipeline.length - 1); // Remove last addFields if present
    }
    countPipeline.push({ $count: 'total' });
    const countResult = await Product.aggregate(countPipeline);
    const total = countResult.length > 0 ? countResult[0].total : 0;

    // Full pipeline for results
    const sortStage = { $sort: { createdAt: -1 } };
    const skipStage = { $skip: (page - 1) * parseInt(limit) };
    const limitStage = { $limit: parseInt(limit) };
    const projectStage = { 
      $project: { 
        __v: 0,
        activeOffer: 0 // Hide offer details, but keep effectivePrice in variations
      } 
    };

    const fullPipeline = [...pipeline, sortStage, skipStage, limitStage, projectStage];
    const products = await Product.aggregate(fullPipeline);

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
exports.getProductById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, msg: 'Invalid product ID' });
    }

    // Use aggregation for consistency with getAllProducts (populates, offers, effectivePrice)
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
      // Proper array lookup for variations (assuming variations is array of ObjectIds referencing 'variants' collection)
      {
        $lookup: {
          from: 'variants', // Assuming collection name is 'variants' (lowercase plural)
          let: { varIds: { $ifNull: ['$variations', []] } },
          pipeline: [
            {
              $match: {
                $expr: { $in: ['$_id', '$$varIds'] }
              }
            },
            // Nested lookup for unit in variants
            {
              $lookup: {
                from: 'units',
                localField: 'unit',
                foreignField: '_id',
                as: 'unit'
              }
            },
            { $unwind: { path: '$unit', preserveNullAndEmptyArrays: true } },
            // Project specific fields from Variant model (exclusion of __v by omission in inclusion projection)
            {
              $project: {
                attribute: 1,
                value: 1,
                sku: 1,
                unit: { $ifNull: ['$unit', null] },
                purchasePrice: 1,
                price: 1,
                discountPrice: 1,
                stockQuantity: 1,
                expiryDate: 1,
                weightQuantity: 1,
                image: 1,
                status: 1,
                _id: 1
              }
            }
          ],
          as: 'variations'
        }
      },
      // Offer lookup (same as getAllProducts)
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
      // Calculate effective price for each variation (now populated as array of objects)
      // Removed base effectivePrice as no base price
      {
        $addFields: {
          variations: {
            $map: {
              input: { $ifNull: ['$variations', []] },
              as: 'var',
              in: {
                $mergeObjects: [
                  '$$var',
                  {
                    effectivePrice: {
                      $cond: {
                        if: { $ne: ['$activeOffer', null] },
                        then: {
                          $cond: {
                            if: { $eq: ['$activeOffer.discountType', 'Percentage'] },
                            then: {
                              $subtract: [
                                { $ifNull: ['$$var.price', 0] },
                                { $multiply: [{ $ifNull: ['$$var.price', 0] }, { $divide: ['$activeOffer.discountValue', 100] }] }
                              ]
                            },
                            else: { $subtract: [{ $ifNull: ['$$var.price', 0] }, '$activeOffer.discountValue'] }
                          }
                        },
                        else: { $ifNull: ['$$var.price', 0] }
                      }
                    }
                  }
                ]
              }
            }
          }
        }
      },
      // Use $unset instead of $project to avoid projection type issues with __v
      { $unset: '__v' }
    ];

    const products = await Product.aggregate(pipeline);
    if (products.length === 0) {
      return res.status(404).json({ success: false, msg: 'Product not found' });
    }

    const product = products[0]; // Single product

    res.json({ success: true, message: "Product fetched successfully", product });
  } catch (err) {
    console.error('Product get error:', err.message || err);
    res.status(500).json({ success: false, msg: 'Server error fetching product', details: err.message || 'Unknown error' });
  }
};

exports.updateProduct = async (req, res) => {
  const { name, description, category: categoryValue, subcategory: subcategoryValue, brand: brandValue, weightQuantity, unit: unitValue, purchasePrice, price, discountPrice, stockQuantity, expiryDate, ingredients, suitableFor, status, variants: incomingVariants, variationOperation, variationIndex } = req.body;

  const newImagesFiles = req.files && req.files['images'] ? req.files['images'] : [];
  const newThumbnailFile = req.files && req.files['thumbnail'] ? req.files['thumbnail'][0] : null;
  const newImages = newImagesFiles.map(file => file.path);
  const newThumbnail = newThumbnailFile ? newThumbnailFile.path : undefined;

  // Handle variation images for add/update
  const variationImages = {};
  if (variationOperation) {
    let parsedIncoming = [];
    if (incomingVariants) {
      try {
        parsedIncoming = JSON.parse(incomingVariants);
        if (!Array.isArray(parsedIncoming)) throw new Error('Not an array');
      } catch (e) {
        parsedIncoming = [];
      }
    }
    if (variationOperation === 'add') {
      for (let i = 0; i < parsedIncoming.length; i++) {
        const fieldName = `variation_images_${i}`;
        if (req.files && req.files[fieldName]) {
          variationImages[i] = req.files[fieldName][0].path; // Single image
        }
      }
    } else if (variationOperation === 'update' && variationIndex !== undefined) {
      const targetIndex = parseInt(variationIndex);
      const fieldName = `variation_images_${targetIndex}`;
      if (req.files && req.files[fieldName]) {
        variationImages[targetIndex] = req.files[fieldName][0].path; // Single image
      }
    }
  }

  // Consolidated cleanup helper
  const cleanupAllNewFiles = async () => {
    const allNewFiles = [...newImagesFiles, newThumbnailFile, ...Object.values(variationImages).filter(Boolean)].filter(f => f);
    for (const file of allNewFiles) {
      try { await fs.unlink(file); } catch { }
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
  const parsedStockQuantity = stockQuantity !== undefined ? parseInt(stockQuantity) : NaN;
  if (stockQuantity !== undefined && (isNaN(parsedStockQuantity) || parsedStockQuantity < 0)) {
    await cleanupAllNewFiles();
    return res.status(400).json({ success: false, msg: 'Stock quantity must be non-negative' });
  }
  const parsedDiscountPrice = discountPrice !== undefined ? parseFloat(discountPrice) : NaN;
  const parsedPrice = price !== undefined ? parseFloat(price) : NaN;
  const parsedPurchasePrice = purchasePrice !== undefined ? parseFloat(purchasePrice) : NaN;
  if (price !== undefined && (isNaN(parsedPrice) || parsedPrice <= 0)) {
    await cleanupAllNewFiles();
    return res.status(400).json({ success: false, msg: 'Invalid price' });
  }
  if (purchasePrice !== undefined && (isNaN(parsedPurchasePrice) || parsedPurchasePrice <= 0)) {
    await cleanupAllNewFiles();
    return res.status(400).json({ success: false, msg: 'Invalid purchasePrice' });
  }
  if (discountPrice !== undefined && (isNaN(parsedDiscountPrice) || parsedDiscountPrice > (price !== undefined ? parsedPrice : NaN))) {
    await cleanupAllNewFiles();
    return res.status(400).json({ success: false, msg: 'Invalid discountPrice' });
  }
  if (expiryDate !== undefined) {
    const parsedExpiry = new Date(expiryDate);
    if (isNaN(parsedExpiry.getTime()) || parsedExpiry <= new Date()) {
      await cleanupAllNewFiles();
      return res.status(400).json({ success: false, msg: 'Expiry date must be in the future' });
    }
  }
  if (weightQuantity !== undefined && (isNaN(parseFloat(weightQuantity)) || parseFloat(weightQuantity) <= 0)) {
    await cleanupAllNewFiles();
    return res.status(400).json({ success: false, msg: 'Invalid weightQuantity' });
  }

  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      await cleanupAllNewFiles();
      return res.status(400).json({ success: false, msg: 'Invalid product ID' });
    }

    const currentProduct = await Product.findById(req.params.id).populate('variations');
    if (!currentProduct) {
      await cleanupAllNewFiles();
      return res.status(404).json({ success: false, msg: 'Product not found' });
    }

    // Conditional lookups if values provided
    let category, subcategory, brandDoc, unitDoc;
    if (categoryValue !== undefined) {
      category = await findCategoryByIdOrName(categoryValue);
      if (!category) {
        await cleanupAllNewFiles();
        return res.status(400).json({ success: false, msg: `Category not found for value: ${categoryValue}` });
      }
    }
    if (subcategoryValue !== undefined) {
      subcategory = await findSubcategoryByIdOrName(subcategoryValue);
      if (!subcategory) {
        await cleanupAllNewFiles();
        return res.status(400).json({ success: false, msg: `Subcategory not found for value: ${subcategoryValue}` });
      }
    }
    if (brandValue !== undefined) {
      brandDoc = await findBrandByIdOrName(brandValue);
      if (!brandDoc) {
        await cleanupAllNewFiles();
        return res.status(400).json({ success: false, msg: `Brand not found for value: ${brandValue}` });
      }
    }
    if (unitValue !== undefined) {
      unitDoc = await findUnitByIdOrName(unitValue);
      if (!unitDoc) {
        await cleanupAllNewFiles();
        return res.status(400).json({ success: false, msg: `Unit not found for value: ${unitValue}` });
      }
    }

    // Prepare final values for validation
    const finalPurchasePrice = purchasePrice !== undefined ? parsedPurchasePrice : NaN;
    const finalPrice = price !== undefined ? parsedPrice : NaN;
    const finalDiscountPrice = discountPrice !== undefined ? parsedDiscountPrice : NaN;
    const finalStockQuantity = stockQuantity !== undefined ? parsedStockQuantity : NaN;
    const finalExpiryDate = expiryDate !== undefined ? new Date(expiryDate) : null;
    const finalWeightQuantity = weightQuantity !== undefined ? parseFloat(weightQuantity) : NaN;

    // Validate provided fields only (using final for comparison)
    if (price !== undefined && finalPrice <= (purchasePrice !== undefined ? finalPurchasePrice : currentProduct.variations[0]?.purchasePrice || 0)) {
      await cleanupAllNewFiles();
      return res.status(400).json({ success: false, msg: `Sell price (${finalPrice}) must be greater than purchase price` });
    }
    if (discountPrice !== undefined && finalDiscountPrice > (price !== undefined ? finalPrice : currentProduct.variations[0]?.price || 0)) {
      await cleanupAllNewFiles();
      return res.status(400).json({ success: false, msg: `Discount price (${finalDiscountPrice}) must be less than or equal to sell price` });
    }

    // Uniqueness check if name or brand is being updated
    if (name !== undefined || brandValue !== undefined) {
      const checkName = name !== undefined ? name.trim() : currentProduct.name;
      const checkBrandId = brandValue !== undefined ? brandDoc._id : currentProduct.brand;
      const existing = await Product.findOne({ name: checkName, brand: checkBrandId });
      if (existing && existing._id.toString() !== req.params.id) {
        await cleanupAllNewFiles();
        return res.status(400).json({ success: false, msg: 'Product name already exists under this brand' });
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description.trim();
    if (categoryValue !== undefined) updateData.category = category._id;
    if (subcategoryValue !== undefined) updateData.subcategory = subcategory._id;
    if (brandValue !== undefined) updateData.brand = brandDoc._id;
    if (ingredients !== undefined) updateData.ingredients = Array.isArray(ingredients) ? ingredients.join('\n') : ingredients.trim();
    if (suitableFor !== undefined) updateData.suitableFor = suitableFor;
    if (status !== undefined) updateData.status = status;
    if (newImages.length > 0) {
      updateData.$push = updateData.$push || {};
      updateData.$push.images = { $each: newImages };
    }
    if (newThumbnail !== undefined) {
      updateData.thumbnail = newThumbnail;
      if (currentProduct.thumbnail) try { await fs.unlink(currentProduct.thumbnail); } catch { }
    }
    updateData.updatedAt = new Date().toISOString();

    // Bulk update shared fields across all variants if base fields provided (no variationOperation)
    if (purchasePrice !== undefined || price !== undefined || discountPrice !== undefined || stockQuantity !== undefined || weightQuantity !== undefined || expiryDate !== undefined || unitValue !== undefined) {
      const bulkUpdate = { $set: {} };
      if (purchasePrice !== undefined) bulkUpdate.$set.purchasePrice = finalPurchasePrice;
      if (price !== undefined) bulkUpdate.$set.price = finalPrice;
      if (discountPrice !== undefined) bulkUpdate.$set.discountPrice = finalDiscountPrice;
      if (stockQuantity !== undefined) bulkUpdate.$set.stockQuantity = finalStockQuantity;
      if (weightQuantity !== undefined) bulkUpdate.$set.weightQuantity = finalWeightQuantity;
      if (expiryDate !== undefined) bulkUpdate.$set.expiryDate = finalExpiryDate;
      if (unitValue !== undefined) bulkUpdate.$set.unit = unitDoc._id;
      await Variant.updateMany({ product: currentProduct._id }, bulkUpdate);
    }

    // Handle variations CRUD
    if (variationOperation) {
      let parsedIncomingVariations = [];
      if (incomingVariants) {
        try {
          parsedIncomingVariations = JSON.parse(incomingVariants);
          if (!Array.isArray(parsedIncomingVariations)) throw new Error('Not an array');
        } catch (e) {
          await cleanupAllNewFiles();
          return res.status(400).json({ success: false, msg: `Invalid variants JSON: ${e.message}` });
        }
      }
      switch (variationOperation) {
        case 'add':
          if (parsedIncomingVariations.length === 0) {
            return res.status(400).json({ success: false, msg: 'Variants array required for add operation' });
          }
          if (currentProduct.variations.length === 0) {
            return res.status(400).json({ success: false, msg: 'No existing variant to copy shared fields from' });
          }
          const sampleVariant = currentProduct.variations[0];
          const addVariantIds = [];
          let generatedSkus = [];
          for (let i = 0; i < parsedIncomingVariations.length; i++) {
            const varObj = parsedIncomingVariations[i];
            if (!varObj.unit || !varObj.price) {
              await cleanupAllNewFiles();
              return res.status(400).json({ success: false, msg: `New variation ${i} missing required fields (unit, price)` });
            }
            const varPrice = parseFloat(varObj.price);
            const varStock = parseInt(varObj.stockQuantity || 0);
            const varDiscount = parseFloat(varObj.discountPrice || 0);
            const varPurchase = parseFloat(varObj.purchasePrice || 0);
            const varWeight = parseFloat(varObj.weightQuantity || 0);
            if (isNaN(varPrice) || varPrice <= 0 || isNaN(varStock) || varStock < 0 || isNaN(varPurchase) || varPurchase < 0 || isNaN(varWeight) || varWeight <= 0) {
              await cleanupAllNewFiles();
              return res.status(400).json({ success: false, msg: `New variation ${i} invalid price or stock` });
            }
            if (varObj.discountPrice !== undefined && (isNaN(varDiscount) || varDiscount > varPrice)) {
              await cleanupAllNewFiles();
              return res.status(400).json({ success: false, msg: `New variation ${i} invalid discountPrice` });
            }
            const newSku = varObj.sku?.trim() || await generateSKU();
            if (generatedSkus.includes(newSku)) {
              await cleanupAllNewFiles();
              return res.status(400).json({ success: false, msg: `Duplicate SKU in new variations` });
            }
            generatedSkus.push(newSku);
            // Global SKU check
            const existingSku = await Variant.findOne({ sku: newSku });
            if (existingSku) {
              await cleanupAllNewFiles();
              return res.status(400).json({ success: false, msg: `SKU '${newSku}' already exists` });
            }

            const unit = await findUnitByIdOrName(varObj.unit);
            if (!unit) {
              await cleanupAllNewFiles();
              return res.status(400).json({ success: false, msg: `Unit not found for new variation ${i}: ${varObj.unit}` });
            }

            const variantData = {
              product: currentProduct._id,
              attribute: varObj.attribute?.trim() || 'Default',
              value: varObj.value?.trim() || 'Standard',
              sku: newSku,
              unit: unit._id,
              purchasePrice: varPurchase,
              price: varPrice,
              stockQuantity: varStock,
              weightQuantity: varWeight,
              status: 'Active'
            };
            if (varObj.discountPrice !== undefined) variantData.discountPrice = varDiscount;
            if (varObj.expiryDate) variantData.expiryDate = new Date(varObj.expiryDate);
            const imagePath = variationImages[i];
            if (imagePath) variantData.image = imagePath;

            const newVariant = new Variant(variantData);
            await newVariant.validate();
            await newVariant.save();
            addVariantIds.push(newVariant._id);
          }
          if (addVariantIds.length > 0) {
            await Product.findByIdAndUpdate(currentProduct._id, { $push: { variations: { $each: addVariantIds } } });
          }
          break;

        case 'update':
          if (variationIndex === undefined || parsedIncomingVariations.length === 0) {
            return res.status(400).json({ success: false, msg: 'Variants array and index required for update operation' });
          }
          const idx = parseInt(variationIndex);
          if (idx < 0 || idx >= currentProduct.variations.length) {
            await cleanupAllNewFiles();
            return res.status(400).json({ success: false, msg: 'Invalid variation index' });
          }
          const variantId = currentProduct.variations[idx]._id;
          const currentVariant = await Variant.findById(variantId);
          const updateVar = parsedIncomingVariations[0];
          if (!updateVar.unit || !updateVar.price) {
            await cleanupAllNewFiles();
            return res.status(400).json({ success: false, msg: 'Updated variation missing required fields (unit, price)' });
          }
          const updateSku = updateVar.sku?.trim() || await generateSKU();
          if (updateSku !== currentVariant.sku) {
            // Check uniqueness if SKU changed
            const existingSku = await Variant.findOne({ sku: updateSku, _id: { $ne: variantId } });
            if (existingSku) {
              await cleanupAllNewFiles();
              return res.status(400).json({ success: false, msg: `SKU '${updateSku}' already exists` });
            }
          }
          const updateVarPrice = parseFloat(updateVar.price);
          const updateVarStock = parseInt(updateVar.stockQuantity || 0);
          const updateVarDiscount = parseFloat(updateVar.discountPrice || 0);
          const updateVarPurchase = parseFloat(updateVar.purchasePrice || 0);
          const updateVarWeight = parseFloat(updateVar.weightQuantity || 0);
          if (isNaN(updateVarPrice) || updateVarPrice <= 0 || isNaN(updateVarStock) || updateVarStock < 0 || isNaN(updateVarPurchase) || updateVarPurchase < 0 || isNaN(updateVarWeight) || updateVarWeight <= 0) {
            await cleanupAllNewFiles();
            return res.status(400).json({ success: false, msg: 'Updated variation invalid price or stock' });
          }
          if (updateVar.discountPrice !== undefined && (isNaN(updateVarDiscount) || updateVarDiscount > updateVarPrice)) {
            await cleanupAllNewFiles();
            return res.status(400).json({ success: false, msg: 'Updated variation invalid discountPrice' });
          }

          const unit = await findUnitByIdOrName(updateVar.unit);
          if (!unit) {
            await cleanupAllNewFiles();
            return res.status(400).json({ success: false, msg: `Unit not found for updated variation: ${updateVar.unit}` });
          }

          const updatedVarData = {
            attribute: updateVar.attribute?.trim() || 'Default',
            value: updateVar.value?.trim() || 'Standard',
            sku: updateSku,
            unit: unit._id,
            price: updateVarPrice,
            stockQuantity: updateVarStock,
            purchasePrice: updateVarPurchase,
            weightQuantity: updateVarWeight
          };
          if (updateVar.discountPrice !== undefined) updatedVarData.discountPrice = updateVarDiscount;
          if (updateVar.expiryDate) updatedVarData.expiryDate = new Date(updateVar.expiryDate);
          // Keep other fields like status unchanged
          const imagePath = variationImages[idx];
          if (imagePath) {
            updatedVarData.image = imagePath;
            if (currentVariant.image) try { await fs.unlink(currentVariant.image); } catch { }
          }

          await Variant.findByIdAndUpdate(variantId, updatedVarData, { new: true, runValidators: true });
          break;

        case 'remove':
          if (variationIndex === undefined) {
            return res.status(400).json({ success: false, msg: 'Variation index required for remove operation' });
          }
          const removeIdx = parseInt(variationIndex);
          if (removeIdx < 0 || removeIdx >= currentProduct.variations.length) {
            return res.status(400).json({ success: false, msg: 'Invalid variation index' });
          }
          const removeVariantId = currentProduct.variations[removeIdx]._id;
          const removeVariant = await Variant.findById(removeVariantId);
          if (removeVariant.image) try { await fs.unlink(removeVariant.image); } catch { }
          await Variant.findByIdAndDelete(removeVariantId);
          await Product.findByIdAndUpdate(currentProduct._id, { $pull: { variations: removeVariantId } });
          break;

        default:
          return res.status(400).json({ success: false, msg: 'Invalid variationOperation: add, update, or remove' });
      }
    }

    if (Object.keys(updateData).length === 0 && newImages.length === 0 && !newThumbnail && !variationOperation) {
      return res.status(400).json({ success: false, msg: 'No fields provided to update' });
    }

    const updatedProduct = await Product.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true })
      .populate([
        { path: 'category', select: 'name' },
        { path: 'subcategory', select: 'subcategoryName' },
        { path: 'brand', select: 'name' },
        { path: 'variations', select: 'attribute value sku price stockQuantity discountPrice image unit purchasePrice expiryDate status weightQuantity' }
      ]);
    if (updatedProduct.variations && updatedProduct.variations.length > 0) {
      await Variant.populate(updatedProduct.variations, { path: 'unit', select: 'unit_name' });
    }

    res.json({
      success: true,
      msg: 'Product updated successfully',
      product: updatedProduct
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
    const product = await Product.findById(req.params.id).populate('variations');
    if (!product) {
      return res.status(404).json({ success: false, msg: 'Product not found' });
    }

    // Cleanup base images and thumbnail
    if (product.images && product.images.length > 0) {
      for (const img of product.images) {
        try { await fs.unlink(img); } catch { }
      }
    }
    if (product.thumbnail) {
      try { await fs.unlink(product.thumbnail); } catch { }
    }

    // Cleanup and delete variations
    if (product.variations && product.variations.length > 0) {
      for (const variation of product.variations) {
        if (variation.image) {
          try { await fs.unlink(variation.image); } catch { }
        }
        await Variant.findByIdAndDelete(variation._id);
      }
    }

    await Product.findByIdAndDelete(req.params.id);

    res.json({ success: true, msg: 'Product deleted successfully' });
  } catch (err) {
    console.error('Product delete error:', err.message || err);
    res.status(500).json({ success: false, msg: 'Server error deleting product', details: err.message || 'Unknown error' });
  }
};

