const fs = require('fs').promises;
const path = require('path');

const Product = require('../model/Product');
const Variant = require('../model/variantProduct');
const Category = require('../model/Category');
const Subcategory = require('../model/subCategory');
const Brand = require('../model/Brand');
const Unit = require('../model/Unit');
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
  const { name, category: categoryValue, description, subCategory: subcategoryValueFromCamel, subcategory: subcategoryValueFromSnake, brand: brandValue, ingredients, suitableFor, status = 'Active', variations } = req.body;

  const subcategoryValue = subcategoryValueFromCamel || subcategoryValueFromSnake;
  const imagesFiles = req.files && req.files['images'] ? req.files['images'] : [];
  const thumbnailFile = req.files && req.files['thumbnail'] ? req.files['thumbnail'][0] : null;
  const images = imagesFiles.map(file => file.path);
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
    const allFiles = [...imagesFiles, thumbnailFile, ...Object.values(variationImages).filter(Boolean)].filter(f => f);
    for (const file of allFiles) {
      try { await fs.unlink(file); } catch { }
    }
  };

  if (suitableFor && !['Puppy', 'Adult', 'Senior', 'All Ages'].includes(suitableFor)) {
    await cleanupAllFiles();
    return res.status(400).json({ success: false, msg: 'Invalid suitableFor' });
  }
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
    .map(word => word[0])
    .join('')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '') + (name.match(/\d+/) ? name.match(/\d+/)[0] : '');

  for (let i = 0; i < parsedVariations.length; i++) {
    const varObj = parsedVariations[i];
    if (!varObj.attribute || !varObj.value) {
      await cleanupAllFiles();
      return res.status(400).json({ success: false, msg: `Variation ${i} missing required fields: attribute or value` });
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
        status: 'Active',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      if (varObj.expiryDate) variantData.expiryDate = new Date(varObj.expiryDate);
      const imagePath = variationImages[i];
      if (imagePath) variantData.image = imagePath;

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
            try { await fs.unlink(img); } catch { }
          }
        }
        if (newProduct.thumbnail) try { await fs.unlink(newProduct.thumbnail); } catch { }
        return res.status(400).json({ success: false, msg: `Variant validation failed: ${validationError.message}` });
      }
    }

    if (variantIds.length > 0) {
      await Product.findByIdAndUpdate(
        newProduct._id,
        { $push: { variations: { $each: variantIds } } },
        { new: true }
      );
      const updatedProduct = await Product.findById(newProduct._id);

      await updatedProduct.populate([
        { path: 'category', select: 'name' },
        { path: 'subcategory', select: 'subcategoryName' },
        { path: 'brand', select: 'name' },
        { path: 'variations', select: 'attribute value sku price stockQuantity discountPrice image unit purchasePrice expiryDate status weightQuantity createdAt updatedAt' }
      ]);

      if (variantIds.length > 0) {
        await updatedProduct.populate({ path: 'variations.unit', select: 'unit_name' });
      }

      res.status(201).json({
        success: true,
        msg: 'Product created successfully',
        product: updatedProduct
      });
    } else {
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
    let pipeline = [
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
          from: 'variants',
          let: { varIds: { $ifNull: ['$variations', []] } },
          pipeline: [
            {
              $match: {
                $expr: { $in: ['$_id', '$$varIds'] }
              }
            },
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

    if (lowStock === 'true') {
      pipeline.push({
        $addFields: {
          totalStock: { $sum: "$variations.stockQuantity" }
        }
      });
      pipeline.push({ $match: { totalStock: { $lt: 10 } } });
    }

    let countPipeline = [...pipeline];
    if (lowStock !== 'true') {
      countPipeline = pipeline.slice(0, pipeline.length - 1);
    }
    countPipeline.push({ $count: 'total' });
    const countResult = await Product.aggregate(countPipeline);
    const total = countResult.length > 0 ? countResult[0].total : 0;

    const sortStage = { $sort: { createdAt: -1 } };
    const skipStage = { $skip: (page - 1) * parseInt(limit) };
    const limitStage = { $limit: parseInt(limit) };
    const projectStage = { 
      $project: { 
        __v: 0,
        activeOffer: 0
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
    res.status(500).json({ success: false, msg: 'Server error fetching products', details: err.message || 'Unknown error' });
  }
};

exports.getProductById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, msg: 'Invalid product ID' });
    }

    const pipeline = [
      { $match: { _id: new mongoose.Types.ObjectId(id) } },
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
          from: 'variants',
          let: { varIds: { $ifNull: ['$variations', []] } },
          pipeline: [
            {
              $match: {
                $expr: { $in: ['$_id', '$$varIds'] }
              }
            },
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
      { $unset: '__v' }
    ];

    const products = await Product.aggregate(pipeline);
    if (products.length === 0) {
      return res.status(404).json({ success: false, msg: 'Product not found' });
    }

    const product = products[0];

    res.json({ success: true, message: "Product fetched successfully", product });
  } catch (err) {
    res.status(500).json({ success: false, msg: 'Server error fetching product', details: err.message || 'Unknown error' });
  }
};

