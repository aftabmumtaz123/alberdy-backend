const fs = require('fs').promises; // For async file cleanup
const path = require('path');

const Variant = require('../model/variantProduct'); // Adjust path as needed
const Product = require('../model/Product');
const Unit = require('../model/Unit'); // Assuming Unit model exists; adjust path as needed
const mongoose = require('mongoose');


const findVariantByIdOrSku = async (value) => {
  if (!value) return null;
  const trimmedValue = value.toString().trim();
  if (mongoose.Types.ObjectId.isValid(trimmedValue)) {
    return await Variant.findById(trimmedValue).populate('product', 'name');
  }
  return await Variant.findOne({ sku: trimmedValue, status: 'Active' }).populate('product', 'name');
};

// Create Variant (POST /api/variants)
exports.createVariant = async (req, res) => {
  console.log('DEBUG: Variant req.body:', req.body); // Remove in prod
  const { product: productValue, weightQuantity , attribute, value, sku, unit: unitValue, purchasePrice, price, discountPrice, stockQuantity, expiryDate, status = 'Active' } = req.body;

  // Handle optional image upload
  const imageFile = req.files && req.files['image'] ? req.files['image'][0] : null;
  const image = imageFile ? imageFile.path : null;

  // Validation
  if (!['Active', 'Inactive'].includes(status)) {
    if (imageFile) try { await fs.unlink(image); } catch { }
    return res.status(400).json({ success: false, msg: 'Invalid status' });
  }
  if (!attribute || !value || !sku || sku.trim() === '' || !unitValue || !mongoose.Types.ObjectId.isValid(unitValue)) {
    if (imageFile) try { await fs.unlink(image); } catch { }
    return res.status(400).json({ success: false, msg: 'Missing or invalid required fields: attribute, value, sku, or unit' });
  }
  const parsedPrice = parseFloat(price);
  const parsedPurchasePrice = parseFloat(purchasePrice);
  const parsedStock = parseInt(stockQuantity || 0);
  if (isNaN(parsedPrice) || parsedPrice <= 0 || isNaN(parsedPurchasePrice) || parsedPurchasePrice <= 0 || isNaN(parsedStock) || parsedStock < 0) {
    if (imageFile) try { await fs.unlink(image); } catch { }
    return res.status(400).json({ success: false, msg: 'Invalid price, purchasePrice, or stockQuantity' });
  }
  const parsedDiscount = parseFloat(discountPrice);
  if (discountPrice !== undefined && (isNaN(parsedDiscount) || parsedDiscount > parsedPrice)) {
    if (imageFile) try { await fs.unlink(image); } catch { }
    return res.status(400).json({ success: false, msg: 'Invalid discountPrice' });
  }
  if (expiryDate !== undefined) {
    const expiry = new Date(expiryDate);
    if (isNaN(expiry.getTime())) {
      if (imageFile) try { await fs.unlink(image); } catch { }
      return res.status(400).json({ success: false, msg: 'Invalid expiryDate' });
    }
  }

  try {
    // Lookup product
    let product;
    if (mongoose.Types.ObjectId.isValid(productValue)) {
      product = await Product.findById(productValue);
    } else {
      product = await Product.findOne({ name: productValue });
    }
    if (!product) {
      if (imageFile) try { await fs.unlink(image); } catch { }
      return res.status(400).json({ success: false, msg: `Product not found for value: ${productValue}` });
    }

    // Lookup unit
    const unit = await Unit.findById(unitValue);
    if (!unit) {
      if (imageFile) try { await fs.unlink(image); } catch { }
      return res.status(400).json({ success: false, msg: `Unit not found for ID: ${unitValue}` });
    }

    // Check SKU uniqueness
    const existingVariant = await Variant.findOne({ sku: sku.trim() });
    if (existingVariant) {
      if (imageFile) try { await fs.unlink(image); } catch { }
      return res.status(400).json({ success: false, msg: `SKU '${sku}' already exists` });
    }

    const variantData = {
      product: product._id,
      attribute: attribute.trim(),
      value: value.trim(),
      sku: sku.trim(),
      unit: unit._id,
      weightQuantity,
      purchasePrice: parsedPurchasePrice,
      price: parsedPrice,
      stockQuantity: parsedStock,
      status
    };
    if (discountPrice !== undefined) variantData.discountPrice = parsedDiscount;
    if (expiryDate !== undefined) variantData.expiryDate = new Date(expiryDate);
    if (image) variantData.image = image;

    const newVariant = new Variant(variantData);
    await newVariant.validate();
    await newVariant.save();
    await newVariant.populate('product unit', 'name');

    // Add ref to product's variations array
    await Product.findByIdAndUpdate(product._id, { $push: { variations: newVariant._id } });

    res.status(201).json({
      success: true,
      msg: 'Variant created successfully',
      variant: newVariant
    });
  } catch (err) {
    console.error('Variant creation error:', err.message || err);
    if (imageFile) try { await fs.unlink(image); } catch { }
    if (err.name === 'MongoServerError' && err.code === 11000) {
      return res.status(400).json({ success: false, msg: 'Duplicate SKU detected' });
    }
    if (err.name === 'ValidationError') {
      return res.status(400).json({ success: false, msg: `Validation error: ${Object.values(err.errors).map(e => e.message).join(', ')}` });
    }
    res.status(500).json({ success: false, msg: 'Server error during variant creation', details: err.message || 'Unknown error' });
  }
};

