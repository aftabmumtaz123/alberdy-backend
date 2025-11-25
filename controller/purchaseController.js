const Purchase = require('../model/Purchase');
const Variant = require('../model/variantProduct');
const Supplier = require('../model/Supplier');
const mongoose = require('mongoose');



exports.createPurchase = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { supplierId, products, summary, payment, notes, status } = req.body;

    // === 1. Validate Required Fields ===
    if (!supplierId || !products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ success: false, message: 'Supplier and products are required' });
    }

    if (!summary || typeof summary !== 'object') {
      return res.status(400).json({ success: false, message: 'Summary object is required' });
    }

    const { otherCharges = 0, discount = 0 } = summary;

    if (otherCharges < 0 || discount < 0) {
      return res.status(400).json({ success: false, message: 'otherCharges and discount cannot be negative' });
    }

    // === 2. Validate Supplier ===
    const supplier = await Supplier.findById(supplierId);
    if (!supplier) {
      return res.status(400).json({ success: false, message: 'Invalid supplier' });
    }

    // === 3. Validate & Calculate Products + Subtotal ===
    let subtotal = 0;
    const validatedProducts = [];

    for (const item of products) {
      const { variantId, quantity, unitPrice, taxPercent = 0 } = item;

      if (!variantId || !quantity || !unitPrice) {
        return res.status(400).json({ success: false, message: 'variantId, quantity, and unitPrice are required' });
      }

      if (quantity < 1 || unitPrice < 0 || taxPercent < 0) {
        return res.status(400).json({ success: false, message: 'Invalid quantity, price, or tax' });
      }

      const variant = await Variant.findById(variantId).session(session);
      if (!variant || variant.status === 'Inactive') {
        return res.status(400).json({ success: false, message: `Variant not found or inactive: ${variantId}` });
      }

      const taxAmount = (unitPrice * quantity * taxPercent) / 100;
      const lineTotal = unitPrice * quantity + taxAmount;

      subtotal += lineTotal;

      validatedProducts.push({
        variantId,
        quantity,
        unitPrice,
        taxPercent,
        taxAmount,
      });
    }

    // === 4. Calculate Final Totals ===
    const grandTotal = subtotal + otherCharges - discount;

    if (grandTotal < 0) {
      return res.status(400).json({ success: false, message: 'Grand total cannot be negative' });
    }

    // === 5. Payment & Status Logic ===
    const amountPaid = payment?.amountPaid >= 0 ? payment.amountPaid : 0;
    const amountDue = grandTotal - amountPaid;

    if (amountDue < 0) {
      return res.status(400).json({ success: false, message: 'Amount paid cannot exceed grand total' });
    }

    // Auto-determine status unless explicitly provided
    let finalStatus = status;
    if (!finalStatus || finalStatus === 'Pending') {
      if (amountDue === 0) finalStatus = 'Completed';
      else if (amountPaid > 0) finalStatus = 'Partial';
      else finalStatus = 'Pending';
    }

    // But if user forces "Completed", validate full payment
    if (finalStatus === 'Completed' && amountDue > 0) {
      return res.status(400).json({
        success: false,
        message: 'Full payment required for Completed status',
      });
    }

    // === 6. Generate Purchase Code ===
    let purchaseCode = `PUR-${Date.now().toString(36).toUpperCase()}`;
    while (await Purchase.findOne({ purchaseCode })) {
      purchaseCode = `PUR-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substr(2, 3).toUpperCase()}`;
    }

    // === 7. Create Purchase ===
    const purchase = new Purchase({
      purchaseCode,
      supplierId,
      products: validatedProducts,
      summary: {
        subtotal,
        otherCharges,
        discount,
        grandTotal,
      },
      payment: {
        amountPaid,
        amountDue,
        type: payment?.type || null,
      },
      notes: notes || '',
      status: finalStatus,
    });

    await purchase.save({ session });

    // === 8. Update Stock & Purchase Price ===
    for (const item of validatedProducts) {
      const updateFields = {
        $inc: { stockQuantity: item.quantity },
      };

      // Update purchasePrice only if different
      const variant = await Variant.findById(item.variantId);
      if (variant.purchasePrice !== item.unitPrice) {
        updateFields.$set = { purchasePrice: item.unitPrice };
      }

      await Variant.findByIdAndUpdate(item.variantId, updateFields, { session });
    }

    await session.commitTransaction();

    const populatedPurchase = await Purchase.findById(purchase._id)
      .populate('supplierId', 'supplierName')
      .populate({
        path: 'products.variantId',
        populate: [
          { path: 'product', select: 'name' },
          { path: 'unit', select: 'short_name' },
        ],
      });

    res.status(201).json({
      success: true,
      message: 'Purchase created successfully',
      data: populatedPurchase,
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('Create Purchase Error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  } finally {
    session.endSession();
  }
};

exports.getAllPurchases = async (req, res) => {
  try {
    const { page = 1, limit } = req.query;
    const skip = (page - 1) * limit;

    const purchases = await Purchase.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('supplierId', 'supplierName')
      .populate({
        path: 'products.variantId',
        select: 'sku attribute value unit purchasePrice price discountPrice stockQuantity expiryDate weightQuantity image',
        populate: [
          {
            path: 'product',
            select: 'name images thumbnail description',
          },
          {
            path: 'unit',
            select: 'short_name',
          },
        ],
      });

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
      .populate('supplierId', 'supplierName')
      .populate({
        path: 'products.variantId',
        select: 'sku attribute value unit purchasePrice price discountPrice stockQuantity expiryDate weightQuantity image',
        populate: [
          {
            path: 'product',
            select: 'name images thumbnail description',
          },
          {
            path: 'unit',
            select: 'short_name',
          },
        ],
      });

    if (!purchase)
      return res.status(404).json({ success: false, message: 'Purchase not found' });

    res.status(200).json({
      success: true,
      message: 'Purchase fetched successfully',
      data: purchase,
    });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching purchase',
      error: error.message,
    });
  }
};