exports.updateProduct = async (req, res) => {
  try {
    const productId = req.params.id;
    const {
      name,
      category: categoryValue,
      subcategory: subcategoryValue,
      brand: brandValue,
      ingredients,
      suitableFor,
      description,
      status,
      variations
    } = req.body;

    const existingProduct = await Product.findById(productId).populate('variations');
    if (!existingProduct) {
      return res.status(404).json({ success: false, msg: "Product not found" });
    }

    // Handle file uploads
    const imagesFiles = req.files && req.files['images'] ? req.files['images'] : [];
    const thumbnailFile = req.files && req.files['thumbnail'] ? req.files['thumbnail'][0] : null;
    const newImages = imagesFiles.map(file => file.path);
    const newThumbnail = thumbnailFile ? thumbnailFile.path : null;

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
          await cleanupAllFiles([...imagesFiles, thumbnailFile], variationImages);
          return res.status(400).json({ success: false, msg: `Invalid variations format: ${e.message}` });
        }
      } else if (Array.isArray(variations)) {
        parsedVariations = variations;
      } else {
        await cleanupAllFiles([...imagesFiles, thumbnailFile], variationImages);
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
    const cleanupAllFiles = async (files = [], varImages = {}) => {
      const allFiles = [...files, ...Object.values(varImages).filter(Boolean)].filter(f => f);
      for (const file of allFiles) {
        try { await fs.unlink(file); } catch { }
      }
    };

    // Validate inputs
    if (suitableFor && !['Puppy', 'Adult', 'Senior', 'All Ages'].includes(suitableFor)) {
      await cleanupAllFiles([...imagesFiles, thumbnailFile], variationImages);
      return res.status(400).json({ success: false, msg: 'Invalid suitableFor' });
    }
    if (status && !['Active', 'Inactive'].includes(status)) {
      await cleanupAllFiles([...imagesFiles, thumbnailFile], variationImages);
      return res.status(400).json({ success: false, msg: 'Invalid status' });
    }

    // Validate category, subcategory, brand
    if (categoryValue) {
      const category = await findCategoryByIdOrName(categoryValue);
      if (!category) {
        await cleanupAllFiles([...imagesFiles, thumbnailFile], variationImages);
        return res.status(400).json({ success: false, msg: `Category not found for value: ${categoryValue}` });
      }
      existingProduct.category = category._id;
    }
    if (subcategoryValue) {
      const subcategory = await findSubcategoryByIdOrName(subcategoryValue);
      if (!subcategory) {
        await cleanupAllFiles([...imagesFiles, thumbnailFile], variationImages);
        return res.status(400).json({ success: false, msg: `Subcategory not found for value: ${subcategoryValue}` });
      }
      existingProduct.subcategory = subcategory._id;
    }
    if (brandValue) {
      const brand = await findBrandByIdOrName(brandValue);
      if (!brand) {
        await cleanupAllFiles([...imagesFiles, thumbnailFile], variationImages);
        return res.status(400).json({ success: false, msg: `Brand not found for value: ${brandValue}` });
      }
      existingProduct.brand = brand._id;
    }

    // Update product fields
    existingProduct.name = name ? name.trim() : existingProduct.name;
    existingProduct.ingredients = ingredients ? (Array.isArray(ingredients) ? ingredients.join('\n').trim() : ingredients.trim()) : existingProduct.ingredients;
    existingProduct.suitableFor = suitableFor || existingProduct.suitableFor;
    existingProduct.description = description ? description.trim() : existingProduct.description;
    existingProduct.status = status || existingProduct.status;
    existingProduct.updatedAt = new Date().toISOString();

    // Handle image updates
    const oldImages = existingProduct.images || [];
    const oldThumbnail = existingProduct.thumbnail || null;
    if (newImages.length > 0) {
      existingProduct.images = newImages;
    }
    if (newThumbnail) {
      existingProduct.thumbnail = newThumbnail;
    }

    let variantIds = [];
    if (parsedVariations.length > 0) {
      for (let i = 0; i < parsedVariations.length; i++) {
        const variantData = parsedVariations[i];
        if (!variantData.sku || !variantData.attribute || !variantData.value) {
          await cleanupAllFiles([...imagesFiles, thumbnailFile], variationImages);
          return res.status(400).json({ success: false, msg: `Variation ${i} missing required fields: sku, attribute, or value` });
        }

        const varPrice = parseFloat(variantData.price);
        const varStock = parseInt(variantData.stockQuantity);
        const varDiscount = parseFloat(variantData.discountPrice || 0);
        const varWeightQuantity = parseFloat(variantData.weightQuantity);
        if (isNaN(varPrice) || varPrice <= 0 || isNaN(varStock) || varStock < 0 || isNaN(varWeightQuantity) || varWeightQuantity <= 0) {
          await cleanupAllFiles([...imagesFiles, thumbnailFile], variationImages);
          return res.status(400).json({ success: false, msg: `Variation ${i} invalid price, stock, or weightQuantity` });
        }
        if (variantData.discountPrice !== undefined && (isNaN(varDiscount) || varDiscount > varPrice)) {
          await cleanupAllFiles([...imagesFiles, thumbnailFile], variationImages);
          return res.status(400).json({ success: false, msg: `Variation ${i} invalid discountPrice` });
        }

        const unit = await findUnitByIdOrName(variantData.unit);
        if (!unit) {
          await cleanupAllFiles([...imagesFiles, thumbnailFile], variationImages);
          return res.status(400).json({ success: false, msg: `Unit not found for value: ${variantData.unit}` });
        }

        let variant = await Variant.findOne({ sku: variantData.sku });
        const oldVariantImage = variant ? variant.image : null;

        if (variant) {
          // Update existing variant
          variant.attribute = variantData.attribute.trim();
          variant.value = variantData.value.trim();
          variant.unit = unit._id;
          variant.purchasePrice = parseFloat(variantData.purchasePrice);
          variant.price = varPrice;
          variant.discountPrice = varDiscount;
          variant.stockQuantity = varStock;
          variant.weightQuantity = varWeightQuantity;
          variant.status = variantData.status || 'Active';
          variant.updatedAt = new Date();
          if (variantData.expiryDate) variant.expiryDate = new Date(variantData.expiryDate);
          if (variationImages[i]) variant.image = variationImages[i];
        } else {
          // Create new variant
          variant = new Variant({
            product: productId,
            attribute: variantData.attribute.trim(),
            value: variantData.value.trim(),
            sku: variantData.sku.trim(),
            unit: unit._id,
            purchasePrice: parseFloat(variantData.purchasePrice),
            price: varPrice,
            discountPrice: varDiscount,
            stockQuantity: varStock,
            weightQuantity: varWeightQuantity,
            status: variantData.status || 'Active',
            createdAt: new Date(),
            updatedAt: new Date(),
            image: variationImages[i] || null,
            expiryDate: variantData.expiryDate ? new Date(variantData.expiryDate) : null
          });
        }

        try {
          await variant.validate();
          const savedVariant = await variant.save();
          variantIds.push(savedVariant._id);

          // Cleanup old variant image if replaced
          if (oldVariantImage && variationImages[i] && oldVariantImage !== variationImages[i]) {
            try { await fs.unlink(oldVariantImage); } catch { }
          }
        } catch (validationError) {
          await cleanupAllFiles([...imagesFiles, thumbnailFile], variationImages);
          return res.status(400).json({ success: false, msg: `Variant validation failed: ${validationError.message}` });
        }
      }

      // Cleanup old images and thumbnail if replaced
      if (newImages.length > 0 && oldImages.length > 0) {
        for (const img of oldImages) {
          try { await fs.unlink(img); } catch { }
        }
      }
      if (newThumbnail && oldThumbnail && newThumbnail !== oldThumbnail) {
        try { await fs.unlink(oldThumbnail); } catch { }
      }

      // Update product variations
      existingProduct.variations = variantIds;

      // Delete variants not included in the update
      const existingVariantIds = existingProduct.variations.map(v => v._id.toString());
      const newVariantIds = variantIds.map(id => id.toString());
      const variantsToDelete = existingVariantIds.filter(id => !newVariantIds.includes(id));
      for (const variantId of variantsToDelete) {
        const variant = await Variant.findById(variantId);
        if (variant && variant.image) {
          try { await fs.unlink(variant.image); } catch { }
        }
        await Variant.findByIdAndDelete(variantId);
      }
    }

    await existingProduct.save();

    const populatedProduct = await Product.findById(productId).populate([
      { path: 'category', select: 'name' },
      { path: 'subcategory', select: 'subcategoryName' },
      { path: 'brand', select: 'name' },
      { path: 'variations', select: 'attribute value sku price stockQuantity discountPrice image unit purchasePrice expiryDate status weightQuantity createdAt updatedAt' }
    ]);

    if (populatedProduct.variations.length > 0) {
      await populatedProduct.populate({ path: 'variations.unit', select: 'unit_name' });
    }

    res.status(200).json({
      success: true,
      msg: "Product updated successfully",
      data: populatedProduct
    });
  } catch (err) {
    await cleanupAllFiles([...(req.files && req.files['images'] ? req.files['images'] : []), req.files && req.files['thumbnail'] ? req.files['thumbnail'][0] : null], {});
    if (err.name === 'MongoServerError' && err.code === 11000) {
      return res.status(400).json({ success: false, msg: `Duplicate data detected: ${err.errmsg || 'Check SKU or product name/brand uniqueness'}` });
    }
    if (err.name === 'ValidationError') {
      return res.status(400).json({ success: false, msg: `Validation error: ${Object.values(err.errors).map(e => e.message).join(', ')}` });
    }
    res.status(500).json({
      success: false,
      msg: "Server error while updating product",
      error: err.message || 'Unknown error'
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