// Get All Variants (GET /api/variants)
exports.getAllVariants = async (req, res) => {
  const { page = 1, limit , product, sku, status, attribute } = req.query;
  const filter = {};
  if (product) {
    let prod;
    if (mongoose.Types.ObjectId.isValid(product)) {
      prod = await Product.findById(product);
    } else {
      prod = await Product.findOne({ name: product });
    }
    if (prod) filter.product = prod._id;
    else return res.status(400).json({ success: false, msg: 'Invalid product filter' });
  }
  if (sku) filter.sku = { $regex: sku, $options: 'i' };
  if (status) filter.status = status;
  if (attribute) filter.attribute = attribute;

  try {
    const variants = await Variant.find(filter)
      .populate('product unit', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * parseInt(limit))
      .limit(parseInt(limit));

    const total = await Variant.countDocuments(filter);

    res.json({
      success: true,
      variants,
      total,
      pages: Math.ceil(total / limit),
      currentPage: page
    });
  } catch (err) {
    console.error('Variants list error:', err.message || err);
    res.status(500).json({ success: false, msg: 'Server error fetching variants', details: err.message || 'Unknown error' });
  }
};

// Get Variant by ID (GET /api/variants/:id)
exports.getVariantById = async (req, res) => {
  try {
    const variant = await findVariantByIdOrSku(req.params.id);
    if (!variant) {
      return res.status(404).json({ success: false, msg: 'Variant not found' });
    }
    res.json({ success: true, variant });
  } catch (err) {
    console.error('Variant get error:', err.message || err);
    res.status(500).json({ success: false, msg: 'Server error fetching variant', details: err.message || 'Unknown error' });
  }
};