exports.updatePurchase = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { supplierId, products, summary, payment, notes, status } = req.body;

    const purchase = await Purchase.findById(id);
    if (!purchase) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'Purchase not found' });
    }

    // Prevent editing Completed or Cancelled
    if (purchase.status === 'Completed') {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Cannot modify a Completed purchase' });
    }

    if (purchase.status === 'Cancelled') {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Cannot modify a Cancelled purchase' });
    }

    // === Handle Cancellation ===
    if (status === 'Cancelled' && purchase.status !== 'Cancelled') {
      for (const item of purchase.products) {
        await Variant.findByIdAndUpdate(
          item.variantId,
          { $inc: { stockQuantity: -item.quantity } },
          { session }
        );
      }

      purchase.status = 'Cancelled';
      purchase.payment.amountPaid = 0;
      purchase.payment.amountDue = 0;
      purchase.summary.grandTotal = 0;
      purchase.summary.subtotal = 0;
      purchase.summary.otherCharges = 0;
      purchase.summary.discount = 0;

      await purchase.save({ session });
      await session.commitTransaction();

      return res.json({ success: true, message: 'Purchase cancelled and stock reverted' });
    }

    // === Normal Update (Pending/Partial) ===
    if (!summary || !products || !Array.isArray(products) || products.length === 0) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Products and summary required' });
    }

    const { otherCharges = 0, discount = 0 } = summary;

    let subtotal = 0;
    const newProducts = [];

    // Validate and calculate new products
    for (const item of products) {
      const { variantId, quantity, unitPrice, taxPercent = 0 } = item;
      const variant = await Variant.findById(variantId).session(session);
      if (!variant || variant.status === 'Inactive') {
        await session.abortTransaction();
        return res.status(400).json({ success: false, message: `Invalid variant: ${variantId}` });
      }

      const oldItem = purchase.products.find(p => p.variantId.toString() === variantId);
      const qtyDiff = oldItem ? quantity - oldItem.quantity : quantity;

      if (qtyDiff < 0 && variant.stockQuantity < -qtyDiff) {
        await session.abortTransaction();
        return res.status(400).json({ success: false, message: `Not enough stock to reduce: ${variant.sku}` });
      }

      const taxAmount = (unitPrice * quantity * taxPercent) / 100;
      const lineTotal = unitPrice * quantity + taxAmount;
      subtotal += lineTotal;

      newProducts.push({ variantId, quantity, unitPrice, taxPercent, taxAmount });
    }

    const grandTotal = subtotal + otherCharges - discount;
    if (grandTotal < 0) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Grand total cannot be negative' });
    }

    const amountPaid = payment?.amountPaid ?? purchase.payment.amountPaid;
    const amountDue = grandTotal - amountPaid;

    if (amountDue < 0) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Overpayment not allowed' });
    }

    // Final status logic
    let finalStatus = status;
    if (!finalStatus) {
      finalStatus = amountDue === 0 ? 'Completed' : amountPaid > 0 ? 'Partial' : 'Pending';
    }

    if (finalStatus === 'Completed' && amountDue > 0) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Full payment required for Completed status' });
    }

    // === Update Stock ===
    for (const item of newProducts) {
      const oldItem = purchase.products.find(p => p.variantId.toString() === item.variantId);
      const diff = oldItem ? item.quantity - oldItem.quantity : item.quantity;

      const update = { $inc: { stockQuantity: diff } };
      if (!oldItem || oldItem.unitPrice !== item.unitPrice) {
        update.$set = { purchasePrice: item.unitPrice };
      }

      await Variant.findByIdAndUpdate(item.variantId, update, { session });
    }

    // Handle removed products
    for (const old of purchase.products) {
      if (!newProducts.find(p => p.variantId === old.variantId.toString())) {
        await Variant.findByIdAndUpdate(
          old.variantId,
          { $inc: { stockQuantity: -old.quantity } },
          { session }
        );
      }
    }

    // === Save Purchase ===
    purchase.set({
      supplierId: supplierId || purchase.supplierId,
      products: newProducts,
      summary: { subtotal, otherCharges, discount, grandTotal },
      payment: { amountPaid, amountDue, type: payment?.type || purchase.payment.type },
      notes: notes || purchase.notes,
      status: finalStatus,
    });

    await purchase.save({ session });
    await session.commitTransaction();

    const updated = await Purchase.findById(id)
      .populate('supplierId', 'supplierName')
      .populate({
        path: 'products.variantId',
        populate: [
          { path: 'product', select: 'name' },
          { path: 'unit', select: 'short_name' },
        ],
      });

    res.json({
      success: true,
      message: 'Purchase updated successfully',
      data: updated,
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('Update Purchase Error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  } finally {
    session.endSession();
  }
};

exports.deletePurchase = async (req, res) => {
  try {
    const { id } = req.params;
    const purchase = await Purchase.findByIdAndDelete(id);
    if (!purchase) return res.status(404).json({ success: softDeletedSale, message: 'Purchase not found' });

    // Decrease stock levels
    for (let prod of purchase.products) {
      await Variant.findByIdAndUpdate(prod.variantId, { $inc: { stockQuantity: -prod.quantity } });
    }

    res.status(200).json({ success: true, message: 'Purchase deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};