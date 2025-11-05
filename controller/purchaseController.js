const Purchase = require('../model/Purchase');
const Variant = require('../model/variantProduct');
const Supplier = require('../model/Supplier');



exports.createPurchase = async (req, res) => {
  try {
    const { supplierId, products, otherCharges, discount, payment, notes } = req.body;

    const supplier = await Supplier.findById(supplierId);
    if (!supplier) return res.status(400).json({ success: false, message: 'Invalid supplier' });

    let subtotal = 0;
    const validatedProducts = [];
    for (let prod of products) {
      const variant = await Variant.findById(prod.variantId);
      if (!variant || variant.status === 'Inactive') {
        return res.status(400).json({ success: false, message: `Invalid or inactive variant: ${prod.variantId}` });
      }
      const taxAmount = (prod.unitPrice * prod.quantity * (prod.taxPercent || 0)) / 100;
      const productTotal = prod.unitPrice * prod.quantity + taxAmount;
      subtotal += productTotal;
      validatedProducts.push({ variantId: prod.variantId, quantity: prod.quantity, unitPrice: prod.unitPrice, taxAmount });
    }

    const grandTotal = subtotal + (otherCharges || 0) - (discount || 0);
    const amountPaid = payment?.amountPaid || 0;
    const amountDue = grandTotal - amountPaid;

    let purchaseCode = `PUR-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    while (await Purchase.findOne({ purchaseCode })) {
      purchaseCode = `PUR-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    }

    const purchase = new Purchase({
      purchaseCode,
      supplierId,
      products: validatedProducts,
      payment: { amountPaid, amountDue, type: payment?.type || null },
      summary: { subtotal, otherCharges: otherCharges || 0, discount: discount || 0, grandTotal },
      notes: notes || '',
    });

    await purchase.save();

    for (let prod of validatedProducts) {
      const variant = await Variant.findById(prod.variantId);
      if (variant) {
        const updateData = { $inc: { stockQuantity: prod.quantity } };
        if (prod.unitPrice !== variant.purchasePrice) {
          updateData.$set = { ...updateData.$set, purchasePrice: prod.unitPrice };
        }
        await Variant.findByIdAndUpdate(prod.variantId, updateData);
      }
    }

    res.status(201).json({ success: true, message: 'Purchase created', data: purchase });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

exports.getAllPurchases = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const purchases = await Purchase.find()
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('supplierId', 'supplierName')
      .populate('products.variantId', 'sku attribute value unit');

    const total = await Purchase.countDocuments();

    res.status(200).json({
      success: true,
      message: 'Purchases fetched successfully',
      data: purchases,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching purchases:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching purchases',
      error: error.message,
    });
  }
};


exports.getPurchaseById = async (req, res) => {
  try {
    const { id } = req.params;
    const purchase = await Purchase.findById(id)
      .populate('supplierId', 'supplierName') // Populate supplier details
      .populate({
        path: 'products.variantId', 
        select: 'sku attribute value unit purchasePrice price discountPrice stockQuantity expiryDate weightQuantity image', // Select specific fields
        populate: {
          path: 'product', // Populate the Product reference within Variant
          select: 'name images thumbnail description' // Select Product fields (name, image-related fields, etc.)
        }
      });

    if (!purchase) return res.status(404).json({ success: false, message: 'Purchase not found' });

    res.status(200).json({ success: true, data: purchase });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};


exports.updatePurchase = async (req, res) => {
  try {
    const { id } = req.params;
    const { supplierId, products, otherCharges, discount, payment, notes } = req.body;

    const purchase = await Purchase.findById(id);
    if (!purchase) return res.status(404).json({ success: false, message: 'Purchase not found' });

    let subtotal = 0;
    const newProducts = [];
    for (let prod of products) {
      const variant = await Variant.findById(prod.variantId);
      if (!variant || variant.status === 'Inactive') {
        return res.status(400).json({ success: false, message: `Invalid or inactive variant: ${prod.variantId}` });
      }
      const taxAmount = (prod.unitPrice * prod.quantity * (prod.taxPercent || 0)) / 100;
      const productTotal = prod.unitPrice * prod.quantity + taxAmount;
      subtotal += productTotal;
      newProducts.push({ variantId: prod.variantId, quantity: prod.quantity, unitPrice: prod.unitPrice, taxAmount });
    }

    const grandTotal = subtotal + (otherCharges || 0) - (discount || 0);
    const amountPaid = payment?.amountPaid || purchase.payment.amountPaid;
    const amountDue = grandTotal - amountPaid;

    // Adjust stock levels
    const oldProducts = purchase.products;
    for (let oldProd of oldProducts) {
      const newProd = newProducts.find(p => p.variantId.toString() === oldProd.variantId.toString());
      const diff = newProd ? newProd.quantity - oldProd.quantity : -oldProd.quantity;
      if (diff !== 0) {
        await Variant.findByIdAndUpdate(oldProd.variantId, { $inc: { stockQuantity: diff } });
      }
    }

    purchase.set({
      supplierId,
      products: newProducts,
      payment: { amountPaid, amountDue, type: payment?.type || purchase.payment.type },
      summary: { subtotal, otherCharges: otherCharges || 0, discount: discount || 0, grandTotal },
      notes: notes || purchase.notes,
    });
    await purchase.save();

    res.status(200).json({ success: true, message: 'Purchase updated', data: purchase });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};



exports.deletePurchase = async (req, res) => {
  try {
    const { id } = req.params;
    const purchase = await Purchase.findByIdAndDelete(id);
    if (!purchase) return res.status(404).json({ success: false, message: 'Purchase not found' });

    // Decrease stock levels
    for (let prod of purchase.products) {
      await Variant.findByIdAndUpdate(prod.variantId, { $inc: { stockQuantity: -prod.quantity } });
    }

    res.status(200).json({ success: true, message: 'Purchase deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};