// Update Variant (PUT /api/variants/:id)
exports.updateVariant = async (req, res) => {
  console.log('DEBUG: Update variant req.body:', req.body); // Remove in prod
  const { attribute, value, sku, unit: unitValue, purchasePrice, price, discountPrice, stockQuantity, expiryDate, status } = req.body;

  // Handle optional new image (replace)
  const newImageFile = req.files && req.files['image'] ? req.files['image'][0] : null;
  const newImage = newImageFile ? newImageFile.path : undefined;

  // Basic validation
  if (status !== undefined && !['Active', 'Inactive'].includes(status)) {
    if (newImageFile) try { await fs.unlink(newImage); } catch { }
    return res.status(400).json({ success: false, msg: 'Invalid status' });
  }
  if (sku !== undefined && sku.trim() === '') {
    if (newImageFile) try { await fs.unlink(newImage); } catch { }
    return res.status(400).json({ success: false, msg: 'Invalid sku' });
  }
  if (unitValue !== undefined && (!mongoose.Types.ObjectId.isValid(unitValue))) {
    if (newImageFile) try { await fs.unlink(newImage); } catch { }
    return res.status(400).json({ success: false, msg: 'Invalid unit' });
  }
  if (price !== undefined) {
    const parsedPrice = parseFloat(price);
    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      if (newImageFile) try { await fs.unlink(newImage); } catch { }
      return res.status(400).json({ success: false, msg: 'Invalid price' });
    }
  }
  if (purchasePrice !== undefined) {
    const parsedPurchasePrice = parseFloat(purchasePrice);
    if (isNaN(parsedPurchasePrice) || parsedPurchasePrice <= 0) {
      if (newImageFile) try { await fs.unlink(newImage); } catch { }
      return res.status(400).json({ success: false, msg: 'Invalid purchasePrice' });
    }
  }
  if (discountPrice !== undefined) {
    const parsedDiscount = parseFloat(discountPrice);
    const currentVariant = await Variant.findById(req.params.id);
    const currentPrice = price !== undefined ? parseFloat(price) : currentVariant.price;
    if (isNaN(parsedDiscount) || parsedDiscount > currentPrice) {
      if (newImageFile) try { await fs.unlink(newImage); } catch { }
      return res.status(400).json({ success: false, msg: 'Invalid discountPrice' });
    }
  }
  if (stockQuantity !== undefined) {
    const parsedStock = parseInt(stockQuantity);
    if (isNaN(parsedStock) || parsedStock < 0) {
      if (newImageFile) try { await fs.unlink(newImage); } catch { }
      return res.status(400).json({ success: false, msg: 'Invalid stockQuantity' });
    }
  }
  if (expiryDate !== undefined) {
    const expiry = new Date(expiryDate);
    if (isNaN(expiry.getTime())) {
      if (newImageFile) try { await fs.unlink(newImage); } catch { }
      return res.status(400).json({ success: false, msg: 'Invalid expiryDate' });
    }
  }

  try {
    const currentVariant = await Variant.findById(req.params.id).populate('product unit');
    if (!currentVariant) {
      if (newImageFile) try { await fs.unlink(newImage); } catch { }
      return res.status(404).json({ success: false, msg: 'Variant not found' });
    }

    // If SKU changed, check uniqueness
    let finalSku = sku !== undefined ? sku.trim() : currentVariant.sku;
    if (sku !== undefined && finalSku !== currentVariant.sku) {
      const existing = await Variant.findOne({ sku: finalSku });
      if (existing) {
        if (newImageFile) try { await fs.unlink(newImage); } catch { }
        return res.status(400).json({ success: false, msg: `SKU '${finalSku}' already exists` });
      }
    }

    // If unit changed, validate
    let finalUnit = unitValue !== undefined ? unitValue : currentVariant.unit._id;
    if (unitValue !== undefined && finalUnit !== currentVariant.unit._id) {
      const unit = await Unit.findById(finalUnit);
      if (!unit) {
        if (newImageFile) try { await fs.unlink(newImage); } catch { }
        return res.status(400).json({ success: false, msg: `Unit not found for ID: ${finalUnit}` });
      }
    }

    const updateData = {};
    if (attribute !== undefined) updateData.attribute = attribute.trim();
    if (value !== undefined) updateData.value = value.trim();
    if (sku !== undefined) updateData.sku = finalSku;
    if (unitValue !== undefined) updateData.unit = finalUnit;
    if (purchasePrice !== undefined) updateData.purchasePrice = parseFloat(purchasePrice);
    if (price !== undefined) updateData.price = parseFloat(price);
    if (discountPrice !== undefined) updateData.discountPrice = parseFloat(discountPrice);
    if (stockQuantity !== undefined) updateData.stockQuantity = parseInt(stockQuantity);
    if (expiryDate !== undefined) updateData.expiryDate = new Date(expiryDate);
    if (status !== undefined) updateData.status = status;
    if (newImage) {
      updateData.image = newImage;
      if (currentVariant.image) try { await fs.unlink(currentVariant.image); } catch { }
    }

    if (Object.keys(updateData).length === 0 && !newImage) {
      if (newImageFile) try { await fs.unlink(newImage); } catch { }
      return res.status(400).json({ success: false, msg: 'No fields provided to update' });
    }

    const updatedVariant = await Variant.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true })
      .populate('product unit', 'name');

    res.json({
      success: true,
      msg: 'Variant updated successfully',
      variant: updatedVariant
    });
  } catch (err) {
    console.error('Variant update error:', err.message || err);
    if (newImageFile) try { await fs.unlink(newImage); } catch { }
    if (err.name === 'MongoServerError' && err.code === 11000) {
      return res.status(400).json({ success: false, msg: 'Duplicate SKU detected' });
    }
    if (err.name === 'ValidationError') {
      return res.status(400).json({ success: false, msg: `Validation error: ${Object.values(err.errors).map(e => e.message).join(', ')}` });
    }
    res.status(500).json({ success: false, msg: 'Server error updating variant', details: err.message || 'Unknown error' });
  }
};

// Delete Variant (DELETE /api/variants/:id)
exports.deleteVariant = async (req, res) => {
  try {
    const variant = await Variant.findById(req.params.id).populate('product');
    if (!variant) {
      return res.status(404).json({ success: false, msg: 'Variant not found' });
    }

    // Cleanup image
    if (variant.image) try { await fs.unlink(variant.image); } catch { }

    // Remove ref from product
    await Product.findByIdAndUpdate(variant.product._id, { $pull: { variations: variant._id } });

    await Variant.findByIdAndDelete(req.params.id);

    res.json({ success: true, msg: 'Variant deleted successfully' });
  } catch (err) {
    console.error('Variant delete error:', err.message || err);
    res.status(500).json({ success: false, msg: 'Server error deleting variant', details: err.message || 'Unknown error' });
  }
};

