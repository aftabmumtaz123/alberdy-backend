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
  const imagesFiles = req.files && req.files['images'] ? req.files['images'] : [];
  const thumbnailFile = req.files && req.files['thumbnail'] ? req.files['thumbnail'][0] : null;
  const images = imagesFiles.map((file) => file.path);
  const thumbnail = thumbnailFile ? thumbnailFile.path : null;

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

  const cleanupAllFiles = async () => {
    const allFiles = [...imagesFiles, thumbnailFile, ...Object.values(variationImages).filter(Boolean)].filter(
      (f) => f
    );
    for (const file of allFiles) {
      try {
        await fs.unlink(file.path || file);
      } catch {}
    }
  };


  if (!['Active', 'Inactive'].includes(status)) {
    await cleanupAllFiles();
    return res.status(400).json({ success: false, msg: 'Invalid status' });
  }

  if (parsedVariations.length === 0) {
    await cleanupAllFiles();
    return res.status(400).json({ success: false, msg: 'At least one variant required' });
  }

  const productCode = name
    .trim()
    .split(/\s+/)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '') + (name.match(/\d+/) ? name.match(/\d+/)[0] : '');

  for (let i = 0; i < parsedVariations.length; i++) {
    const varObj = parsedVariations[i];

    const varPrice = parseFloat(varObj.price);
    const varStock = parseInt(varObj.stockQuantity);
    const varDiscount = parseFloat(varObj.discountPrice || 0);
    const varWeightQuantity = parseFloat(varObj.weightQuantity);
    if (
      isNaN(varPrice) ||
      varPrice <= 0 ||
      isNaN(varStock) ||
      varStock < 0 ||
      isNaN(varWeightQuantity) ||
      varWeightQuantity <= 0
    ) {
      await cleanupAllFiles();
      return res.status(400).json({
        success: false,
        msg: `Variation for ${i + 1} invalid price, stock, or weightQuantity`,
      });
    }
    if (varObj.discountPrice !== undefined && (isNaN(varDiscount) || varDiscount > varPrice)) {
      await cleanupAllFiles();
      return res.status(400).json({ success: false, msg: `Variation for ${i + 1} invalid discountPrice` });
    }

    // Validate expiryDate and status
    if (varObj.expiryDate) {
      const expiry = new Date(varObj.expiryDate);
      if (isNaN(expiry.getTime())) {
        await cleanupAllFiles();
        return res.status(400).json({ success: false, msg: `Variation ${i + 1}: Invalid expiry date format` });
      }
      if (expiry.getTime() < Date.now() && varObj.status === 'Active') {
        await cleanupAllFiles();
        return res.status(400).json({
          success: false,
          msg: `Variation ${i + 1}: Expiry date cannot be today or in the past. Please select a future date.`,
        });
      }
    }

    if (!varObj.sku || varObj.sku.trim() === '') {
      const timestamp = Math.floor(Date.now() / 1000);
      varObj.sku = `${productCode}-${(i + 1).toString().padStart(3, '0')}-${timestamp}`;
    } else {
      varObj.sku = varObj.sku.trim();
    }

    const skuExists = await Variant.findOne({ sku: varObj.sku });
    if (skuExists) {
      await cleanupAllFiles();
      return res.status(400).json({ success: false, msg: `SKU '${varObj.sku}' already exists` });
    }
    const duplicateInBatch = parsedVariations.some((v, idx) => idx !== i && v.sku && v.sku.trim() === varObj.sku);
    if (duplicateInBatch) {
      await cleanupAllFiles();
      return res.status(400).json({ success: false, msg: `Duplicate SKU '${varObj.sku}' in variations` });
    }
  }

  try {
    const category = await findCategoryByIdOrName(categoryValue);
    if (!category) {
      await cleanupAllFiles();
      return res.status(400).json({ success: false, msg: `Category not found` });
    }

    const subcategory = await findSubcategoryByIdOrName(subcategoryValue);
    if (!subcategory) {
      await cleanupAllFiles();
      return res.status(400).json({ success: false, msg: `Subcategory not found` });
    }

    const brand = await findBrandByIdOrName(brandValue);
    if (!brand) {
      await cleanupAllFiles();
      return res.status(400).json({ success: false, msg: `Brand not found` });
    }

    const unit = await findUnitByIdOrName(parsedVariations[0].unit);
    if (!unit) {
      await cleanupAllFiles();
      return res.status(400).json({ success: false, msg: `Unit not found` });
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
      createdAt: new Date(),
      updatedAt: new Date(),
      variations: [],
    };
    if (ingredientsString) productData.ingredients = ingredientsString.trim();
    if (suitableFor) productData.suitableFor = suitableFor;
    if (images.length > 0) productData.images = images;
    if (thumbnail) productData.thumbnail = thumbnail;
    if (description) productData.description = description.trim();





    const newProduct = new Product(productData);
    await newProduct.validate();
    await newProduct.save();

    let variantIds = [];
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
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      if (varObj.expiryDate) {
        variantData.expiryDate = new Date(varObj.expiryDate);
      }
      if (variationImages[i]) {
        variantData.image = variationImages[i];
      }
      if (varObj.status && ['Active', 'Inactive'].includes(varObj.status)) {
        variantData.status = varObj.status;
      }

      if(varObj.stockQuantity <= 0){
        return res.status(400).json({ success: false, msg: `Stock quantity must be greater than zero for variant ${i + 1}` });
      }

      const newVariant = new Variant(variantData);
      try {
        await newVariant.validate();
        const savedVariant = await newVariant.save();
        variantIds.push(savedVariant._id);
      } catch (validationError) {
        await cleanupAllFiles();
        await Product.findByIdAndDelete(newProduct._id);
        if (newProduct.images && newProduct.images.length > 0) {
          for (const img of newProduct.images) {
            try {
              await fs.unlink(img);
            } catch {}
          }
        }
        if (newProduct.thumbnail) {
          try {
            await fs.unlink(newProduct.thumbnail);
          } catch {}
        }
        return res.status(400).json({ success: false, msg: `Variant validation failed: ${validationError.message}` });
      }
    }

    if (variantIds.length > 0) {
      await Product.findByIdAndUpdate(newProduct._id, { $push: { variations: { $each: variantIds } } }, { new: true });
      const updatedProduct = await Product.findById(newProduct._id);

      await updatedProduct.populate([
        { path: 'category', select: 'name' },
        { path: 'subcategory', select: 'subcategoryName' },
        { path: 'brand', select: 'name' },
        {
          path: 'variations',
          select: 'attribute value sku price stockQuantity discountPrice image unit purchasePrice expiryDate status weightQuantity createdAt updatedAt',
        },
      ]);

      if (variantIds.length > 0) {
        await updatedProduct.populate({ path: 'variations.unit', select: 'unit_name' });
      }

      res.status(201).json({
        success: true,
        msg: 'Product created successfully',
        product: updatedProduct,
      });
    } else {
      await cleanupAllFiles();
      await Product.findByIdAndDelete(newProduct._id);
      if (newProduct.images && newProduct.images.length > 0) {
        for (const img of newProduct.images) {
          try {
            await fs.unlink(img);
          } catch {}
        }
      }
      if (newProduct.thumbnail) {
        try {
          await fs.unlink(newProduct.thumbnail);
        } catch {}
      }
      return res.status(400).json({ success: false, msg: 'Failed to create variants' });
    }
  } catch (err) {
    await cleanupAllFiles();
    if (err.name === 'MongoServerError' && err.code === 11000) {
      return res.status(400).json({
        success: false,
        msg: `Duplicate data detected: ${err.errmsg || 'Check SKU or product name/brand uniqueness'}`,
      });
    }
    if (err.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        msg: `Validation error: ${Object.values(err.errors).map((e) => e.message).join(', ')}`,
      });
    }
    res.status(500).json({
      success: false,
      msg: 'Server error during product creation',
      details: err.message || 'Unknown error',
    });
  }
};



