const fs = require('fs').promises;
const path = require('path');

const Product = require('../model/Product');
const Variant = require('../model/variantProduct');
const Category = require('../model/Category');
const Subcategory = require('../model/subCategory');
const Brand = require('../model/Brand');
const Unit = require('../model/Unit');
const Configuration = require('../model/app_configuration');
const mongoose = require('mongoose');

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
  if (subDoc) {
    if (subDoc.status !== 'Active') {
      return null;
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
  if (mongoose.Types.ObjectId.isValid(trimmedValue)) {
    return await Unit.findOne({ _id: trimmedValue, unit_status: 'enable' });
  }
  return await Unit.findOne({ unit_name: trimmedValue, unit_status: 'enable' });
};


exports.createProduct = async (req, res) => {
  const {
    name,
    category: categoryValue,
    description,
    subCategory: subcategoryValueFromCamel,
    subcategory: subcategoryValueFromSnake,
    brand: brandValue,
    ingredients,
    suitableFor,
    status = 'Active',
    variations,
  } = req.body;

  const subcategoryValue = subcategoryValueFromCamel || subcategoryValueFromSnake;

  // File uploads
  const imagesFiles = req.files?.['images'] ?? [];
  const thumbnailFile = req.files?.['thumbnail']?.[0] ?? null;
  const images = imagesFiles.map(file => file.path);
  const thumbnail = thumbnailFile ? thumbnailFile.path : null;

  // Critical: Declare these early so cleanupAllFiles can use them safely
  const variationImages = {}; // Stores variation_images_0, variation_images_1, etc.
  let parsedVariations = [];

  // Cleanup function — defined early so it can be used in any early return
  const cleanupAllFiles = async () => {
    const filesToDelete = [
      ...imagesFiles.map(f => f.path),
      thumbnailFile?.path,
      ...Object.values(variationImages)
    ].filter(Boolean);

    for (const filePath of filesToDelete) {
      try {
        await fs.unlink(filePath);
      } catch (err) {
        console.warn('Failed to delete file during cleanup:', filePath);
      }
    }
  };

  // Parse variations safely
  if (!variations) {
    await cleanupAllFiles();
    return res.status(400).json({ success: false, msg: 'Variations are required' });
  }

  if (typeof variations === 'string') {
    try {
      parsedVariations = JSON.parse(variations);
      if (!Array.isArray(parsedVariations)) throw new Error('Variations must be an array');
    } catch (e) {
      await cleanupAllFiles();
      return res.status(400).json({ success: false, msg: `Invalid variations JSON: ${e.message}` });
    }
  } else if (Array.isArray(variations)) {
    parsedVariations = variations;
  } else {
    await cleanupAllFiles();
    return res.status(400).json({ success: false, msg: 'Variations must be array or valid JSON string' });
  }

  if (parsedVariations.length === 0) {
    await cleanupAllFiles();
    return res.status(400).json({ success: false, msg: 'At least one variant is required' });
  }

  // Extract variation images (e.g., variation_images_0, variation_images_1)
  for (let i = 0; i < parsedVariations.length; i++) {
    const fieldName = `variation_images_${i}`;
    if (req.files?.[fieldName]?.[0]) {
      variationImages[i] = req.files[fieldName][0].path;
    }
  }

  // Validate status
  if (!['Active', 'Inactive'].includes(status)) {
    await cleanupAllFiles();
    return res.status(400).json({ success: false, msg: 'Status must be Active or Inactive' });
  }

  // Generate product code prefix for SKUs
  const productCode = name
    .trim()
    .split(/\s+/)
    .map(word => word[0])
    .join('')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '') + (name.match(/\d+/) ? name.match(/\d+/)[0] : '');

  // Validate each variation
  for (let i = 0; i < parsedVariations.length; i++) {
    const v = parsedVariations[i];

    const price = parseFloat(v.price);
    const stockQuantity = parseInt(v.stockQuantity, 10);
    const weightQuantity = parseFloat(v.weightQuantity);
    const discountPrice = v.discountPrice !== undefined ? parseFloat(v.discountPrice) : 0;

    if (isNaN(price) || price <= 0 || isNaN(stockQuantity) || stockQuantity < 0 || isNaN(weightQuantity) || weightQuantity <= 0) {
      await cleanupAllFiles();
      return res.status(400).json({
        success: false,
        msg: `Variation ${i + 1}: Invalid price, stock, or weightQuantity`,
      });
    }

    if (v.discountPrice !== undefined && (isNaN(discountPrice) || discountPrice > price)) {
      await cleanupAllFiles();
      return res.status(400).json({
        success: false,
        msg: `Variation ${i + 1}: Discount price cannot exceed regular price`,
      });
    }

    // Generate or validate SKU
    let sku = v.sku?.toString().trim();
    if (!sku) {
      const timestamp = Math.floor(Date.now() / 1000);
      const paddedIndex = (i + 1).toString().padStart(3, '0');
      const randomSuffix = Math.random().toString(36).substr(2, 4);
      sku = `${productCode}-${paddedIndex}-${timestamp}-${randomSuffix}`;
    }

    // Prevent duplicate SKUs in this batch
    const duplicate = parsedVariations.some((item, idx) => {
      const itemSku = item.sku?.toString().trim();
      return idx !== i && itemSku && itemSku === sku;
    });
    if (duplicate) {
      await cleanupAllFiles();
      return res.status(400).json({ success: false, msg: `Duplicate SKU "${sku}" in variations` });
    }

    v.sku = sku; // Assign back

    // Validate expiry date
    if (v.expiryDate) {
      const exp = new Date(v.expiryDate);
      if (isNaN(exp.getTime())) {
        await cleanupAllFiles();
        return res.status(400).json({ success: false, msg: `Variation ${i + 1}: Invalid expiry date` });
      }
      if (exp <= new Date()) {
        v.status = 'Inactive';
      }
    }
  }

  try {
    // Resolve references
    const category = await findCategoryByIdOrName(categoryValue);
    if (!category) {
      await cleanupAllFiles();
      return res.status(400).json({ success: false, msg: 'Category not found' });
    }

    const subcategory = await findSubcategoryByIdOrName(subcategoryValue);
    if (!subcategory) {
      await cleanupAllFiles();
      return res.status(400).json({ success: false, msg: 'Subcategory not found' });
    }

    const brand = await findBrandByIdOrName(brandValue);
    if (!brand) {
      await cleanupAllFiles();
      return res.status(400).json({ success: false, msg: 'Brand not found' });
    }

    const unit = await findUnitByIdOrName(parsedVariations[0].unit);
    if (!unit) {
      await cleanupAllFiles();
      return res.status(400).json({ success: false, msg: 'Unit not found for first variant' });
    }

    // Prevent duplicate product name + brand
    const existingProduct = await Product.findOne({ name: name.trim(), brand: brand._id });
    if (existingProduct) {
      await cleanupAllFiles();
      return res.status(400).json({ success: false, msg: 'Product with this name already exists under this brand' });
    }

    // Create product
    const productData = {
      name: name.trim(),
      category: category._id,
      subcategory: subcategory._id,
      brand: brand._id,
      status,
      createdAt: new Date(),
      updatedAt: new Date(),
      variations: [],
    };

    if (description) productData.description = description.trim();
    if (ingredients) {
      productData.ingredients = Array.isArray(ingredients) ? ingredients.join('\n') : ingredients;
    }
    if (suitableFor) productData.suitableFor = suitableFor;
    if (images.length > 0) productData.images = images;
    if (thumbnail) productData.thumbnail = thumbnail;

    const newProduct = new Product(productData);
    await newProduct.validate();
    await newProduct.save();

    const variantIds = [];

    // Create variants
    for (let i = 0; i < parsedVariations.length; i++) {
      const v = parsedVariations[i];

      const variantData = {
        product: newProduct._id,
        attribute: v.attribute?.trim() || 'Size',
        value: v.value?.trim() || '',
        sku: v.sku,
        unit: unit._id,
        purchasePrice: parseFloat(v.purchasePrice || 0),
        price: parseFloat(v.price),
        discountPrice: parseFloat(v.discountPrice || 0),
        stockQuantity: parseInt(v.stockQuantity, 10),
        weightQuantity: parseFloat(v.weightQuantity),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      if (v.expiryDate) {
        variantData.expiryDate = new Date(v.expiryDate);
      }
      if (variationImages[i]) {
        variantData.image = variationImages[i];
      }
      if (v.status && ['Active', 'Inactive'].includes(v.status)) {
        variantData.status = v.status;
      } else {
        variantData.status = variantData.expiryDate && variantData.expiryDate <= new Date() ? 'Inactive' : 'Active';
      }

      const newVariant = new Variant(variantData);
      const savedVariant = await newVariant.save();
      variantIds.push(savedVariant._id);
    }

    // Attach variants to product
    await Product.findByIdAndUpdate(
      newProduct._id,
      { $set: { variations: variantIds } },
      { new: true }
    );

    // Populate and return
    const populatedProduct = await Product.findById(newProduct._id)
      .populate('category', 'name')
      .populate('subcategory', 'subcategoryName')
      .populate('brand', 'name')
      .populate({
        path: 'variations',
        populate: { path: 'unit', select: 'unit_name' }
      });

    return res.status(201).json({
      success: true,
      msg: 'Product created successfully',
      product: populatedProduct,
    });

  } catch (err) {
    await cleanupAllFiles();

    if (err.code === 11000) {
      return res.status(400).json({
        success: false,
        msg: 'Duplicate SKU or product name+brand combination',
      });
    }

    if (err.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        msg: 'Validation failed: ' + Object.values(err.errors).map(e => e.message).join(', '),
      });
    }

    console.error('Product creation error:', err);
    return res.status(500).json({
      success: false,
      msg: 'Server error during product creation',
      error: err.message,
    });
  }
};

