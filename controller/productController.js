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



const generateSKU = async () => {
  const lastVariant = await Variant.findOne().sort({ createdAt: -1 });
  let nextNumber = 1;
  if (lastVariant && lastVariant.sku) {
    const match = lastVariant.sku.match(/SKU-NUM-(\d+)/);
    if (match) nextNumber = parseInt(match[1], 10) + 1;
  }
  return `SKU-NUM-${String(nextNumber).padStart(3, '0')}`;
};



const findUnitByIdOrName = async (value) => {
  if (!value) return null;
  const trimmedValue = value.toString().trim();
  if (mongoose.Types.ObjectId.isValid(trimmedValue)) {
    return await Unit.findOne({ _id: trimmedValue, unit_status: 'enable' });
  }
  return await Unit.findOne({ unit_name: trimmedValue, unit_status: 'enable' });
};

exports.createProduct = async (req, res) => {
  console.log('DEBUG: Full req.body:', req.body);
  console.log('DEBUG: req.body.variations:', req.body.variations);
  console.log('DEBUG: typeof req.body.variations:', typeof req.body.variations);

  const { name, category: categoryValue, description, subCategory: subcategoryValueFromCamel, subcategory: subcategoryValueFromSnake, brand: brandValue, ingredients, suitableFor, status = 'Active', variations } = req.body;

  const subcategoryValue = subcategoryValueFromCamel || subcategoryValueFromSnake;

  // Handle file uploads
  const imagesFiles = req.files && req.files['images'] ? req.files['images'] : [];
  const thumbnailFile = req.files && req.files['thumbnail'] ? req.files['thumbnail'][0] : null;
  const images = imagesFiles.map(file => file.path);
  const thumbnail = thumbnailFile ? thumbnailFile.path : null;

  // Handle variation images
  const variationImages = {};
  let parsedVariations = [];
  if (variations) {
    if (typeof variations === 'string') {
      try {
        parsedVariations = JSON.parse(variations);
        if (!Array.isArray(parsedVariations)) {
          throw new Error('Variations is not an array');
        }
      } catch (e) {
        await cleanupAllFiles();
        return res.status(400).json({ success: false, msg: `Invalid variations format: ${e.message}` });
      }
    } else if (Array.isArray(variations)) {
      parsedVariations = variations;
    } else {
      await cleanupAllFiles();
      return res.status(400).json({ success: false, msg: 'Variations must be an array or stringified JSON array' });
    }

    for (let i = 0; i < parsedVariations.length; i++) {
      const fieldName = `variation_images_${i}`;
      if (req.files && req.files[fieldName]) {
        variationImages[i] = req.files[fieldName][0].path;
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

  // Validate variants
  if (parsedVariations.length === 0) {
    await cleanupAllFiles();
    return res.status(400).json({ success: false, msg: 'At least one variant required' });
  }

  for (let i = 0; i < parsedVariations.length; i++) {
    const varObj = parsedVariations[i];
    if (!varObj.attribute || !varObj.value || !varObj.sku || varObj.sku.trim() === '') {
      await cleanupAllFiles();
      return res.status(400).json({ success: false, msg: `Variation ${i} missing required fields: attribute, value, or sku` });
    }
    const varPrice = parseFloat(varObj.price);
    const varStock = parseInt(varObj.stockQuantity);
    const varDiscount = parseFloat(varObj.discountPrice || 0);
    const varWeightQuantity = parseFloat(varObj.weightQuantity);
    if (isNaN(varPrice) || varPrice <= 0 || isNaN(varStock) || varStock < 0 || isNaN(varWeightQuantity) || varWeightQuantity <= 0) {
      await cleanupAllFiles();
      return res.status(400).json({ success: false, msg: `Variation ${i} invalid price, stock, or weightQuantity` });
    }
    if (varObj.discountPrice !== undefined && (isNaN(varDiscount) || varDiscount > varPrice)) {
      await cleanupAllFiles();
      return res.status(400).json({ success: false, msg: `Variation ${i} invalid discountPrice` });
    }
    const skuExists = parsedVariations.some((v, idx) => idx !== i && v.sku.trim() === varObj.sku.trim());
    if (skuExists) {
      await cleanupAllFiles();
      return res.status(400).json({ success: false, msg: `Duplicate SKU in variations` });
    }
  }

  try {
    const category = await findCategoryByIdOrName(categoryValue);
    if (!category) {
      await cleanupAllFiles();
      return res.status(400).json({ success: false, msg: `Category not found for value: ${categoryValue}` });
    }

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

    const unit = await findUnitByIdOrName(parsedVariations[0].unit);
    if (!unit) {
      await cleanupAllFiles();
      return res.status(400).json({ success: false, msg: `Unit not found for value: ${parsedVariations[0].unit}` });
    }

    const existingProduct = await Product.findOne({ name: name.trim(), brand: brand._id });
    if (existingProduct) {
      await cleanupAllFiles();
      return res.status(400).json({ success: false, msg: 'Product with this name already exists under this brand' });
    }

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
    await newProduct.save();
    console.log('DEBUG: Product saved with _id:', newProduct._id);

    let variantIds = [];
    for (const varObj of parsedVariations) {
      const existingVariant = await Variant.findOne({ sku: varObj.sku.trim() });
      if (existingVariant) {
        await cleanupAllFiles();
        await Product.findByIdAndDelete(newProduct._id);
        if (newProduct.images && newProduct.images.length > 0) {
          for (const img of newProduct.images) {
            try { await fs.unlink(img); } catch { }
          }
        }
        if (newProduct.thumbnail) try { await fs.unlink(newProduct.thumbnail); } catch { }
        return res.status(400).json({ success: false, msg: `SKU '${varObj.sku}' already exists` });
      }
    }

    for (let i = 0; i < parsedVariations.length; i++) {
      const varObj = parsedVariations[i];
      const variantData = {
        product: newProduct._id,
        attribute: varObj.attribute.trim(),
        value: varObj.value.trim(),
        sku: varObj.sku.trim(),
        unit: unit._id,
        purchasePrice: parseFloat(varObj.purchasePrice),
        price: parseFloat(varObj.price),
        discountPrice: parseFloat(varObj.discountPrice || 0),
        stockQuantity: parseInt(varObj.stockQuantity),
        weightQuantity: parseFloat(varObj.weightQuantity),
        status: 'Active',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      if (varObj.expiryDate) variantData.expiryDate = new Date(varObj.expiryDate);
      const imagePath = variationImages[i];
      if (imagePath) variantData.image = imagePath;

      console.log('DEBUG: Creating variant with data:', JSON.stringify(variantData, null, 2));
      const newVariant = new Variant(variantData);
      try {
        await newVariant.validate();
        console.log('DEBUG: Variant validation passed for SKU:', varObj.sku);
        const savedVariant = await newVariant.save();
        console.log('DEBUG: Variant saved with _id:', savedVariant._id);
        variantIds.push(savedVariant._id);
      } catch (validationError) {
        console.error('DEBUG: Variant validation failed:', validationError.message);
        await cleanupAllFiles();
        await Product.findByIdAndDelete(newProduct._id);
        if (newProduct.images && newProduct.images.length > 0) {
          for (const img of newProduct.images) {
            try { await fs.unlink(img); } catch { }
          }
        }
        if (newProduct.thumbnail) try { await fs.unlink(newProduct.thumbnail); } catch { }
        return res.status(400).json({ success: false, msg: `Variant validation failed: ${validationError.message}` });
      }
    }

    if (variantIds.length > 0) {
      console.log('DEBUG: Updating product with variantIds:', variantIds);
      await Product.findByIdAndUpdate(
        newProduct._id,
        { $push: { variations: { $each: variantIds } } },
        { new: true }
      );
      // Reload the product to ensure variations are included
      const updatedProduct = await Product.findById(newProduct._id);
      console.log('DEBUG: Updated product before population:', JSON.stringify(updatedProduct, null, 2));

      // Populate the product fields
      await updatedProduct.populate([
        { path: 'category', select: 'name' },
        { path: 'subcategory', select: 'subcategoryName' },
        { path: 'brand', select: 'name' },
        { path: 'variations', select: 'attribute value sku price stockQuantity discountPrice image unit purchasePrice expiryDate status weightQuantity createdAt updatedAt' }
      ]);

      if (variantIds.length > 0) {
        console.log('DEBUG: Populating unit for variations:', updatedProduct.variations);
        await updatedProduct.populate({ path: 'variations.unit', select: 'unit_name' });
      }

      console.log('DEBUG: Final product response:', JSON.stringify(updatedProduct, null, 2));
      res.status(201).json({
        success: true,
        msg: 'Product created successfully',
        product: updatedProduct
      });
    } else {
      console.error('DEBUG: No variants created, variantIds is empty');
      await cleanupAllFiles();
      await Product.findByIdAndDelete(newProduct._id);
      if (newProduct.images && newProduct.images.length > 0) {
        for (const img of newProduct.images) {
          try { await fs.unlink(img); } catch { }
        }
      }
      if (newProduct.thumbnail) try { await fs.unlink(newProduct.thumbnail); } catch { }
      return res.status(400).json({ success: false, msg: 'Failed to create variants' });
    }
  } catch (err) {
    console.error('DEBUG: Product creation error:', err.message || err);
    await cleanupAllFiles();
    if (err.name === 'MongoServerError' && err.code === 11000) {
      return res.status(400).json({ success: false, msg: `Duplicate data detected: ${err.errmsg || 'Check SKU or product name/brand uniqueness'}` });
    }
    if (err.name === 'ValidationError') {
      return res.status(400).json({ success: false, msg: `Validation error: ${Object.values(err.errors).map(e => e.message).join(', ')}` });
    }
    res.status(500).json({ success: false, msg: 'Server error during product creation', details: err.message || 'Unknown error' });
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
  try {
    const productId = req.params.id;
    const {
      name,
      category,
      subcategory,
      brand,
      ingredients,
      suitableFor,
      description,
      status,
      variations // Array of variant objects (from frontend)
    } = req.body;


    const existingProduct = await Product.findById(productId);
    if (!existingProduct) {
      return res.status(404).json({ success: false, msg: "Product not found" });
    }

    existingProduct.name = name || existingProduct.name;
    existingProduct.category = category || existingProduct.category;
    existingProduct.subcategory = subcategory || existingProduct.subcategory;
    existingProduct.brand = brand || existingProduct.brand;
    existingProduct.ingredients = ingredients || existingProduct.ingredients;
    existingProduct.suitableFor = suitableFor || existingProduct.suitableFor;
    existingProduct.description = description || existingProduct.description;
    existingProduct.status = status || existingProduct.status;
    existingProduct.updatedAt = new Date().toISOString();

    let variantIds = [];

    if (Array.isArray(variations) && variations.length > 0) {
      for (const variantData of variations) {
        let variant = await Variant.findOne({ sku: variantData.sku });

        if (variant) {
          Object.assign(variant, variantData, { product: productId });
          await variant.save();
        } else {
          // Create new variant
          variant = new Variant({
            ...variantData,
            product: productId
          });
          await variant.save();
        }

        variantIds.push(variant._id);
      }
    }

    if (variantIds.length > 0) {
      existingProduct.variations = variantIds;
    }

    await existingProduct.save();

    const populatedProduct = await existingProduct.populate("variations");

    res.status(200).json({
      success: true,
      msg: "Product updated successfully",
      data: populatedProduct
    });

  } catch (err) {
    console.error("Error updating product:", err);
    res.status(500).json({
      success: false,
      msg: "Server error while updating product",
      error: err.message
    });
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