exports.getAllProducts = async (req, res) => {
  const { page = 1, limit, category, subcategory, brand, status, name, lowStock } = req.query;
  const filter = {};
  try {
    // Fetch currency configuration
    const config = await Configuration.findOne().lean(); // Fetch the first configuration
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
                        { $ifNull: ['$expiryDate', false] },
                        { $lt: ['$expiryDate', new Date()] },
                      ],
                    },
                    then: 'inactive',
                    else: { $ifNull: ['$status', 'active'] },
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
      currency, // Add currency details to response
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
    const all = [...files, ...Object.values(varImgs).filter(Boolean)].filter(f => f?.path);
    for (const f of all) {
      try {
        await fs.unlink(f.path || f);
      } catch {}
    }
  };

  try {
    const productId = req.params.id;

    // Load existing product
    const existingProduct = await Product.findById(productId).populate('variations');
    if (!existingProduct) {
      return res.status(404).json({ success: false, msg: 'Product not found' });
    }

    // Parse body
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

    // Handle file uploads
    const imagesFiles = req.files?.['images'] ?? [];
    const thumbnailFile = req.files?.['thumbnail']?.[0] ?? null;
    const newImages = imagesFiles.map(f => f.path);
    const newThumbnail = thumbnailFile ? thumbnailFile.path : null;

    const variationImages = {};
    let parsedVariations = [];

    if (variations) {
      if (typeof variations === 'string') {
        try {
          parsedVariations = JSON.parse(variations);
          if (!Array.isArray(parsedVariations)) throw new Error('Not an array');
        } catch (e) {
          await cleanupAllFiles([...imagesFiles, thumbnailFile], variationImages);
          return res.status(400).json({ success: false, msg: `Invalid variations format: ${e.message}` });
        }
      } else if (Array.isArray(variations)) {
        parsedVariations = variations;
      } else {
        await cleanupAllFiles([...imagesFiles, thumbnailFile], variationImages);
        return res.status(400).json({ success: false, msg: 'Variations must be array or JSON string' });
      }

      for (let i = 0; i < parsedVariations.length; i++) {
        const field = `variation_images_${i}`;
        if (req.files?.[field]) variationImages[i] = req.files[field][0].path;
      }
    }

    if (status && !['Active', 'Inactive'].includes(status)) {
      await cleanupAllFiles([...imagesFiles, thumbnailFile], variationImages);
      return res.status(400).json({ success: false, msg: 'Invalid status' });
    }

    // Resolve references
    if (categoryValue) {
      const cat = await findCategoryByIdOrName(categoryValue);
      if (!cat) {
        await cleanupAllFiles([...imagesFiles, thumbnailFile], variationImages);
        return res.status(400).json({ success: false, msg: `Category not found: ${categoryValue}` });
      }
      existingProduct.category = cat._id;
    }
    if (subcategoryValue) {
      const sub = await findSubcategoryByIdOrName(subcategoryValue);
      if (!sub) {
        await cleanupAllFiles([...imagesFiles, thumbnailFile], variationImages);
        return res.status(400).json({ success: false, msg: `Subcategory not found: ${subcategoryValue}` });
      }
      existingProduct.subcategory = sub._id;
    }
    if (brandValue) {
      const br = await findBrandByIdOrName(brandValue);
      if (!br) {
        await cleanupAllFiles([...imagesFiles, thumbnailFile], variationImages);
        return res.status(400).json({ success: false, msg: `Brand not found: ${brandValue}` });
      }
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
    const oldThumbnail = existingProduct.thumbnail ?? null;
    if (newImages.length) existingProduct.images = newImages;
    if (newThumbnail) existingProduct.thumbnail = newThumbnail;

    // Process variants
    const variantIds = [];

    if (parsedVariations.length) {
      for (let i = 0; i < parsedVariations.length; i++) {
        const v = parsedVariations[i];

        // Core fields
        const price = parseFloat(v.price);
        const stockQuantity = parseInt(v.stockQuantity, 10);
        const weightQuantity = parseFloat(v.weightQuantity);

        if (
          isNaN(price) ||
          price <= 0 ||
          isNaN(stockQuantity) ||
          stockQuantity < 0 ||
          isNaN(weightQuantity) ||
          weightQuantity <= 0
        ) {
          await cleanupAllFiles([...imagesFiles, thumbnailFile], variationImages);
          return res.status(400).json({
            success: false,
            msg: `Variation ${i + 1}: invalid price, stock, or weightQuantity`,
          });
        }

        // Discount price
        let inputDiscount = v.discountPrice;
        let discount = 0;
        if (inputDiscount !== undefined) {
          discount = parseFloat(inputDiscount);
          if (isNaN(discount) || discount < 0) {
            await cleanupAllFiles([...imagesFiles, thumbnailFile], variationImages);
            return res.status(400).json({
              success: false,
              msg: `Variation ${i + 1}: discountPrice must be ≥ 0`,
            });
          }
        }

        // Find existing variant
        let existingVariant = null;
        if (v.sku) {
          existingVariant = await Variant.findOne({ sku: v.sku.trim() });
        }

        // Final discount price
        let finalDiscount = discount;
        if (existingVariant && inputDiscount === undefined) {
          finalDiscount = existingVariant.discountPrice ?? 0;
        }

        // Validate discount ≤ price
        if (finalDiscount > price) {
          await cleanupAllFiles([...imagesFiles, thumbnailFile], variationImages);
          return res.status(400).json({
            success: false,
            msg: `Variation ${i + 1}: discountPrice cannot exceed regular price`,
          });
        }

        // Unit
        const unit = await findUnitByIdOrName(v.unit);
        if (!unit) {
          await cleanupAllFiles([...imagesFiles, thumbnailFile], variationImages);
          return res.status(400).json({ success: false, msg: `Unit not found: ${v.unit}` });
        }

        // Build update object
        const variantUpdate = {
          product: productId,
          attribute: v.attribute.trim(),
          value: v.value.trim(),
          unit: unit._id,
          purchasePrice: parseFloat(v.purchasePrice),
          price,
          discountPrice: finalDiscount,
          stockQuantity,
          weightQuantity,
          updatedAt: new Date(),
        };

        // Handle expiryDate
        if (v.expiryDate !== undefined) {
          if (v.expiryDate === null) {
            variantUpdate.expiryDate = null;
          } else {
            const exp = new Date(v.expiryDate);
            if (isNaN(exp.getTime())) {
              await cleanupAllFiles([...imagesFiles, thumbnailFile], variationImages);
              return res.status(400).json({
                success: false,
                msg: `Variation ${i + 1}: Invalid expiryDate`,
              });
            }
            variantUpdate.expiryDate = exp;
          }
        } else if (existingVariant) {
          variantUpdate.expiryDate = existingVariant.expiryDate;
        }

        // Validate expiryDate and status
        if (variantUpdate.expiryDate) {
          const expiry = new Date(variantUpdate.expiryDate);
          if (expiry.getTime() < Date.now() && v.status === 'Active') {
            await cleanupAllFiles([...imagesFiles, thumbnailFile], variationImages);
            return res.status(400).json({
              success: false,
              msg: `Variation ${i + 1}: Expiry date cannot be today or in the past. Please select a future date.`,
            });
          }
        }

        // Handle status
        if (v.status && ['Active', 'Inactive'].includes(v.status)) {
          variantUpdate.status = v.status;
        }

        if (variationImages[i]) variantUpdate.image = variationImages[i];

        // Save/Update variant
        let savedVariant;
        const oldVariantImg = existingVariant?.image ?? null;

        if (existingVariant) {
          const variantDoc = await Variant.findById(existingVariant._id);
          Object.assign(variantDoc, variantUpdate);
          try {
            await variantDoc.validate();
            savedVariant = await variantDoc.save();
          } catch (ve) {
            await cleanupAllFiles([...imagesFiles, thumbnailFile], variationImages);
            return res.status(400).json({
              success: false,
              msg: `Variant ${i + 1} validation failed: ${ve.message}`,
            });
          }

          if (oldVariantImg && variationImages[i] && oldVariantImg !== variationImages[i]) {
            try {
              await fs.unlink(oldVariantImg);
            } catch {}
          }
        } else {
          const newVariant = new Variant({ ...variantUpdate, createdAt: new Date() });
          try {
            await newVariant.validate();
            savedVariant = await newVariant.save();
          } catch (ve) {
            await cleanupAllFiles([...imagesFiles, thumbnailFile], variationImages);
            return res.status(400).json({
              success: false,
              msg: `Variant ${i + 1} validation failed: ${ve.message}`,
            });
          }
        }

        variantIds.push(savedVariant._id);
      }

      // Cleanup old product images
      if (newImages.length && oldImages.length) {
        for (const img of oldImages) {
          try {
            await fs.unlink(img);
          } catch {}
        }
      }
      if (newThumbnail && oldThumbnail && newThumbnail !== oldThumbnail) {
        try {
          await fs.unlink(oldThumbnail);
        } catch {}
      }

      // Delete removed variants
      const currentIds = existingProduct.variations.map(v => v._id.toString());
      const newIds = variantIds.map(id => id.toString());
      const toDelete = currentIds.filter(id => !newIds.includes(id));

      for (const vid of toDelete) {
        const v = await Variant.findById(vid);
        if (v?.image) {
          try {
            await fs.unlink(v.image);
          } catch {}
        }
        await Variant.findByIdAndDelete(vid);
      }

      existingProduct.variations = variantIds;
    }

    // Update product stockQuantity
    const activeVariants = await Variant.find({
      product: productId,
      status: 'Active',
    });
    existingProduct.stockQuantity = activeVariants.reduce((sum, v) => sum + v.stockQuantity, 0);

    // Save product
    await existingProduct.save();

    // Return populated product
    const populated = await Product.findById(productId).populate([
      { path: 'category', select: 'name' },
      { path: 'subcategory', select: 'subcategoryName' },
      { path: 'brand', select: 'name' },
      {
        path: 'variations',
        select: 'attribute value sku price stockQuantity discountPrice image unit purchasePrice expiryDate status weightQuantity createdAt updatedAt',
      },
    ]);

    if (populated.variations.length) {
      await populated.populate({ path: 'variations.unit', select: 'unit_name' });
    }

    return res.status(200).json({
      success: true,
      msg: 'Product updated successfully',
      data: populated,
    });
  } catch (err) {
    const files = [
      ...(req.files?.['images'] ?? []),
      ...(req.files?.['thumbnail'] ? [req.files['thumbnail'][0]] : []),
    ];
    await cleanupAllFiles(files, variationImages);
    if (err.name === 'MongoServerError' && err.code === 11000) {
      return res.status(400).json({
        success: false,
        msg: `Duplicate: ${err.errmsg || 'SKU or name-brand conflict'}`,
      });
    }
    if (err.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        msg: `Validation: ${Object.values(err.errors).map(e => e.message).join(', ')}`,
      });
    }
    return res.status(500).json({
      success: false,
      msg: 'Server error',
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