exports.getAllProducts = async (req, res) => {
  const { page = 1, limit, category, subcategory, brand, status, name, lowStock } = req.query;
  const filter = {};
  try {
    // Fetch currency configuration
    const config = await Configuration.findOne().lean();
    if (!config) {
      return res.status(404).json({
        success: false,
        msg: 'App configuration not found',
      });
    }
    const currency = {
      currencyName: config.currencyName || 'US Dollar',
      currencyCode: config.currencyCode || 'USD',
      currencySign: config.currencySign || '$',
    };

    // ---------- FILTER HANDLING ----------
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

    // ---------- BASE AGGREGATION PIPELINE ----------
    let pipeline = [
      { $match: filter },
      {
        $lookup: {
          from: 'categories',
          localField: 'category',
          foreignField: '_id',
          as: 'category',
        },
      },
      { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'subcategories',
          localField: 'subcategory',
          foreignField: '_id',
          as: 'subcategory',
        },
      },
      { $unwind: { path: '$subcategory', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'brands',
          localField: 'brand',
          foreignField: '_id',
          as: 'brand',
        },
      },
      { $unwind: { path: '$brand', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'variants',
          let: { varIds: { $ifNull: ['$variations', []] } },
          pipeline: [
            {
              $match: {
                $expr: { $in: ['$_id', '$$varIds'] },
              },
            },
            {
              $lookup: {
                from: 'units',
                localField: 'unit',
                foreignField: '_id',
                as: 'unit',
              },
            },
            { $unwind: { path: '$unit', preserveNullAndEmptyArrays: true } },
            {
              $addFields: {
                status: {
                  $cond: {
                    if: {
                      $and: [
                        { $ne: ['$expiryDate', null] }, // Check if expiryDate exists
                        { $lt: ['$expiryDate', new Date()] }, // Check if expiryDate is in the past
                      ],
                    },
                    then: 'inactive',
                    else: { $ifNull: ['$status', 'active'] }, // Use existing status or default to active
                  },
                },
              },
            },
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
                _id: 1,
              },
            },
          ],
          as: 'variations',
        },
      },
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
                    { $gte: ['$endDate', '$$currentDate'] },
                  ],
                },
              },
            },
            { $sort: { createdAt: -1 } },
            { $limit: 1 },
            {
              $project: {
                discountType: 1,
                discountValue: 1,
                _id: 0,
              },
            },
          ],
          as: 'activeOffer',
        },
      },
      { $unwind: { path: '$activeOffer', preserveNullAndEmptyArrays: true } },
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
                                {
                                  $multiply: [
                                    { $ifNull: ['$$var.price', 0] },
                                    { $divide: ['$activeOffer.discountValue', 100] },
                                  ],
                                },
                              ],
                            },
                            else: {
                              $subtract: [
                                { $ifNull: ['$$var.price', 0] },
                                '$activeOffer.discountValue',
                              ],
                            },
                          },
                        },
                        else: { $ifNull: ['$$var.price', 0] },
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    ];

    // ---------- LOW STOCK FILTER ----------
    if (lowStock === 'true') {
      pipeline.push({
        $addFields: { totalStock: { $sum: '$variations.stockQuantity' } },
      });
      pipeline.push({ $match: { totalStock: { $lt: 10 } } });
    }

    // ---------- COUNT ----------
    let countPipeline = [...pipeline];
    countPipeline.push({ $count: 'total' });
    const countResult = await Product.aggregate(countPipeline);
    const total = countResult.length > 0 ? countResult[0].total : 0;

    // ---------- PAGINATION STAGES ----------
    const pageNum = parseInt(page);
    const limitNum = limit ? parseInt(limit) : null;
    const sortStage = { $sort: { createdAt: -1 } };
    const projectStage = { $project: { __v: 0, activeOffer: 0 } };
    let fullPipeline = [...pipeline, sortStage];
    if (limitNum && !isNaN(limitNum)) {
      fullPipeline.push({ $skip: (pageNum - 1) * limitNum });
      fullPipeline.push({ $limit: limitNum });
    }
    fullPipeline.push(projectStage);

    // ---------- EXECUTE QUERY ----------
    const products = await Product.aggregate(fullPipeline);
    res.json({
      success: true,
      products,
      currency,
      total,
      pages: limitNum ? Math.ceil(total / limitNum) : 1,
      currentPage: pageNum,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      msg: 'Server error fetching products',
      details: err.message || 'Unknown error',
    });
  }
};



exports.getProductById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, msg: 'Invalid product ID' });
    }

    // Fetch currency configuration
    const config = await Configuration.findOne().lean();
    if (!config) {
      return res.status(404).json({
        success: false,
        msg: 'App configuration not found',
      });
    }
    const currency = {
      currencyName: config.currencyName || 'US Dollar',
      currencyCode: config.currencyCode || 'USD',
      currencySign: config.currencySign || '$',
    };

    const pipeline = [
      { $match: { _id: new mongoose.Types.ObjectId(id) } },
      {
        $lookup: {
          from: 'categories',
          localField: 'category',
          foreignField: '_id',
          as: 'category',
        },
      },
      { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'subcategories',
          localField: 'subcategory',
          foreignField: '_id',
          as: 'subcategory',
        },
      },
      { $unwind: { path: '$subcategory', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'brands',
          localField: 'brand',
          foreignField: '_id',
          as: 'brand',
        },
      },
      { $unwind: { path: '$brand', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'variants',
          let: { varIds: { $ifNull: ['$variations', []] } },
          pipeline: [
            {
              $match: {
                $expr: { $in: ['$_id', '$$varIds'] },
              },
            },
            {
              $lookup: {
                from: 'units',
                localField: 'unit',
                foreignField: '_id',
                as: 'unit',
              },
            },
            { $unwind: { path: '$unit', preserveNullAndEmptyArrays: true } },
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
                _id: 1,
              },
            },
          ],
          as: 'variations',
        },
      },
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
                    { $gte: ['$endDate', '$$currentDate'] },
                  ],
                },
              },
            },
            { $sort: { createdAt: -1 } },
            { $limit: 1 },
            {
              $project: {
                discountType: 1,
                discountValue: 1,
                _id: 0,
              },
            },
          ],
          as: 'activeOffer',
        },
      },
      { $unwind: { path: '$activeOffer', preserveNullAndEmptyArrays: true } },
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
                                {
                                  $multiply: [
                                    { $ifNull: ['$$var.price', 0] },
                                    { $divide: ['$activeOffer.discountValue', 100] },
                                  ],
                                },
                              ],
                            },
                            else: {
                              $subtract: [
                                { $ifNull: ['$$var.price', 0] },
                                '$activeOffer.discountValue',
                              ],
                            },
                          },
                        },
                        else: { $ifNull: ['$$var.price', 0] },
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
      { $unset: '__v' },
    ];

    const products = await Product.aggregate(pipeline);
    if (products.length === 0) {
      return res.status(404).json({ success: false, msg: 'Product not found' });
    }

    const product = products[0];

    res.json({
      success: true,
      message: 'Product fetched successfully',
      product,
      currency, // Add currency details to response
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      msg: 'Server error fetching product',
      details: err.message || 'Unknown error',
    });
  }
};

exports.updateProduct = async (req, res) => {
  const cleanupAllFiles = async (files = [], varImgs = {}) => {
    const all = [
      ...files,
      ...Object.values(varImgs).filter(Boolean)
    ].filter(f => f?.path || typeof f === 'string');

    for (const f of all) {
      try {
        await fs.unlink(f.path || f);
      } catch (err) {
        // Ignore file deletion errors
      }
    }
  };

  let variationImages = {}; // To hold new variant images

  try {
    const productId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, msg: 'Invalid product ID' });
    }

    const existingProduct = await Product.findById(productId).populate('variations');
    if (!existingProduct) {
      return res.status(404).json({ success: false, msg: 'Product not found' });
    }

    const {
      name,
      category: categoryValue,
      subcategory: subcategoryValue,
      brand: brandValue,
      ingredients,
      suitableFor,
      description,
      status,
      variations,
    } = req.body;

    // File uploads
    const newImagesFiles = req.files?.['images'] ?? [];
    const newThumbnailFile = req.files?.['thumbnail']?.[0] ?? null;
    const newImages = newImagesFiles.map(f => f.path);
    const newThumbnail = newThumbnailFile ? newThumbnailFile.path : null;

    let parsedVariations = [];
    if (variations) {
      if (typeof variations === 'string') {
        try {
          parsedVariations = JSON.parse(variations);
          if (!Array.isArray(parsedVariations)) throw new Error('Not an array');
        } catch (e) {
          await cleanupAllFiles([...newImagesFiles, newThumbnailFile], variationImages);
          return res.status(400).json({ success: false, msg: `Invalid variations JSON: ${e.message}` });
        }
      } else if (Array.isArray(variations)) {
        parsedVariations = variations;
      } else {
        await cleanupAllFiles([...newImagesFiles, newThumbnailFile], variationImages);
        return res.status(400).json({ success: false, msg: 'Variations must be array or JSON string' });
      }

      // Extract variation images
      for (let i = 0; i < parsedVariations.length; i++) {
        const field = `variation_images_${i}`;
        if (req.files?.[field]?.[0]) {
          variationImages[i] = req.files[field][0].path;
        }
      }
    }

    if (status && !['Active', 'Inactive'].includes(status)) {
      await cleanupAllFiles([...newImagesFiles, newThumbnailFile], variationImages);
      return res.status(400).json({ success: false, msg: 'Invalid status' });
    }

    // Resolve references
    if (categoryValue) {
      const cat = await findCategoryByIdOrName(categoryValue);
      if (!cat) return res.status(400).json({ success: false, msg: 'Category not found' });
      existingProduct.category = cat._id;
    }
    if (subcategoryValue) {
      const sub = await findSubcategoryByIdOrName(subcategoryValue);
      if (!sub) return res.status(400).json({ success: false, msg: 'Subcategory not found' });
      existingProduct.subcategory = sub._id;
    }
    if (brandValue) {
      const br = await findBrandByIdOrName(brandValue);
      if (!br) return res.status(400).json({ success: false, msg: 'Brand not found' });
      existingProduct.brand = br._id;
    }

    // Update product fields
    existingProduct.name = name ? name.trim() : existingProduct.name;
    existingProduct.ingredients = ingredients
      ? (Array.isArray(ingredients) ? ingredients.join('\n') : ingredients).trim()
      : existingProduct.ingredients;
    existingProduct.suitableFor = suitableFor ?? existingProduct.suitableFor;
    existingProduct.description = description ? description.trim() : existingProduct.description;
    existingProduct.status = status ?? existingProduct.status;
    existingProduct.updatedAt = new Date();

    const oldImages = existingProduct.images ?? [];
    const oldThumbnail = existingProduct.thumbnail;

    if (newImages.length > 0) existingProduct.images = newImages;
    if (newThumbnail) existingProduct.thumbnail = newThumbnail;

    // Generate product code for SKU prefix
    const productCode = existingProduct.name
      .trim()
      .split(/\s+/)
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '') +
      (existingProduct.name.match(/\d+/) ? existingProduct.name.match(/\d+/)[0] : '');

    const variantIds = [];

    if (parsedVariations.length > 0) {
      // Process each variation
      for (let i = 0; i < parsedVariations.length; i++) {
        const v = parsedVariations[i];

        const price = parseFloat(v.price);
        const stockQuantity = parseInt(v.stockQuantity, 10);
        const weightQuantity = parseFloat(v.weightQuantity);

        if (isNaN(price) || price <= 0 || isNaN(stockQuantity) || stockQuantity < 0 || isNaN(weightQuantity) || weightQuantity <= 0) {
          await cleanupAllFiles([...newImagesFiles, newThumbnailFile], variationImages);
          return res.status(400).json({ success: false, msg: `Variation ${i + 1}: Invalid price, stock, or weight` });
        }

        const discountPrice = v.discountPrice !== undefined ? parseFloat(v.discountPrice) : 0;
        if (v.discountPrice !== undefined && (isNaN(discountPrice) || discountPrice > price)) {
          await cleanupAllFiles([...newImagesFiles, newThumbnailFile], variationImages);
          return res.status(400).json({ success: false, msg: `Variation ${i + 1}: Discount cannot exceed price` });
        }

        // Auto-generate SKU if missing or empty
        let sku = (v.sku || '').toString().trim();
        if (!sku) {
          const timestamp = Math.floor(Date.now() / 1000);
          const paddedIndex = (i + 1).toString().padStart(3, '0');
          const randomSuffix = Math.random().toString(36).substr(2, 4);
          sku = `${productCode}-${paddedIndex}-${timestamp}-${randomSuffix}`;
        }

        // Prevent duplicate SKUs in this request
        const duplicateInRequest = parsedVariations.some((item, idx) => {
          const itemSku = (item.sku || '').toString().trim();
          return idx !== i && itemSku === sku;
        });
        if (duplicateInRequest) {
          await cleanupAllFiles([...newImagesFiles, newThumbnailFile], variationImages);
          return res.status(400).json({ success: false, msg: `Duplicate SKU "${sku}" in variations` });
        }

        const unit = await findUnitByIdOrName(v.unit);
        if (!unit) {
          await cleanupAllFiles([...newImagesFiles, newThumbnailFile], variationImages);
          return res.status(400).json({ success: false, msg: `Unit not found: ${v.unit}` });
        }

        // Find existing variant by SKU (if updating)
        let existingVariant = null;
        if (v.sku && v.sku.trim()) {
          existingVariant = await Variant.findOne({ sku: v.sku.trim() });
        }

        const variantUpdate = {
          product: productId,
          attribute: v.attribute?.trim() || 'Size',
          value: v.value?.trim() || '',
          sku,
          unit: unit._id,
          purchasePrice: parseFloat(v.purchasePrice || 0),
          price,
          discountPrice: discountPrice || 0,
          stockQuantity,
          weightQuantity,
          updatedAt: new Date(),
        };

        if (variationImages[i]) variantUpdate.image = variationImages[i];

        // Handle expiry date
        if (v.expiryDate !== undefined) {
          if (v.expiryDate === null || v.expiryDate === '') {
            variantUpdate.expiryDate = null;
          } else {
            const exp = new Date(v.expiryDate);
            if (isNaN(exp.getTime())) {
              await cleanupAllFiles([...newImagesFiles, newThumbnailFile], variationImages);
              return res.status(400).json({ success: false, msg: `Variation ${i + 1}: Invalid expiry date` });
            }
            variantUpdate.expiryDate = exp;
          }
        }

        // Auto-set status based on expiry
        if (variantUpdate.expiryDate && variantUpdate.expiryDate <= new Date()) {
          variantUpdate.status = 'Inactive';
        } else if (v.status && ['Active', 'Inactive'].includes(v.status)) {
          variantUpdate.status = v.status;
        } else if (existingVariant) {
          variantUpdate.status = existingVariant.status;
        } else {
          variantUpdate.status = 'Active';
        }

        let savedVariant;
        if (existingVariant) {
          // Update existing
          const variantDoc = await Variant.findById(existingVariant._id);
          const oldImage = variantDoc.image;

          Object.assign(variantDoc, variantUpdate);
          await variantDoc.validate();
          savedVariant = await variantDoc.save();

          // Delete old image if replaced
          if (oldImage && variationImages[i] && oldImage !== variationImages[i]) {
            try { await fs.unlink(oldImage); } catch {}
          }
        } else {
          // Create new
          const newVariant = new Variant({
            ...variantUpdate,
            createdAt: new Date(),
          });
          await newVariant.validate();
          savedVariant = await newVariant.save();
        }

        variantIds.push(savedVariant._id);
      }

      // Remove old variants not in new list
      const currentVariantIds = existingProduct.variations.map(v => v._id.toString());
      const newVariantIds = variantIds.map(id => id.toString());
      const toDelete = currentVariantIds.filter(id => !newVariantIds.includes(id));

      for (const vid of toDelete) {
        const variant = await Variant.findById(vid);
        if (variant?.image) {
          try { await fs.unlink(variant.image); } catch {}
        }
        await Variant.findByIdAndDelete(vid);
      }

      existingProduct.variations = variantIds;
    }

    // Update total stock
    const activeVariants = await Variant.find({ product: productId, status: 'Active' });
    existingProduct.stockQuantity = activeVariants.reduce((sum, v) => sum + v.stockQuantity, 0);

    // Delete old product images if replaced
    if (newImages.length > 0 && oldImages.length > 0) {
      for (const img of oldImages) {
        try { await fs.unlink(img); } catch {}
      }
    }
    if (newThumbnail && oldThumbnail && newThumbnail !== oldThumbnail) {
      try { await fs.unlink(oldThumbnail); } catch {}
    }

    await existingProduct.save();

    // Return populated product
    const populatedProduct = await Product.findById(productId)
      .populate('category', 'name')
      .populate('subcategory', 'subcategoryName')
      .populate('brand', 'name')
      .populate({
        path: 'variations',
        populate: { path: 'unit', select: 'unit_name' }
      });

    res.json({
      success: true,
      msg: 'Product updated successfully',
      data: populatedProduct,
    });

  } catch (err) {
    await cleanupAllFiles([
      ...(req.files?.['images'] ?? []),
      ...(req.files?.['thumbnail'] ? [req.files['thumbnail'][0]] : []),
    ], variationImages);

    if (err.code === 11000) {
      return res.status(400).json({ success: false, msg: 'Duplicate SKU or product name+brand' });
    }
    if (err.name === 'ValidationError') {
      return res.status(400).json({ success: false, msg: err.message });
    }

    res.status(500).json({
      success: false,
      msg: 'Server error during update',
      error: err.message,
    });
  }
};


exports.deleteProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).populate('variations');
    if (!product) {
      return res.status(404).json({ success: false, msg: 'Product not found' });
    }

    if (product.images && product.images.length > 0) {
      for (const img of product.images) {
        try { await fs.unlink(img); } catch { }
      }
    }
    if (product.thumbnail) {
      try { await fs.unlink(product.thumbnail); } catch { }
    }

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
    res.status(500).json({ success: false, msg: 'Server error deleting product', details: err.message || 'Unknown error' });
  }
};





